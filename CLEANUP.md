# Cleanup — `lionel509/Ghostwriter`

Teardown for this checkout. **Ghostwriter** is an Obsidian plugin (TypeScript →
esbuild → `main.js`, installed into a vault by `install.mjs`) plus `finetune/`,
an MLX LoRA pipeline that trains on the vault corpus and serves through Ollama.
The heavy things it creates are either already ignored (`node_modules/`,
`main.js`, `finetune/{data,adapters*,models}`, `*.gguf`) or live **outside** the
repo (the vault install, the Ollama store, the vault itself).

## ⚠ What must NOT be cleaned

| Path | Why it stays |
| --- | --- |
| `Ghostwriter — Project Hub.md`, and any future `— *.md` hub note | **gitignored hub notes.** Ignored is not disposable: the clean commands below carry `-e '!/*— *.md'` so they survive. |
| `package.json`, `package-lock.json` | manifest + lockfile — the lockfile in particular is never ignored |
| `src/`, `manifest.json`, `styles.css`, `esbuild.config.mjs`, `tsconfig.json` | source and plugin metadata. Note `main.js` **is** ignored (build output) while `manifest.json`/`styles.css` are tracked — that asymmetry is intentional. |
| `finetune/.gitignore` | the nested rules (`data/`, `adapters*/`, `models/`, `*.gguf`) plus this file's Python blocks are what keep 2.2M tokens of personal notes and the weights trained on them out of git |
| `finetune/{build_corpus.py,train.sh,deploy.sh,compare*.py,README.md}` | the pipeline itself |

`git clean -fdX` cannot touch any of them (none are ignored). Do **not** replace
`finetune/.gitignore`'s `data/` with a broader rule that could ever un-ignore it —
weights trained on the vault *contain* the vault (`finetune/README.md`,
**Privacy**).

## What this project leaves behind

| Path / thing | Created by | Size note |
| --- | --- |---|
| `node_modules/` | `npm install` (dev deps: esbuild, typescript, obsidian, @codemirror) | ~30–80 MB |
| `main.js` | `npm run build` / `npm run install-local` (`esbuild.config.mjs`, `outfile: "main.js"`) | ~100s of KB — ignored, rebuilt on demand |
| `.tsbuildinfo` | `tsc` if ever run without `--noEmit` (`npm run typecheck` passes `--noEmit`) | KBs |
| `.DS_Store`, `.idea/`, `.vscode/`, `*.swp`, `*~` | editors / macOS | bytes |
| `.env`, `.env.*` | hand-made; `install.mjs` reads `OBSIDIAN_VAULT` from the environment, so an env file is an easy local habit. Nothing here needs a key. | bytes |
| `__pycache__/`, `.venv/`, `venv/`, `.pytest_cache/`, `.coverage` | `python3 finetune/build_corpus.py`, `compare.py`, `compare2.py` — there is no Python venv in this repo by design (`train.sh` uses `$MLX_VENV`) | KBs–MBs |
| `.claude/settings.local.json` | Claude Code | bytes |
| `finetune/data/`, `finetune/adapters*/`, `finetune/models/`, `*.gguf` | `build_corpus.py --out data`, `train.sh` (`--adapter-path adapters`), `deploy.sh` (`./models/fused`), and the base weights `finetune/models/qwen35-2b-base-4bit` — **already covered by `finetune/.gitignore`** | GBs: the corpus is ~2.2M tokens, the weights are weights |
| `graphify-out/` | `graphify update .` — already covered by the root rules | MBs |

## Preview

```bash
git clean -ndX -e '!.env' -e '!.env.*' -e '!/*— *.md'
```

## Clean the repo

```bash
git clean -fdX -e '!.env' -e '!.env.*' -e '!/*— *.md'
```

The three `-e` flags are load-bearing: the first two keep credentials, the third
keeps the gitignored hub notes — without it a hub note is ignored-and-deleted in
one shot. `finetune/.gitignore`'s own rules are honoured by the same pass (nested
`.gitignore` files apply to `git clean`).

```bash
git status --short           # no tracked file modified or deleted
git ls-files -ci --exclude-standard   # must print nothing
```

To rebuild afterwards: `npm install && npm run build` (or `npm run install-local`
to push `main.js` into a vault). The corpus and weights are **not** rebuildable
from this repo — `python3 finetune/build_corpus.py --out data` re-reads the vault
and `./train.sh` retrains from scratch, so only wipe `finetune/data/` and
`finetune/adapters*/` if you mean to give them up.

## Outside the repo

**The installed plugin — inside your Obsidian vault** (`install.mjs` default
vault `/Users/lionelweng/Documents/BlackRock`):

```bash
ls -la "${OBSIDIAN_VAULT:-$HOME/Documents/BlackRock}/.obsidian/plugins/ghostwriter" 2>/dev/null
rm -rf "${OBSIDIAN_VAULT:-$HOME/Documents/BlackRock}/.obsidian/plugins/ghostwriter"
```

Removing it disables Ghostwriter in that vault; the source of truth stays in
`src/` and `npm run install-local` puts it back. Only do this if you mean to
uninstall the plugin.

**Ollama's model store — shared with every model you have pulled:**

```bash
ollama list                                    # preview
ollama rm ghostwriter-vault                    # this project's fused model, if created
ollama rm qwen3:0.6b                           # the base model — shared, optional
du -sh ~/.ollama 2>/dev/null                   # the whole store; do NOT blanket-delete
```

`~/.ollama` is shared: other tools and other models live there. Remove models by
name, never the directory.

**The vault the corpus is built from** — `build_corpus.py --root`
(default `/Users/lionelweng/Documents`). It is *read*, never written. **Do not
clean it**; it is the notes themselves.

**The MLX venv** — `train.sh`/`deploy.sh` default `MLX_VENV` to
`/private/tmp/claude-501/…/scratchpad/mlxenv/bin`, a path from an old scratchpad
session that no longer exists on a fresh machine. If it does still exist on this
one:

```bash
echo "${MLX_VENV:-/private/tmp/claude-501/…/scratchpad/mlxenv/bin}"
rm -rf "${MLX_VENV:-/private/tmp/claude-501/…/scratchpad/mlxenv}"   # only if it's yours
```

Because it lives in a scratchpad, it disappears with that scratchpad anyway — and
it is **outside** this repo either way. Consider pointing `MLX_VENV` at a
persistent path before the next train.

**npm's cache** — shared with every node project:

```bash
npm cache verify          # preview
npm cache clean --force   # shared — optional
```

**Nothing else outside the repo.** No Playwright browsers, no Docker images, no
launchd plists, no Hugging Face cache (`train.sh` loads
`./models/qwen35-2b-base-4bit` from inside `finetune/models/`, not from a hub
cache).

## Secrets

`.env`, `.env.*`, `*.key`, `*.pem`, `credentials.json` and `secrets.json` are
ignored and **kept** by every command above — the `-e '!.env' -e '!.env.*'` flags
exist for this. This plugin takes no API key at all (it is local-Ollama by
design), so an env file here would only be a vault path.

To remove one by hand:

```bash
rm -f .env .env.local
```

If a secret is ever *tracked* in git, revoke it upstream first and open an issue —
never just delete the file.
