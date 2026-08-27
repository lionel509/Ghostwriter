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

export function requestPlugin(
  client: OllamaClient,
  settings: () => GhostwriterSettings,
  allowed: () => boolean,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: number | null = null;

      constructor(private view: EditorView) {}

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
        // Debouncing is not added delay — it aims the request at the 300-800ms
        // pause a writer already takes at a word or clause boundary.
        this.timer = window.setTimeout(() => void this.fire(), settings().debounceMs);
      }

      private async fire() {
        const state = this.view.state;
        const head = state.selection.main.head;
        if (!state.selection.main.empty) return;
        if (completionStatus(state) !== null) return;

        const prefix = state.doc.sliceString(
          Math.max(0, head - settings().prefixChars), head,
        );
        if (!prefix.trim()) return;

        const text = await client.complete(prefix);
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
