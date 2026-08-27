import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration, EditorView, WidgetType, keymap,
  ViewPlugin, type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import type { OllamaClient } from "./ollama";
import type { GhostwriterSettings } from "./settings";

export const setSuggestion = StateEffect.define<Suggestion>();
export const clearSuggestion = StateEffect.define<null>();

interface Suggestion {
  /** The text still to be accepted — shrinks as the user types into it. */
  text: string;
  /** Document offset the ghost text renders at. */
  pos: number;
}

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: GhostWidget) { return other.text === this.text; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "ghostwriter-inline";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() { return false; }
}

export const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,

  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
      if (e.is(clearSuggestion)) return null;
    }
    if (!value) return null;

    // Completr (and any other autocomplete) owns the keyboard while its popup
    // is open. One of the two is live at a time, which is what keeps Tab from
    // being fought over.
    if (completionStatus(tr.state) !== null) return null;

    if (tr.docChanged) {
      // PREFIX ADVANCEMENT — the single biggest perceived-latency win.
      // If the user typed exactly what was predicted, trim the accepted
      // characters and re-render. No request, no network, no wait: they are
      // typing into a suggestion that already exists.
      let typed = "";
      let simpleInsertAtCursor = true;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (fromA !== value.pos || toA !== value.pos) simpleInsertAtCursor = false;
        typed += inserted.toString();
      });
      if (!simpleInsertAtCursor || !typed) return null;
      if (!value.text.startsWith(typed)) return null;     // diverged — drop it
      const rest = value.text.slice(typed.length);
      return rest ? { text: rest, pos: value.pos + typed.length } : null;
    }

    // Any cursor move away from the anchor invalidates the suggestion.
    if (tr.selection && tr.selection.main.head !== value.pos) return null;
    return value;
  },

  provide: (f) =>
    EditorView.decorations.from(f, (value): DecorationSet =>
      value
        ? Decoration.set([
            Decoration.widget({ widget: new GhostWidget(value.text), side: 1 })
              .range(value.pos),
          ])
        : Decoration.none,
    ),
});

/** Prec.highest so Tab reaches us before Obsidian's indent handler. Both
 *  handlers return false when there is no suggestion, so normal Tab still
 *  indents and Completr keeps its own bindings. */
export const ghostKeymap = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const s = view.state.field(suggestionField, false);
        if (!s) return false;
        view.dispatch({
          changes: { from: s.pos, insert: s.text },
          selection: { anchor: s.pos + s.text.length },
          effects: clearSuggestion.of(null),
        });
        return true;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(suggestionField, false)) return false;
        view.dispatch({ effects: clearSuggestion.of(null) });
        return true;
      },
    },
  ]),
);


/** The raw text before the cursor does not say what the note is *about*. Given
 *  only "...it stops the cooking and", the model answered "makes sure the dish
 *  is clean"; given the note's title and tags too, it answered "keeps the
 *  noodles from getting mushy". Prefill for the extra ~200 chars costs ~8 ms.
 *
 *  Everything here comes from the document itself, so this stays a pure
 *  CodeMirror extension with no dependency on the Obsidian app object. */
export function buildPrompt(
  state: { doc: { sliceString(a: number, b: number): string; length: number } },
  head: number,
  prefixChars: number,
): string {
  const from = Math.max(0, head - prefixChars);
  const prefix = state.doc.sliceString(from, head);
  if (from === 0) return prefix;                    // header is already in view

  const top = state.doc.sliceString(0, Math.min(600, state.doc.length));
  const parts: string[] = [];

  // YAML frontmatter: the tag block is a closed vocabulary per vault and is the
  // cheapest signal available for what kind of note this is.
  const fm = /^---\n([\s\S]*?)\n---/.exec(top);
  if (fm) parts.push(`---\n${fm[1]}\n---`);

  // The title, and the nearest heading above the cursor.
  const title = /^#\s+(.+)$/m.exec(fm ? top.slice(fm[0].length) : top);
  if (title) parts.push(`# ${title[1].trim()}`);
  // Only reach backwards for a heading when the prefix window does not already
  // contain one — otherwise we prepend a stale section ("## Ingredients") while
  // the cursor is plainly under a newer one ("## Steps").
  if (!/^#{1,6}\s+.+$/m.test(prefix)) {
    const headings = state.doc.sliceString(0, from).match(/^#{1,6}\s+.+$/gm);
    if (headings?.length) {
      const last = headings[headings.length - 1].trim();
      if (!parts.some((p) => p.includes(last))) parts.push(last);
    }
  }

  return parts.length ? `${parts.join("\n\n")}\n\n${prefix}` : prefix;
}

export function requestPlugin(
  client: OllamaClient,
  settings: () => GhostwriterSettings,
  allowed: () => boolean,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: number | null = null;
      /** Small bounded LRU of prefix -> completion (null = model declined). */
      private cache = new Map<string, string | null>();

      constructor(private view: EditorView) {}

      private remember(prefix: string, text: string | null) {
        this.cache.set(prefix, text);
        if (this.cache.size > 200) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
      }

      update(u: ViewUpdate) {
        if (!u.docChanged && !u.selectionSet) return;
        // The field already advanced the ghost text for a matching keystroke;
        // asking again for the same prediction would be pure waste.
        if (u.state.field(suggestionField, false)) return;
        this.schedule();
      }

      private schedule() {
        if (this.timer !== null) window.clearTimeout(this.timer);
        client.cancel();
        if (!allowed()) return;
        // The model answers in ~22 ms, so this timer *is* the perceived latency.
        // Wait longer only mid-word, where the completion is likely to be thrown
        // away anyway; at a word or punctuation boundary, go almost immediately.
        const s = settings();
        this.timer = window.setTimeout(
          () => void this.fire(),
          this.atBoundary() ? s.debounceMs : s.debounceMidWordMs,
        );
      }

      private atBoundary(): boolean {
        const st = this.view.state;
        const head = st.selection.main.head;
        return head === 0 || /[\s.,;:!?)\]}"'—-]$/.test(st.doc.sliceString(head - 1, head));
      }

      private async fire() {
        const state = this.view.state;
        const head = state.selection.main.head;
        if (!state.selection.main.empty) return;
        if (completionStatus(state) !== null) return;

        // A nearly-empty note gives the model nothing to work with, and that is
        // exactly where it degenerates. "the quick brown fox jumped over " in an
        // untitled note produced "10000000000000000000000.".
        const raw = state.doc.sliceString(Math.max(0, head - settings().prefixChars), head);
        if (raw.replace(/\s+/g, " ").trim().length < settings().minPrefixChars) return;

        const prefix = buildPrompt(state, head, settings().prefixChars);
        if (!prefix.trim()) return;

        // Backspace-and-retype lands on a prefix we have already answered.
        // Serving it from memory costs nothing and is genuinely instant.
        const hit = this.cache.get(prefix);
        if (hit !== undefined) {
          if (hit) this.view.dispatch({ effects: setSuggestion.of({ text: hit, pos: head }) });
          return;
        }

        const text = await client.complete(prefix);
        this.remember(prefix, text);
        if (!text) return;
        // The document may have moved while we waited.
        if (this.view.state.selection.main.head !== head) return;
        this.view.dispatch({ effects: setSuggestion.of({ text, pos: head }) });
      }

      destroy() {
        if (this.timer !== null) window.clearTimeout(this.timer);
        client.cancel();
      }
    },
  );
}
