#!/bin/bash
# Fuse the LoRA into the base weights, convert to GGUF, and register with Ollama
# so the plugin can use it with no code change — only a model name in settings.
set -euo pipefail
cd "$(dirname "$0")"

VENV="${MLX_VENV:-/private/tmp/claude-501/-Users-lionelweng-Documents/ed7f4a85-be0b-4507-8b92-a745bc0cc413/scratchpad/mlxenv/bin}"
NAME="${NAME:-ghostwriter-vault}"

[ -d adapters ] || { echo "No adapters/. Run ./train.sh first."; exit 1; }

# NOTE: mlx_lm cannot export this architecture to GGUF —
#   ValueError: Model type qwen3_5 not supported for GGUF conversion
# so the MLX -> Ollama handoff does not work for Qwen3.5 yet. The fuse still
# produces a usable MLX model; serve it with mlx_lm.server (OpenAI-compatible)
# until llama.cpp/mlx gain qwen3_5 GGUF support, or retrain on an architecture
# that converts (Qwen3, Llama 3.2).
echo "1/2 fusing adapter into base weights (MLX format, no GGUF)"
"$VENV/python" -m mlx_lm fuse \
  --model ./models/qwen35-2b-base-4bit \
  --adapter-path adapters \
  --save-path ./models/fused

echo "2/2 serve it with:"
echo "  $VENV/python -m mlx_lm server --model ./models/fused --port 8080"
echo "  then point Ghostwriter at http://localhost:8080 (OpenAI-compatible)"
exit 0

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
