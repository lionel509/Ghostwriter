#!/bin/bash
# LoRA fine-tune of Qwen3.5-2B-Base on the vault corpus.
#
# MLX is the right tool HERE and the wrong tool for inference — it lost to
# Ollama by ~1.5x on 16-token completions, but llama.cpp has no comparable
# training path on Apple Silicon. Train in MLX, serve in Ollama.
set -euo pipefail
cd "$(dirname "$0")"

VENV="${MLX_VENV:-/private/tmp/claude-501/-Users-lionelweng-Documents/ed7f4a85-be0b-4507-8b92-a745bc0cc413/scratchpad/mlxenv/bin}"
MODEL="${MODEL:-./models/qwen35-2b-base-4bit}"
ITERS="${ITERS:-600}"

[ -f data/train.jsonl ] || { echo "No corpus. Run: python3 build_corpus.py --out data"; exit 1; }

"$VENV/python" -m mlx_lm lora \
  --model "$MODEL" \
  --train \
  --data data \
  --iters "$ITERS" \
  --batch-size 1 \
  --num-layers 8 \
  --max-seq-length 1024 \
  --learning-rate 1e-5 \
  --steps-per-report 25 \
  --steps-per-eval 100 \
  --adapter-path adapters \
  --save-every 200

echo
echo "Adapter written to ./adapters — validation loss above is the number that matters."
echo "Compare it against the pre-training baseline printed at iter 0."
