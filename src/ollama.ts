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
      const text = this.clean(data.response ?? "");
      if (!text || this.isEcho(text, prefix)) return null;
      return text;
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
    t = t.replace(/([.!?])[.!?]+$/, "$1");            // "Fox.." -> "Fox."
    if (!t.trim()) return null;
    if (!/[.!?:;,]$/.test(t)) t += ".";
    return t;
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
