export interface GhostwriterSettings {
  endpoint: string;
  model: string;
  /** ms of quiet after the last keystroke before a request goes out. */
  debounceMs: number;
  /** Characters of note text sent as the prefix. ~500 is the measured floor;
   *  a one-sentence prefix degrades output badly. */
  prefixChars: number;
  /** Vaults are opt-in. Never enable this in a vault you would not send to a
   *  process outside Obsidian — and it must stay off in Vanguard. */
  enabled: boolean;
  /** Folders (vault-relative prefixes) that never get completions. */
  blockedFolders: string[];
}

export const DEFAULT_SETTINGS: GhostwriterSettings = {
  endpoint: "http://localhost:11434",
  model: "qwen3:0.6b",
  debounceMs: 350,
  prefixChars: 500,
  enabled: false,
  blockedFolders: [],
};

/** Measured on an M2 Pro: repeat_penalty 1.05 suppresses the prose repetition
 *  loops while keeping 5/5 on a polar-substitution integral. 1.18 drops that to
 *  3/5 — maths needs to repeat tokens (r, \theta, dr, d\theta). Do not raise it.
 *  The stop list ends generation at the sentence boundary, which is both the
 *  behaviour we want and the reason prose lands in 27-85ms. */
export const SAMPLING = {
  num_predict: 24,
  temperature: 0.3,
  repeat_penalty: 1.05,
  top_p: 0.9,
  num_ctx: 1024,
  stop: ["\n", ". ", ".\n", "! ", "? "],
} as const;
