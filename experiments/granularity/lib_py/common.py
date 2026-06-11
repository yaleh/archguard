"""Shared helpers for Phase 62 Python modules (embed / dimension / analyze).

Discipline (plan 59-66 #4): credentials are ONLY read from environment
variables at call time. No defaults, no literals, nothing written back.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
from pathlib import Path
from typing import Any


class MissingEnvError(RuntimeError):
    """A required environment variable is missing (fail-fast, no defaults)."""


def require_env(name: str) -> str:
    """Return the value of environment variable `name`, or raise MissingEnvError."""
    value = os.environ.get(name)
    if not value:
        raise MissingEnvError(
            f"Missing required environment variable: {name}. "
            "Set it before running any granularity experiment script "
            "(no defaults are provided; credentials never live in code)."
        )
    return value


def sha256_text(text: str) -> str:
    """SHA-256 hex digest of UTF-8 encoded `text` (cache index key on disk)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json_atomic(path: str | Path, obj: Any) -> None:
    """Write JSON via a temp file + atomic rename (no partial cache entries)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)


def _coerce_csv_value(value: str) -> Any:
    """Coerce CSV string cells: 'true'/'false' -> bool, numeric -> float, else str."""
    s = value.strip()
    low = s.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return float(s)
    except ValueError:
        return s


def load_table(path: str | Path) -> list[dict[str, Any]]:
    """Load a long-table file as a list of row dicts.

    Supported formats:
      - `.json`: a JSON array of objects (types preserved as-is);
      - `.csv` : header row + data rows; cells are coerced with
        `_coerce_csv_value` (true/false -> bool, numeric -> float, else str).
        Note: numeric-looking IDs become floats — use non-numeric task IDs.
    """
    p = Path(path)
    suffix = p.suffix.lower()
    if suffix == ".json":
        rows = read_json(p)
        if not isinstance(rows, list):
            raise ValueError(f"Expected a JSON array of row objects in {p}")
        return rows
    if suffix == ".csv":
        with open(p, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            return [{k: _coerce_csv_value(v) for k, v in row.items()} for row in reader]
    raise ValueError(f"Unsupported table format '{suffix}' (use .json or .csv): {p}")
