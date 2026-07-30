#!/usr/bin/env bash
# install-claude-user-scope.sh — install the ArchGuard Claude Code plugin at
# user scope via the npm-source marketplace flow (TASK-35).
#
# Thin wrapper around scripts/install-claude-user-scope.mjs. The installer:
#   1. Removes any legacy ArchGuard entry from the deprecated
#      ~/.claude/mcp.json (never writes registrations there).
#   2. Adds (or updates) the `archguard` marketplace registration.
#   3. Installs (or updates) the `archguard@archguard` plugin at user scope;
#      Claude Code resolves @yalehwang/archguard-claude-plugin and its exact
#      @yalehwang/archguard dependency from npm — no global `archguard`
#      binary is installed or required.
#   4. Verifies exactly one enabled plugin instance.
#
# Idempotent: re-run to upgrade after pulling a new version. The installer
# never installs, builds, or globally mutates native tree-sitter runtime or
# grammar packages.
#
# usage: install-claude-user-scope.sh [--marketplace-source <src>]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[archguard-install] node is required" >&2
  exit 1
fi

exec node "$ROOT_DIR/scripts/install-claude-user-scope.mjs" "$@"
