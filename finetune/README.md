# Fine-tuning Ghostwriter on the vault

The stock model writes fluent generic prose — *"The story is about a young boy who is trying to
jump over a dog."* It has no idea how these notes sound. A LoRA fixes that, and it replaces the
retrieval idea from the original design: retrieval pays ~200 ms per keystroke to supply context a
fine-tune carries for free.

## Why MLX trains and Ollama serves

MLX **lost** the inference benchmark — ~1.5× slower than Ollama on 16-token completions, 20×
worse cold load. But llama.cpp has no comparable training path on Apple Silicon. So the pipeline
crosses over: train in MLX, fuse, export GGUF, serve in Ollama. Each does the half it is good at.

## Run it

```sh
python3 build_corpus.py --out data    # ~4,300 chunks, ~2.2M tokens
./train.sh                            # LoRA, 8 layers, ~600 iters
./deploy.sh                           # fuse -> GGUF -> ollama create ghostwriter-vault
```

Then set the model to `ghostwriter-vault` in Ghostwriter's settings. No code change.

## Privacy — read before running

- **Vanguard is never read.** Every path is asserted, not filtered: if the exclusion breaks, the
  script dies rather than quietly training on it. Chunks in other vaults that merely *mention*
  Vanguard are dropped too (69 of them).
- **`data/`, `adapters/`, `models/` and `*.gguf` are gitignored.** Weights trained on 2.2M tokens
  of personal notes *contain* those notes. This repo is public; the adapter is not. Never push it
  to HuggingFace.
- A held-out `valid.jsonl` and `test.jsonl` exist so adaptation can be told from memorisation.
  If validation loss diverges from training loss, it is memorising.

## What it should fix

1. **Vagueness** — `a smooth sauce` where the note says `double cream`
2. **House style** — `**bold lead-in.**` list items, `**Hub:** [[Home]]` footers, per-course LaTeX
3. **Wikilinks** — `[[` should complete to notes that exist, not invented ones
4. **Frontmatter** — the tag vocabulary is a closed set per vault and entirely learnable
