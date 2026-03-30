#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT_DIR/package.json"
CLAUDE_DIR="${HOME}/.claude"
CLAUDE_MCP_JSON="${CLAUDE_DIR}/mcp.json"
CLAUDE_SKILLS_DIR="${CLAUDE_DIR}/skills"
SOURCE_SKILL_DIR="${ROOT_DIR}/.agents/skills/feature-developer"
TARGET_SKILL_DIR="${CLAUDE_SKILLS_DIR}/feature-developer"
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=true
      ;;
    *)
      echo "[archguard-install] unknown argument: $arg" >&2
      echo "usage: $0 [--skip-build]" >&2
      exit 1
      ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  echo "[archguard-install] npm is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[archguard-install] node is required" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE_JSON" ]]; then
  echo "[archguard-install] package.json not found: $PACKAGE_JSON" >&2
  exit 1
fi

if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "[archguard-install] skipping build"
else
  echo "[archguard-install] building current checkout"
  (cd "$ROOT_DIR" && npm run build)
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[archguard-install] packing release tarball"
PACK_NAME="$(cd "$ROOT_DIR" && npm pack --pack-destination "$TMP_DIR" | tail -n 1)"

echo "[archguard-install] installing global package for current user"
npm install -g "$TMP_DIR/$PACK_NAME"

if ! command -v archguard >/dev/null 2>&1; then
  echo "[archguard-install] archguard command not found after global install" >&2
  exit 1
fi

mkdir -p "$CLAUDE_DIR"

echo "[archguard-install] registering ~/.claude/mcp.json entry"
node - "$CLAUDE_MCP_JSON" <<'NODE'
const fs = require('fs');
const path = process.argv[2];

let doc = {};
if (fs.existsSync(path)) {
  const raw = fs.readFileSync(path, 'utf8').trim();
  if (raw) {
    doc = JSON.parse(raw);
  }
}

if (!doc.mcpServers || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) {
  doc.mcpServers = {};
}

doc.mcpServers.archguard = {
  command: 'archguard',
  args: ['mcp'],
};

if (!doc._deprecated) {
  doc._deprecated =
    'Deprecated: Use .mcp.json at plugin root instead. This file is kept for backwards compatibility with manual installations and will be removed in a future release.';
}

fs.writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
NODE

if [[ -d "$SOURCE_SKILL_DIR" ]]; then
  echo "[archguard-install] syncing Claude skill"
  mkdir -p "$CLAUDE_SKILLS_DIR"
  rm -rf "$TARGET_SKILL_DIR"
  cp -R "$SOURCE_SKILL_DIR" "$TARGET_SKILL_DIR"
else
  echo "[archguard-install] skill source missing, skipping: $SOURCE_SKILL_DIR"
fi

ARCHGUARD_BIN="$(command -v archguard)"
ARCHGUARD_TARGET="$(readlink -f "$ARCHGUARD_BIN" || printf '%s' "$ARCHGUARD_BIN")"

echo
echo "[archguard-install] done"
echo "  binary: $ARCHGUARD_BIN"
echo "  target: $ARCHGUARD_TARGET"
echo "  mcp:    $CLAUDE_MCP_JSON"
if [[ -d "$TARGET_SKILL_DIR" ]]; then
  echo "  skill:  $TARGET_SKILL_DIR"
fi
