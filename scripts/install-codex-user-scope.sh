#!/usr/bin/env bash
# install-codex-user-scope.sh — register the ArchGuard MCP server in the Codex
# user config at ~/.codex/config.toml (or $CODEX_HOME/config.toml) (TASK-36).
#
# Thin wrapper around scripts/install-codex-user-scope.mjs. The installer:
#   1. Resolves the npm-installed @yalehwang/archguard CLI entry
#      (dist/cli/index.js) — from --archguard-root, $ARCHGUARD_INSTALL_ROOT,
#      or the global `npm root -g`. It never points into Claude's versioned
#      plugin cache or at the source checkout.
#   2. Idempotently writes exactly one TOML-safe [mcp_servers.archguard]
#      table (update, never duplicate) that launches
#      `node <install>/dist/cli/index.js mcp`, preserving unrelated Codex
#      configuration.
#   3. Forwards ARCHGUARD_PARSER_RUNTIME (auto|native|wasm) to the server.
#   4. Self-verifies the written table, and (when the codex CLI is present)
#      smoke-checks `codex mcp list`.
#
# usage: install-codex-user-scope.sh [--archguard-root <dir>] \
#          [--parser-runtime auto|native|wasm] [--arch-dir <dir>] [--no-verify]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[archguard-install] node is required" >&2
  exit 1
fi

exec node "$ROOT_DIR/scripts/install-codex-user-scope.mjs" "$@"
