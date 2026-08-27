#!/bin/bash
# Fuse the LoRA into the base weights, convert to GGUF, and register with Ollama
# so the plugin can use it with no code change — only a model name in settings.
set -euo pipefail
cd "$(dirname "$0")"

VENV="${MLX_VENV:-/private/tmp/claude-501/-Users-lionelweng-Documents/ed7f4a85-be0b-4507-8b92-a745bc0cc413/scratchpad/mlxenv/bin}"
NAME="${NAME:-ghostwriter-vault}"

[ -d adapters ] || { echo "No adapters/. Run ./train.sh first."; exit 1; }

echo "1/3 fusing adapter into base weights"
"$VENV/python" -m mlx_lm fuse \
  --model ./models/qwen35-2b-base-4bit \
  --adapter-path adapters \
  --save-path ./models/fused \
  --export-gguf --gguf-path ./models/fused/ggml-model-f16.gguf

echo "2/3 writing Modelfile"
cat > models/Modelfile <<MF
FROM ./fused/ggml-model-f16.gguf
PARAMETER num_ctx 1024
PARAMETER temperature 0.3
PARAMETER repeat_penalty 1.05
PARAMETER top_p 0.9
PARAMETER stop "
"
MF

echo "3/3 registering with ollama as '$NAME'"
( cd models && ollama create "$NAME" -f Modelfile )

echo
echo "Done. Set the model to '$NAME' in Ghostwriter's settings."
echo "This model contains the vault. Do not push it anywhere."
