"""Stage 62.1 — embedding client with truncate guard + L5 chunk aggregation.

Implements proposal §8.1 (frozen embedding spec):

  - POST {LLM_BASE_URL}/v1/embeddings, model `qwen3-embedding:4b`, auth header
    built from LLM_API_KEY (environment variables only; fail-fast when missing;
    zero credential literals in code).
  - EVERY request carries `"truncate": false`. Any non-200 response is FATAL
    (§13.5: vectors produced without the guard are void) — the exception
    propagates and NOTHING is written to the cache.
  - L5 long probes use deterministic chunk aggregation:
        chunk_size = 6000 chars, overlap = 0, mean pooling, post-pool L2 norm.
    Short probes (<= 6000 chars) are embedded as a single chunk, which is
    mathematically identical to the aggregation pipeline (mean of one vector,
    then L2 normalization).
  - Disk cache indexed by SHA-256 of the input text (artifacts/embeddings/).
    A cache hit issues no HTTP request.
  - Embedding metadata (model / endpoint / truncate / chunk_size / overlap /
    pooling / normalization) is persisted alongside every cached vector.

CLI:
    python embed.py <probes.json> <output.json> [--cache-dir DIR]

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

# --- Frozen protocol constants (§8.1) ---------------------------------------
MODEL_NAME = "qwen3-embedding:4b"
EMBEDDINGS_PATH = "/v1/embeddings"
CHUNK_SIZE = 6000
CHUNK_OVERLAP = 0
POOLING = "mean"
NORMALIZATION = "l2_post_pool"

ENV_BASE_URL = "LLM_BASE_URL"
ENV_API_KEY = "LLM_API_KEY"

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent / "artifacts" / "embeddings"
DEFAULT_TIMEOUT_SECONDS = 300


class FatalEmbeddingError(RuntimeError):
    """Non-200 gateway response or malformed payload.

    Fatal per §13.5: abort immediately; never write a cache entry for the
    failed input (no silently-truncated vector may enter the point cloud).
    """


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Deterministically split `text` into consecutive chunks.

    overlap is frozen at 0 by the protocol; any other value is rejected so the
    frozen hyperparameter cannot drift silently.
    """
    if overlap != CHUNK_OVERLAP:
        raise ValueError(f"chunk overlap is frozen at {CHUNK_OVERLAP} by the protocol (§8.1)")
    if chunk_size <= 0:
        raise ValueError(f"chunk_size must be positive, got {chunk_size}")
    if len(text) == 0:
        raise ValueError("cannot embed empty text")
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]


def pool_and_normalize(vectors: Sequence[Sequence[float]]) -> np.ndarray:
    """Mean-pool chunk vectors, then L2-normalize the pooled vector (§8.1)."""
    arr = np.asarray(vectors, dtype=np.float64)
    if arr.ndim != 2 or arr.shape[0] == 0:
        raise ValueError(f"expected a non-empty 2-D array of chunk vectors, got shape {arr.shape}")
    pooled = arr.mean(axis=0)
    norm = float(np.linalg.norm(pooled))
    if norm == 0.0:
        raise FatalEmbeddingError("pooled embedding has zero norm; cannot L2-normalize")
    return pooled / norm


class EmbeddingClient:
    """Embedding client enforcing the frozen §8.1 spec (see module docstring)."""

    def __init__(
        self,
        cache_dir: str | Path = DEFAULT_CACHE_DIR,
        *,
        session: Any = None,
        model: str = MODEL_NAME,
        chunk_size: int = CHUNK_SIZE,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        # Credentials: environment variables only, fail-fast (plan discipline #4).
        self.base_url = require_env(ENV_BASE_URL).rstrip("/")
        self._api_key = require_env(ENV_API_KEY)
        self.endpoint = self.base_url + EMBEDDINGS_PATH
        self.session = session if session is not None else requests.Session()
        self.cache_dir = Path(cache_dir)
        self.model = model
        self.chunk_size = chunk_size
        self.timeout = timeout

    # -- metadata -------------------------------------------------------------
    def run_metadata(self) -> dict[str, Any]:
        """Frozen embedding hyperparameters, persisted with every result."""
        return {
            "model": self.model,
            "endpoint": self.endpoint,
            "truncate": False,
            "chunk_size": self.chunk_size,
            "overlap": CHUNK_OVERLAP,
            "pooling": POOLING,
            "normalization": NORMALIZATION,
        }

    def text_metadata(self, n_chunks: int, text_chars: int) -> dict[str, Any]:
        meta = self.run_metadata()
        meta["n_chunks"] = n_chunks
        meta["text_chars"] = text_chars
        return meta

    # -- cache ----------------------------------------------------------------
    def cache_path(self, digest: str) -> Path:
        return self.cache_dir / f"{digest}.json"

    # -- HTTP -----------------------------------------------------------------
    def _embed_chunk(self, chunk: str) -> np.ndarray:
        payload = {"model": self.model, "input": chunk, "truncate": False}
        headers = {"Authorization": "Bearer " + self._api_key}
        resp = self.session.post(self.endpoint, json=payload, headers=headers, timeout=self.timeout)
        if resp.status_code != 200:
            body_preview = str(getattr(resp, "text", ""))[:200]
            raise FatalEmbeddingError(
                f"embedding gateway returned HTTP {resp.status_code} "
                f"(fatal per §13.5; nothing cached): {body_preview}"
            )
        body = resp.json()
        try:
            vec = body["data"][0]["embedding"]
        except (KeyError, IndexError, TypeError) as exc:
            raise FatalEmbeddingError(f"malformed embedding response payload: {exc!r}") from exc
        return np.asarray(vec, dtype=np.float64)

    # -- public API -----------------------------------------------------------
    def embed_text(self, text: str) -> np.ndarray:
        """Embed `text` with chunk aggregation; cache by SHA-256 of the text."""
        digest = sha256_text(text)
        cpath = self.cache_path(digest)
        if cpath.exists():
            record = read_json(cpath)
            return np.asarray(record["vector"], dtype=np.float64)

        chunks = chunk_text(text, self.chunk_size)
        # Any FatalEmbeddingError below propagates BEFORE the cache write.
        chunk_vectors = [self._embed_chunk(c) for c in chunks]
        vector = pool_and_normalize(chunk_vectors)

        record = {
            "sha256": digest,
            "metadata": self.text_metadata(n_chunks=len(chunks), text_chars=len(text)),
            "vector": vector.tolist(),
        }
        write_json_atomic(cpath, record)
        return vector


def main(argv: Sequence[str] | None = None, *, session: Any = None) -> int:
    parser = argparse.ArgumentParser(
        description="Embed granularity probes (frozen §8.1 spec; cache by SHA-256)."
    )
    parser.add_argument("probes", help="JSON array of {id, text} probe objects")
    parser.add_argument("output", help="output JSON path")
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    args = parser.parse_args(argv)

    probes = read_json(args.probes)
    client = EmbeddingClient(cache_dir=args.cache_dir, session=session)

    embeddings: dict[str, list[float]] = {}
    for probe in probes:
        embeddings[str(probe["id"])] = client.embed_text(probe["text"]).tolist()

    metadata = client.run_metadata()
    metadata["n_probes"] = len(probes)
    write_json_atomic(args.output, {"metadata": metadata, "embeddings": embeddings})
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
