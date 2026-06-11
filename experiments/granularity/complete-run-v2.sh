#!/usr/bin/env bash
# Stage 71.3 → 72.2 completion pipeline.
# Run this once artifacts/runs-v2/calls/ reaches 2640 files.
# Credentials must be set in environment: LLM_BASE_URL, LLM_API_KEY.
set -euo pipefail

: "${LLM_BASE_URL:?LLM_BASE_URL must be set}"
: "${LLM_API_KEY:?LLM_API_KEY must be set}"

cd "$(dirname "$0")"
RUNS_DIR="artifacts/runs-v2"
EMBEDS="artifacts/embeddings/dim-input.json"

echo "=== Stage 71.3: score ==="
npx tsx score.ts \
  --tasks tasks/v2-tasks.json \
  --run-dir "$RUNS_DIR" \
  --out "$RUNS_DIR/scores-v2.json" \
  --oracle-out "$RUNS_DIR/p-oracle-v2.json"

echo "=== Stage 72.1: analyze ==="
python analyze_v2.py \
  --scores "$RUNS_DIR/scores-v2.json" \
  --predictions artifacts/predictions/predictions-v2-20260611T142416Z.json \
  --dim-lm-real artifacts/embeddings/dim-lm-real-results.json \
  --dim-struct artifacts/embeddings/dim-struct-results.json \
  --phase0 artifacts/embeddings/dim-phase0.json \
  -o "$RUNS_DIR/analysis-v2.json"

echo "=== Stage 72.2: linear probe (post-hoc) ==="
python probe_linear.py \
  --embeddings "$EMBEDS" \
  --p-oracle "$RUNS_DIR/p-oracle-v2.json" \
  -o "$RUNS_DIR/p-probe-v2.json"

echo "=== Done. Outputs ==="
ls -lh "$RUNS_DIR"/scores-v2.json "$RUNS_DIR"/analysis-v2.json "$RUNS_DIR"/p-probe-v2.json "$RUNS_DIR"/p-oracle-v2.json
