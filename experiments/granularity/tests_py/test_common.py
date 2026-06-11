"""Tests for lib_py.common (shared helpers, plan 59-66 discipline #4)."""

from __future__ import annotations

import json

import pytest

from lib_py.common import (
    MissingEnvError,
    load_table,
    read_json,
    require_env,
    sha256_text,
    write_json_atomic,
)


class TestRequireEnv:
    def test_returns_value_when_set(self, monkeypatch):
        monkeypatch.setenv("GRANULARITY_TEST_VAR", "some-value")
        assert require_env("GRANULARITY_TEST_VAR") == "some-value"

    def test_missing_raises_fail_fast(self, monkeypatch):
        monkeypatch.delenv("GRANULARITY_TEST_VAR", raising=False)
        with pytest.raises(MissingEnvError, match="GRANULARITY_TEST_VAR"):
            require_env("GRANULARITY_TEST_VAR")

    def test_empty_string_counts_as_missing(self, monkeypatch):
        monkeypatch.setenv("GRANULARITY_TEST_VAR", "")
        with pytest.raises(MissingEnvError):
            require_env("GRANULARITY_TEST_VAR")


class TestSha256Text:
    def test_known_digest(self):
        # echo -n "abc" | sha256sum
        assert sha256_text("abc") == (
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )

    def test_distinct_inputs_distinct_digests(self):
        assert sha256_text("a") != sha256_text("b")


class TestJsonIO:
    def test_write_then_read_roundtrip(self, tmp_path):
        path = tmp_path / "sub" / "obj.json"
        write_json_atomic(path, {"x": [1, 2], "y": "z"})
        assert read_json(path) == {"x": [1, 2], "y": "z"}

    def test_no_tmp_file_left_behind(self, tmp_path):
        path = tmp_path / "obj.json"
        write_json_atomic(path, {"k": 1})
        assert [p.name for p in tmp_path.iterdir()] == ["obj.json"]


class TestLoadTable:
    def test_json_array(self, tmp_path):
        p = tmp_path / "rows.json"
        p.write_text(json.dumps([{"task_id": "t1", "score": 0.5}]), encoding="utf-8")
        assert load_table(p) == [{"task_id": "t1", "score": 0.5}]

    def test_json_non_array_raises(self, tmp_path):
        p = tmp_path / "rows.json"
        p.write_text(json.dumps({"not": "a list"}), encoding="utf-8")
        with pytest.raises(ValueError, match="JSON array"):
            load_table(p)

    def test_csv_coercion(self, tmp_path):
        p = tmp_path / "rows.csv"
        p.write_text(
            "task_id,derivable,score,level\nt1,true,0.25,L2\nt2,FALSE,1,L5\n",
            encoding="utf-8",
        )
        rows = load_table(p)
        assert rows == [
            {"task_id": "t1", "derivable": True, "score": 0.25, "level": "L2"},
            {"task_id": "t2", "derivable": False, "score": 1.0, "level": "L5"},
        ]

    def test_unsupported_suffix_raises(self, tmp_path):
        p = tmp_path / "rows.parquet"
        p.write_text("x", encoding="utf-8")
        with pytest.raises(ValueError, match="Unsupported table format"):
            load_table(p)
