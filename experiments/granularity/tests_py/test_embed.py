"""Stage 62.1 tests — embed.py (mock HTTP only; never hits a real gateway).

Pre-registered coverage (plan Stage 62.1):
  - chunk aggregation determinism (same long text twice → bitwise-identical);
  - chunk boundaries at exactly 6000 / 6001 chars;
  - mean pooling + post-pool L2 numeric correctness (hand-computed example);
  - non-200 response is fatal and writes NOTHING to the cache;
  - every request body carries "truncate": false;
  - missing environment variables fail fast;
  - cache hit issues no HTTP request.
"""

from __future__ import annotations

import hashlib
import json
import math

import numpy as np
import pytest

import embed
from embed import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    EmbeddingClient,
    FatalEmbeddingError,
    chunk_text,
    pool_and_normalize,
)
from lib_py.common import MissingEnvError, sha256_text

# ---------------------------------------------------------------------------
# Fakes (no real HTTP, no real credentials — values below are test fixtures)
# ---------------------------------------------------------------------------
FAKE_BASE_URL = "http://gateway.invalid:4000"
FAKE_KEY = "unit-test-placeholder"  # not a real credential


def _hash_embed(text: str) -> list[float]:
    """Deterministic fake embedding derived from the chunk content."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [b / 255.0 + 0.001 for b in digest[:8]]


class FakeResponse:
    def __init__(self, status_code: int, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, embed_fn=_hash_embed, status_code: int = 200, payload_override=None):
        self.embed_fn = embed_fn
        self.status_code = status_code
        self.payload_override = payload_override
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if self.status_code != 200:
            return FakeResponse(self.status_code, text="upstream error")
        if self.payload_override is not None:
            return FakeResponse(200, self.payload_override)
        return FakeResponse(200, {"data": [{"embedding": self.embed_fn(json["input"])}]})


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", FAKE_BASE_URL)
    monkeypatch.setenv("LLM_API_KEY", FAKE_KEY)


def make_client(tmp_path, session, **kwargs) -> EmbeddingClient:
    return EmbeddingClient(cache_dir=tmp_path / "cache", session=session, **kwargs)


# ---------------------------------------------------------------------------
# chunk_text — frozen chunking rules
# ---------------------------------------------------------------------------
class TestChunkText:
    def test_exactly_6000_chars_is_one_chunk(self):
        chunks = chunk_text("x" * 6000)
        assert len(chunks) == 1
        assert len(chunks[0]) == 6000

    def test_6001_chars_is_two_chunks(self):
        chunks = chunk_text("x" * 6001)
        assert [len(c) for c in chunks] == [6000, 1]

    def test_chunks_reassemble_to_original(self):
        text = "abcdef" * 3000  # 18000 chars → 3 chunks
        chunks = chunk_text(text)
        assert len(chunks) == 3
        assert "".join(chunks) == text

    def test_short_text_is_single_chunk(self):
        assert chunk_text("hello") == ["hello"]

    def test_nonzero_overlap_rejected_frozen_protocol(self):
        with pytest.raises(ValueError, match="frozen"):
            chunk_text("x" * 10, overlap=100)

    def test_empty_text_rejected(self):
        with pytest.raises(ValueError, match="empty"):
            chunk_text("")

    def test_nonpositive_chunk_size_rejected(self):
        with pytest.raises(ValueError, match="positive"):
            chunk_text("abc", chunk_size=0)

    def test_frozen_constants(self):
        assert CHUNK_SIZE == 6000
        assert CHUNK_OVERLAP == 0


# ---------------------------------------------------------------------------
# pool_and_normalize — mean + post-pool L2 (hand-computed)
# ---------------------------------------------------------------------------
class TestPoolAndNormalize:
    def test_hand_computed_mean_then_l2(self):
        # mean([1,0],[0,1]) = [0.5,0.5]; L2 → [1/√2, 1/√2]
        out = pool_and_normalize([[1.0, 0.0], [0.0, 1.0]])
        expected = np.array([1.0, 1.0]) / math.sqrt(2.0)
        np.testing.assert_allclose(out, expected, rtol=0, atol=1e-15)

    def test_single_vector_is_just_l2_normalized(self):
        out = pool_and_normalize([[3.0, 4.0]])
        np.testing.assert_allclose(out, [0.6, 0.8], atol=1e-15)

    def test_output_is_unit_norm(self):
        out = pool_and_normalize([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 10.0]])
        assert math.isclose(float(np.linalg.norm(out)), 1.0, rel_tol=1e-12)

    def test_zero_pooled_vector_is_fatal(self):
        with pytest.raises(FatalEmbeddingError, match="zero norm"):
            pool_and_normalize([[1.0, -1.0], [-1.0, 1.0]])

    def test_bad_shape_rejected(self):
        with pytest.raises(ValueError):
            pool_and_normalize([])


# ---------------------------------------------------------------------------
# EmbeddingClient — env fail-fast, truncate guard, fatal non-200, cache
# ---------------------------------------------------------------------------
class TestEnvFailFast:
    def test_missing_base_url(self, monkeypatch, tmp_path):
        monkeypatch.delenv("LLM_BASE_URL", raising=False)
        monkeypatch.setenv("LLM_API_KEY", FAKE_KEY)
        with pytest.raises(MissingEnvError, match="LLM_BASE_URL"):
            make_client(tmp_path, FakeSession())

    def test_missing_api_key(self, monkeypatch, tmp_path):
        monkeypatch.setenv("LLM_BASE_URL", FAKE_BASE_URL)
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        with pytest.raises(MissingEnvError, match="LLM_API_KEY"):
            make_client(tmp_path, FakeSession())


class TestRequestContract:
    def test_every_request_carries_truncate_false(self, env, tmp_path):
        session = FakeSession()
        client = make_client(tmp_path, session)
        client.embed_text("y" * 13000)  # 3 chunks → 3 requests
        assert len(session.calls) == 3
        for call in session.calls:
            assert "truncate" in call["json"]
            assert call["json"]["truncate"] is False

    def test_endpoint_model_and_auth_header_from_env(self, env, tmp_path):
        session = FakeSession()
        client = make_client(tmp_path, session)
        client.embed_text("short text")
        call = session.calls[0]
        assert call["url"] == FAKE_BASE_URL + "/v1/embeddings"
        assert call["json"]["model"] == "qwen3-embedding:4b"
        assert call["headers"]["Authorization"] == "Bearer " + FAKE_KEY

    def test_run_metadata_persists_frozen_hyperparameters(self, env, tmp_path):
        client = make_client(tmp_path, FakeSession())
        meta = client.run_metadata()
        assert meta["model"] == "qwen3-embedding:4b"
        assert meta["endpoint"].endswith("/v1/embeddings")
        assert meta["truncate"] is False
        assert meta["chunk_size"] == 6000
        assert meta["overlap"] == 0
        assert meta["pooling"] == "mean"
        assert meta["normalization"] == "l2_post_pool"


class TestFatalNon200:
    def test_non_200_raises_fatal_and_writes_nothing(self, env, tmp_path):
        session = FakeSession(status_code=500)
        client = make_client(tmp_path, session)
        with pytest.raises(FatalEmbeddingError, match="HTTP 500"):
            client.embed_text("z" * 9000)
        assert not client.cache_dir.exists() or list(client.cache_dir.iterdir()) == []

    def test_malformed_payload_is_fatal_and_uncached(self, env, tmp_path):
        session = FakeSession(payload_override={"data": []})
        client = make_client(tmp_path, session)
        with pytest.raises(FatalEmbeddingError, match="malformed"):
            client.embed_text("some text")
        assert not client.cache_dir.exists() or list(client.cache_dir.iterdir()) == []


class TestAggregationAndCache:
    def test_chunk_aggregation_deterministic_bitwise(self, env, tmp_path):
        """Same long text, two independent clients/caches → bitwise identical."""
        text = "deterministic?" * 1000  # 14000 chars → 3 chunks
        v1 = EmbeddingClient(cache_dir=tmp_path / "c1", session=FakeSession()).embed_text(text)
        v2 = EmbeddingClient(cache_dir=tmp_path / "c2", session=FakeSession()).embed_text(text)
        assert v1.tobytes() == v2.tobytes()  # bitwise, not just allclose

    def test_hand_computed_two_chunk_aggregation(self, env, tmp_path):
        """chunk_size=4 over 8 chars: embed('aaaa')=[1,0], embed('bbbb')=[0,1]."""
        table = {"aaaa": [1.0, 0.0], "bbbb": [0.0, 1.0]}
        session = FakeSession(embed_fn=lambda t: table[t])
        client = make_client(tmp_path, session, chunk_size=4)
        out = client.embed_text("aaaabbbb")
        np.testing.assert_allclose(out, np.array([1.0, 1.0]) / math.sqrt(2.0), atol=1e-15)

    def test_short_text_single_chunk_equals_l2_of_raw(self, env, tmp_path):
        session = FakeSession(embed_fn=lambda t: [3.0, 4.0])
        client = make_client(tmp_path, session)
        np.testing.assert_allclose(client.embed_text("tiny"), [0.6, 0.8], atol=1e-15)

    def test_cache_hit_issues_no_http_request(self, env, tmp_path):
        session = FakeSession()
        client = make_client(tmp_path, session)
        text = "cache me " * 50
        v1 = client.embed_text(text)
        n_after_first = len(session.calls)
        v2 = client.embed_text(text)
        assert len(session.calls) == n_after_first  # no new requests
        np.testing.assert_array_equal(v1, v2)

    def test_cache_file_keyed_by_sha256_with_metadata(self, env, tmp_path):
        session = FakeSession()
        client = make_client(tmp_path, session)
        text = "w" * 6001
        client.embed_text(text)
        cpath = client.cache_path(sha256_text(text))
        assert cpath.exists()
        record = json.loads(cpath.read_text(encoding="utf-8"))
        assert record["sha256"] == sha256_text(text)
        assert record["metadata"]["truncate"] is False
        assert record["metadata"]["n_chunks"] == 2
        assert record["metadata"]["text_chars"] == 6001
        assert record["metadata"]["pooling"] == "mean"

    def test_cache_survives_across_client_instances(self, env, tmp_path):
        text = "persisted text"
        c1 = EmbeddingClient(cache_dir=tmp_path / "cc", session=FakeSession())
        v1 = c1.embed_text(text)
        fresh_session = FakeSession()
        c2 = EmbeddingClient(cache_dir=tmp_path / "cc", session=fresh_session)
        v2 = c2.embed_text(text)
        assert fresh_session.calls == []  # served entirely from disk
        np.testing.assert_array_equal(v1, v2)


# ---------------------------------------------------------------------------
# CLI main()
# ---------------------------------------------------------------------------
class TestMain:
    def test_main_embeds_probes_and_writes_output(self, env, tmp_path):
        probes = [{"id": "a1", "text": "alpha " * 10}, {"id": "a2", "text": "beta " * 2000}]
        probes_path = tmp_path / "probes.json"
        probes_path.write_text(json.dumps(probes), encoding="utf-8")
        out_path = tmp_path / "out.json"

        rc = embed.main(
            [str(probes_path), str(out_path), "--cache-dir", str(tmp_path / "cache")],
            session=FakeSession(),
        )
        assert rc == 0
        result = json.loads(out_path.read_text(encoding="utf-8"))
        assert set(result["embeddings"].keys()) == {"a1", "a2"}
        assert result["metadata"]["truncate"] is False
        assert result["metadata"]["n_probes"] == 2
        norm = np.linalg.norm(result["embeddings"]["a2"])
        assert math.isclose(float(norm), 1.0, rel_tol=1e-12)
