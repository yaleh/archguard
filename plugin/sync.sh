#!/usr/bin/env bash
# plugin/sync.sh — sync canonical skill assets into the plugin distribution
# directory (TASK-31). Run from anywhere; resolves paths relative to itself.
# Idempotent (overwrites on each run).
#
# The npm-source plugin does NOT vendor dist/: the plugin package depends on an
# exact @yalehwang/archguard version and npm installs the runtime dependency
# closure into the plugin cache. Only the skills are canonical copies from
# .agents/skills/.
#
# CI: bash plugin/sync.sh && git diff --exit-code plugin/ — fails if the
# vendored plugin content is stale relative to its canonical source.

set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"

echo "=== Syncing skills ==="
for skill in feature-developer project-semantics-discovery; do
  rm -rf "$PLUGIN_DIR/skills/$skill"
  cp -r "$REPO_ROOT/.agents/skills/$skill" "$PLUGIN_DIR/skills/$skill"
  echo "  skills/$skill synced"
done
