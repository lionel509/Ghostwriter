#!/usr/bin/env python3
"""Build a LoRA training corpus from the Obsidian vaults.

Vanguard is personal and is NEVER included. That is asserted, not filtered:
if the exclusion ever stops working the script dies rather than quietly
training on it.
"""
from __future__ import annotations
import argparse, json, random, re, sys
from pathlib import Path

VAULTS = ["BlackRock", "State Street", "Berkshire", "Goldman", "Fidelity", "Citadel", "! Todo"]
FORBIDDEN = "Vanguard"
SKIP_DIRS = {".git", ".obsidian", ".trash", "node_modules", "Templates", "assets", ".venv"}
SKIP_SUFFIX = (".excalidraw.md",)


def iter_notes(root: Path):
    for vault in VAULTS:
        base = root / vault
        if not base.is_dir():
            print(f"  ! missing vault: {vault}", file=sys.stderr)
            continue
        for p in sorted(base.rglob("*.md")):
            if any(part in SKIP_DIRS or part.startswith(".") for part in p.relative_to(root).parts[:-1]):
                continue
            if p.name.endswith(SKIP_SUFFIX) or p.name == "CLAUDE.md":
                continue
            yield vault, p


def clean(text: str) -> str:
    # Excalidraw and other embedded blobs occasionally survive the filename check.
    text = re.sub(r"```json\n\{[\s\S]{2000,}?\n```", "", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def chunk(text: str, target_chars: int, overlap: int):
    """Split on blank lines, then pack paragraphs up to the window size.
    Overlap keeps a completion's context from always starting at a hard edge."""
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    out, cur = [], ""
    for p in paras:
        if len(cur) + len(p) + 2 > target_chars and cur:
            out.append(cur.strip())
            cur = cur[-overlap:] if overlap else ""
        cur += ("\n\n" if cur else "") + p
    if cur.strip():
        out.append(cur.strip())
    return [c for c in out if len(c) >= 120]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/Users/lionelweng/Documents")
    ap.add_argument("--out", default="data")
    ap.add_argument("--chars", type=int, default=2400, help="~600 tokens, close to inference num_ctx")
    ap.add_argument("--overlap", type=int, default=300)
    ap.add_argument("--valid-frac", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=17)
    a = ap.parse_args()

    root = Path(a.root)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    records, per_vault, dropped = [], {}, [0]
    for vault, path in iter_notes(root):
        rel = str(path.relative_to(root))
        assert FORBIDDEN not in rel, f"REFUSING: {FORBIDDEN} leaked into the corpus via {rel}"
        try:
            body = clean(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            continue
        cs = chunk(body, a.chars, a.overlap)
        # Editable vaults legitimately *mention* Vanguard (routing notes, "what
        # belongs there, not here" sections). Those are structure, not personal
        # content — but dropping them costs almost nothing, so drop them.
        kept = [c for c in cs if FORBIDDEN not in c]
        dropped[0] += len(cs) - len(kept)
        per_vault[vault] = per_vault.get(vault, 0) + len(kept)
        records.extend({"text": c} for c in kept)

    assert FORBIDDEN not in json.dumps(records), "REFUSING: forbidden text survived the filter"

    random.Random(a.seed).shuffle(records)
    n_valid = max(1, int(len(records) * a.valid_frac))
    splits = {"valid": records[:n_valid], "test": records[n_valid:n_valid * 2],
              "train": records[n_valid * 2:]}
    for name, rows in splits.items():
        with (out / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    chars = sum(len(r["text"]) for r in records)
    print(f"  {FORBIDDEN}: no file read from it (asserted on every path),")
    print(f"  and {dropped[0]} chunk(s) mentioning it dropped from the text.\n")
    for v, n in sorted(per_vault.items(), key=lambda kv: -kv[1]):
        print(f"  {v:14} {n:6,} chunks")
    print(f"\n  total          {len(records):6,} chunks  ~{chars//4:,} tokens")
    for name, rows in splits.items():
        print(f"  {name:14} {len(rows):6,}")
    print(f"\n  -> {out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
