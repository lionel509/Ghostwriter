import { SAMPLING, type GhostwriterSettings } from "./settings";

export class OllamaClient {
  private inFlight: AbortController | null = null;
  /** Distinguishes 'the endpoint is down' from 'the model declined'. */
  lastFailed = false;
  /** Set when the last call was cancelled by the next keystroke rather than
   *  answered. A cancelled call learned nothing about the prefix, so the caller
   *  must not remember it as "no completion here". */
  lastAborted = false;

  /** The model name currently resident, which is not always settings.model —
   *  the user can rename it in settings while the old weights are still loaded.
   *  release() has to unload what is in memory, not what is in the config. */
  private warmed: string | null = null;

  constructor(private settings: GhostwriterSettings) {}

  /** Load the weights without generating. Ollama treats a request with no
   *  prompt as load-only and answers done_reason:"load". Called at vault open so
   *  the cold load lands while the window is still painting, not mid-sentence. */
  async warm(): Promise<boolean> {
    const model = this.settings.model;
    try {
      const res = await fetch(`${this.settings.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: this.settings.keepAlive }),
      });
      if (res.ok) this.warmed = model;
      this.lastFailed = !res.ok;
      return res.ok;
    } catch {
      this.lastFailed = true;
      return false;
    }
  }

  /** Hand the memory back. keep_alive:0 evicts immediately instead of waiting
   *  out an idle timer that keep_alive:-1 does not have.
   *  fetch keepalive:true matters here: onunload fires while Obsidian is tearing
   *  the window down, and a normal fetch would be cancelled before it is sent. */
  async release(): Promise<void> {
    const model = this.warmed;
    if (!model) return;
    this.warmed = null;
    try {
      await fetch(`${this.settings.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ model, keep_alive: 0 }),
      });
    } catch {
      // Ollama already stopped reaches the same end state: not resident.
    }
  }

  /** Cancel whatever is in the air. Called on every keystroke — a completion
   *  for a prefix the user has already moved past is worthless. */
  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
  }

  /** Used by the "test connection" command, so a silent plugin can be told
   *  apart from a stopped Ollama without reading logs. */
  async ping(): Promise<string> {
    try {
      const res = await fetch(`${this.settings.endpoint}/api/tags`);
      if (!res.ok) return `Ollama replied ${res.status}`;
      const { models } = (await res.json()) as { models?: { name: string }[] };
      const names = (models ?? []).map((m) => m.name);
      return names.includes(this.settings.model)
        ? `OK — ${this.settings.model} is available`
        : `Ollama is up, but "${this.settings.model}" is not pulled`;
    } catch {
      return `Cannot reach Ollama at ${this.settings.endpoint}`;
    }
  }

  async complete(prefix: string): Promise<string | null> {
    this.cancel();
    this.lastAborted = false;
    const ac = new AbortController();
    this.inFlight = ac;
    try {
      const res = await fetch(`${this.settings.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          model: this.settings.model,
          prompt: prefix,
          // raw:true bypasses the chat template. This is not an optimisation —
          // with the template applied to a bare prefix the model returns "".
          raw: true,
          stream: false,
          keep_alive: this.settings.keepAlive,
          options: SAMPLING,
        }),
      });
      this.lastFailed = false;
      if (!res.ok) { this.lastFailed = true; return null; }
      // Answering a request is also what loads the model, so completion is a
      // second way in. Record it, or release() later has nothing to unload.
      this.warmed = this.settings.model;
      const data = (await res.json()) as { response?: string };
      const text = this.clean(data.response ?? "");
      if (!text) return null;
      if (this.isDegenerate(text) || this.isJunkNumeric(text)) return null;
      if (this.isEcho(text, prefix)) return null;
      return text;
    } catch (e) {
      // An abort is normal (the user kept typing); anything else is a real fault.
      this.lastAborted = e instanceof DOMException && e.name === "AbortError";
      this.lastFailed = !this.lastAborted;
      return null;
    } finally {
      if (this.inFlight === ac) this.inFlight = null;
    }
  }

  /** The stop sequences strip the terminator, and markdown delimiters from the
   *  prefix leak into the completion ("a special dish.**"). Put the sentence
   *  back, and do not double-punctuate. */
  private clean(raw: string): string | null {
    let t = raw.replace(/[\r\n]+$/, "").replace(/(\*\*|__|\*|_|`)+$/, "").trimEnd();
    t = t.replace(/([.!?])[.!?]+$/, "$1");            // "Fox.." -> "Fox."
    if (!t.trim()) return null;
    if (!/[.!?:;,]$/.test(t)) t += ".";
    return t;
  }

  /** Reject degenerate output — "10000000000000000000000.", a token the model
   *  latched onto and could not leave. repeat_penalty does not catch this
   *  because each digit is cheap and the run is inside one "word". */
  private isDegenerate(text: string): boolean {
    const t = text.trim();
    if (t.length < 6) return false;
    if (/(.)\1{5,}/.test(t)) return true;                    // aaaaaa / 000000
    const uniq = new Set(t.replace(/[\s.]/g, "")).size;
    if (t.length >= 10 && uniq <= 2) return true;            // 1010101010
    const words = t.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 4 && new Set(words).size <= words.length / 2) return true;
    return false;
  }

  /** Reject numeric junk. Base models continue raw web text, where a bare
   *  fragment statistically leads to dates, scores and list numbering — measured
   *  at 6/7 and 7/7 across two model families, and 7/7 on an instruct model too
   *  (raw:true bypasses the chat template, so instruct tuning never engages).
   *  No model choice fixes this; it has to be rejected on the way out.
   *
   *  Numbers in the vault are legitimate ("3 tbsp sesame paste", "$2.21 a
   *  lunch"), so the rule is about numbers standing *alone*, not numbers. */
  private isJunkNumeric(text: string): boolean {
    const t = text.trim();
    const alpha = t.match(/[A-Za-z\u00C0-\u024F]{2,}/g) ?? [];
    if (alpha.length === 0) return true;                      // "3000." "100%" "2018-10-13"
    if (/^[\W]*\d/.test(t) && alpha.length < 3) return true;  // "3D printing" "2019 - YouTube"
    return false;
  }

  /** Reject a completion that replays text already on screen, or itself.
   *  Exact-substring matching was not enough: with "…brown fox jumps over the
   *  lazy dog." on screen it happily suggested "The fox jumps over the lazy
   *  dog." — different by one word, identical to read. Shared word 4-grams
   *  catch that while leaving genuine repetition alone ("the integral is a line
   *  integral, not a surface integral"). */
  private isEcho(text: string, prefix: string, n = 4): boolean {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const t = norm(text).split(" ").filter(Boolean);
    const p = norm(prefix.slice(-600));
    if (t.length < n) return norm(text).length >= 8 && p.includes(norm(text));

    const inPrefix = new Set<string>();
    const words = p.split(" ").filter(Boolean);
    for (let i = 0; i + n <= words.length; i++) inPrefix.add(words.slice(i, i + n).join(" "));
    for (let i = 0; i + n <= t.length; i++) {
      if (inPrefix.has(t.slice(i, i + n).join(" "))) return true;
    }
    const self = new Set<string>();
    for (let i = 0; i + n <= t.length; i++) {
      const g = t.slice(i, i + n).join(" ");
      if (self.has(g)) return true;
      self.add(g);
    }
    return false;
  }
}
