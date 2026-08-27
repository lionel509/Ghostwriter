# Ghostwriter

Copilot-style inline completion for Obsidian. A local model finishes the sentence in grey text;
Tab accepts, Esc dismisses. No cloud, no API key, nothing leaves the machine.

Unlike a word-list completer, it completes *sentences* — and it gets LaTeX right:

```
To find Rth you            →  must first find the resistance of the network.
(2r\cos\theta+             →  r\sin\theta)\, dr\, d\theta
it stops the cooking and   →  the water runs clear.
```

## Requirements

[Ollama](https://ollama.com) running locally, with one model:

```sh
ollama pull qwen3:0.6b        # 666 MB resident, 27-118 ms per completion
```

Ollama also pulls GGUF straight from HuggingFace, so its tag list is not the menu:

```sh
ollama pull hf.co/<user>/<repo>-GGUF
```

## Install

```sh
npm install
npm run install-local                      # installs into $OBSIDIAN_VAULT
OBSIDIAN_VAULT=/path/to/vault npm run install-local
```

Then enable it in **Settings → Community plugins**, and turn it on per vault in
**Settings → Ghostwriter**. It is **off by default** — see Privacy.

## Privacy

Every completion sends a window of the current note to the model endpoint. That endpoint is
local by default, but the plugin still ships **disabled**, opts in **per vault**, and supports a
folder blocklist. Do not enable it in a vault whose contents should not leave the editor.

## How it stays fast

Most keystrokes make **no request at all**. If you type what the model predicted, the ghost text
trims the accepted characters client-side and re-renders — zero network, zero latency. That
prefix-advancement path, not the model, is most of the perceived speed.

The rest: cancel in flight on every keystroke, debounce into the pause you were taking anyway,
stop at the sentence boundary rather than a token budget, and keep the model pinned
(`keep_alive: -1`) so no completion ever pays a cold load.

## Settings that were measured, not guessed

| Setting | Value | Why |
|---|---|---|
| `repeat_penalty` | **1.05** | Kills prose repetition loops. At 1.18 the maths breaks (3/5 vs 5/5) — LaTeX must repeat `r`, `\theta`, `dr`. |
| `stop` | sentence enders | Finishes the sentence and stops. Also why prose lands in 27-85 ms. |
| `raw` | `true` | Bypasses the chat template. Not an optimisation — with the template applied to a bare prefix the model returns `""`. |
| `num_ctx` | 1024 | Smaller *and* faster than the 4096 default. |
| prefix | ~500 chars | A one-sentence prefix degrades output badly. |

## Coexisting with Completr

Both can be enabled. Ghost text is suppressed whenever a completion popup is open
(`completionStatus(state) !== null`), so only one owns Tab at a time. Completr keeps its 1085
curated LaTeX commands, which a 0.6B model will not beat.

## Licence

MIT
