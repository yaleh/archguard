"""Stage 70.2 — S-code sensor: code-specialised embedding (plan §Stage 70.2).

Identical to embed.py in structure, but uses a different model (nomic-embed-text
by default) with a pre-registered fallback chain:

  nomic-embed-text → mxbai-embed-large → text-embedding-3-small

Availability must be verified before this script runs (plan §Stage 70.2
pre-requisite); the actual model used is recorded in artifacts/embeddings/
s-code-availability.txt.

CLI:
    python embed_code.py <probes.json> <output.json> [--cache-dir DIR] [--model MODEL]

  where probes.json is a JSON array of {"id": str, "text": str} objects and
  output.json receives {"metadata": {...}, "embeddings": {id: [floats]}}.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import requests

from lib_py.common import read_json, require_env, sha256_text, write_json_atomic

# Pre-registered fallback chain (plan §Stage 70.2)
MODEL_FALLBACK_CHAIN = [
    "nomic-embed-text",
    "mxbai-embed-large",
    "text-embedding-3-small",
]
DEFAULT_MODEL = MODEL_FALLBACK_CHAIN[0]

EMBEDDINGS_PATH = "/v1/embeddings"
CHUNK_SIZE = 6000
CHUNK_OVERLAP = 0
POOLING = "mean"
NORMALIZATION = "l2_post_pool"

ENV_BASE_URL = "LLM_BASE_URL"
ENV_API_KEY = "LLM_API_KEY"

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent / "artifacts" / "embeddings"
DEFAULT_TIMEOUT_SECONDS = 300

AVAILABILITY_FILE = Path(__file__).resolve().parent / "artifacts" / "embeddings" / "s-code-availability.txt"


class FatalEmbeddingError(RuntimeError):
    pass


def _l2_norm(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def check_model_availability(base_url: str, api_key: str, timeout: float = 10.0) -> str:
    """Try each model in the fallback chain; return first that responds 200."""
    url = base_url.rstrip("/") + EMBEDDINGS_PATH
    headers = {"content-type": "application/json", "authorization": f"Bearer {api_key}"}
    for model in MODEL_FALLBACK_CHAIN:
        try:
            r = requests.post(
                url,
                json={"model": model, "input": "test", "truncate": False},
                headers=headers,
                timeout=timeout,
            )
            if r.status_code == 200:
                return model
        except Exception:
            continue
    raise RuntimeError(
        "No model in S-code fallback chain responded OK. "
        "Check LiteLLM gateway connectivity."
    )


def _embed_chunk(text: str, model: str, base_url: str, api_key: str, timeout: float) -> list[float]:
    url = base_url.rstrip("/") + EMBEDDINGS_PATH
    headers = {"content-type": "application/json", "authorization": f"Bearer {api_key}"}
    r = requests.post(
        url,
        json={"model": model, "input": text, "truncate": False},
        headers=headers,
        timeout=timeout,
    )
    if r.status_code != 200:
        raise FatalEmbeddingError(f"HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    return data["data"][0]["embedding"]


def embed_text(
    text: str,
    *,
    model: str,
    base_url: str,
    api_key: str,
    cache_dir: Path,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> list[float]:
    """Embed text with SHA-256 disk cache (model-namespaced)."""
    cache_key = sha256_text(f"model={model}\n{text}")
    cache_file = cache_dir / f"{cache_key}.json"
    if cache_file.exists():
        return read_json(cache_file)["embedding"]

    # Chunk if needed
    chunks = [text[i : i + CHUNK_SIZE] for i in range(0, max(len(text), 1), CHUNK_SIZE)] if len(text) > CHUNK_SIZE else [text]
    vecs = [_embed_chunk(c, model, base_url, api_key, timeout) for c in chunks]
    agg = np.mean(vecs, axis=0)
    normed = _l2_norm(agg).tolist()

    cache_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(cache_file, {
        "model": model,
        "chunk_count": len(chunks),
        "embedding": normed,
    })
    return normed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="S-code embeddings (Stage 70.2).")
    parser.add_argument("probes", help="JSON array of {id, text}")
    parser.add_argument("output", help="Output JSON path")
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    parser.add_argument("--model", default=None, help="Override model (skip availability check)")
    args = parser.parse_args(argv)

    base_url = require_env(ENV_BASE_URL)
    api_key = require_env(ENV_API_KEY)
    cache_dir = Path(args.cache_dir) / "s-code"

    if args.model:
        model = args.model
        availability_note = f"manually specified: {model}"
    else:
        print("Checking S-code model availability...", file=sys.stderr)
        model = check_model_availability(base_url, api_key)
        availability_note = f"first available in fallback chain: {model}"
        AVAILABILITY_FILE.parent.mkdir(parents=True, exist_ok=True)
        AVAILABILITY_FILE.write_text(
            f"sensor: S-code\nmodel: {model}\nfallback_chain: {MODEL_FALLBACK_CHAIN}\nnote: {availability_note}\n",
            encoding="utf-8",
        )
        print(f"S-code model: {model}", file=sys.stderr)

    probes = read_json(args.probes)
    embeddings: dict[str, list[float]] = {}
    for probe in probes:
        pid = probe["id"]
        text = probe["text"]
        print(f"  Embedding {pid}...", file=sys.stderr)
        embeddings[pid] = embed_text(text, model=model, base_url=base_url, api_key=api_key, cache_dir=cache_dir)

    write_json_atomic(args.output, {
        "sensor": "S-code",
        "model": model,
        "availability_note": availability_note,
        "embeddings": embeddings,
        "metadata": {
            "chunk_size": CHUNK_SIZE,
            "pooling": POOLING,
            "normalization": NORMALIZATION,
        },
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
