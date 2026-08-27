import { SAMPLING, type GhostwriterSettings } from "./settings";

export class OllamaClient {
  private inFlight: AbortController | null = null;

  constructor(private settings: GhostwriterSettings) {}

  /** Cancel whatever is in the air. Called on every keystroke — a completion
   *  for a prefix the user has already moved past is worthless. */
  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
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
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: string };
      return this.clean(data.response ?? "");
    } catch {
      return null; // aborted, or Ollama is not running
    } finally {
      if (this.inFlight === ac) this.inFlight = null;
    }
  }

  /** The stop sequences strip the terminator, and markdown delimiters from the
   *  prefix leak into the completion ("a special dish.**"). Put the sentence
   *  back, and do not double-punctuate. */
  private clean(raw: string): string | null {
    let t = raw.replace(/[\r\n]+$/, "").replace(/(\*\*|__|\*|_|`)+$/, "").trimEnd();
    if (!t.trim()) return null;
    if (!/[.!?:;,]$/.test(t)) t += ".";
    return t;
  }
}
