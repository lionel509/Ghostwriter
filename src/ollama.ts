import { SAMPLING, type GhostwriterSettings } from "./settings";

export class OllamaClient {
  private inFlight: AbortController | null = null;
  /** Distinguishes 'the endpoint is down' from 'the model declined'. */
  lastFailed = false;

  constructor(private settings: GhostwriterSettings) {}

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
          // -1 pins the model. Cold load is seconds; paying it mid-sentence
          // after every pause is what would make this feel broken.
          keep_alive: -1,
          options: SAMPLING,
        }),
      });
      this.lastFailed = false;
      if (!res.ok) { this.lastFailed = true; return null; }
      const data = (await res.json()) as { response?: string };
      const text = this.clean(data.response ?? "");
      if (!text || this.isDegenerate(text) || this.isEcho(text, prefix)) return null;
      return text;
    } catch (e) {
      // An abort is normal (the user kept typing); anything else is a real fault.
      this.lastFailed = !(e instanceof DOMException && e.name === "AbortError");
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

  /** Reject a completion that just replays text already on screen.
   *  Repetitive input makes the model continue the pattern faithfully, which is
   *  correct behaviour and a useless suggestion — sampling cannot fix it because
   *  the loop is in the prefix, not the sampler. */
  private isEcho(text: string, prefix: string): boolean {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const t = norm(text);
    if (t.length < 8) return false;
    const tail = norm(prefix.slice(-400));
    if (tail.includes(t)) return true;
    // Also catch a suggestion that repeats itself: "X and X".
    const half = t.slice(0, Math.floor(t.length / 2)).trim();
    return half.length >= 8 && t.slice(half.length).includes(half);
  }
}
