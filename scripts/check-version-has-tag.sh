#!/usr/bin/env bash
# Pre-publish guard (GOAL-001 / AC-002): package.json's version must have a
# same-named `v<version>` git tag, so the publish order is "tag first, publish after".
#
# Usage: bash scripts/check-version-has-tag.sh [repo-root]   (default: current directory)
# Exit 0: tag exists. Exit 1: CAUSE=... printed on stderr.
set -uo pipefail

ROOT="${1:-.}"

version="$(python3 - "$ROOT/package.json" 2>/dev/null <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        v = json.load(f).get("version")
except Exception:
    sys.exit(1)
if not isinstance(v, str) or not v:
    sys.exit(1)
print(v)
PY
)" || version=""

if [ -z "$version" ]; then
  echo "CAUSE=package-version-unreadable: cannot read a version from $ROOT/package.json" >&2
  exit 1
fi

if ! git -C "$ROOT" rev-parse -q --verify "refs/tags/v$version" >/dev/null 2>&1; then
  echo "CAUSE=published-version-without-a-tag: package.json version $version has no tag v$version (run: git tag v$version)" >&2
  exit 1
fi

echo "ok: tag v$version exists"
