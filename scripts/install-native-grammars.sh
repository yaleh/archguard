#!/usr/bin/env bash
#
# TASK-82: local full-suite green — materialize native tree-sitter grammars
# into node_modules WITHOUT touching package.json / package-lock.json.
#
# Rationale (same as the CI step this ports):
#   - Native tree-sitter grammars are OPTIONAL peers (TASK-41 "deterministic
#     WASM baseline"): bare `npm ci` never installs them, so every local
#     `npx vitest run` fails ~397 native-parser tests with MODULE_NOT_FOUND.
#   - `npm install --no-save tree-sitter ...` does NOT work (npm sees the
#     optional peer declared in our manifest, reports "up to date", installs
#     nothing — verified on npm 10/11). So we install into a scratch prefix
#     whose package.json knows nothing about our peer declarations, then copy
#     the installed trees into node_modules (all additions — none exist in the
#     lockfile). --legacy-peer-deps bypasses the grammars' stale tree-sitter
#     peer ranges. Prebuilds are N-API (ABI-stable): no compilation needed.
#   - install-policy tests forbid preinstall/install/postinstall/prepack hooks
#     and any dependencies/optionalDependencies entry — this script is an
#     explicit, documented, opt-in dev/test step (also wired as `pretest`),
#     NOT a lifecycle hook and NOT a dependency.
#
# Idempotent: re-running after the packages are present is a fast no-op.
# Fail-fast: a smoke parse over all six bindings fails the script if any
# binding is broken, instead of surfacing as ~397 cryptic test failures.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MODULES="$ROOT/node_modules"

# Package directory names (idempotence check) vs install specs (CI-pinned versions).
declare -a PKGS=(
  "tree-sitter"
  "tree-sitter-go"
  "tree-sitter-java"
  "tree-sitter-python"
  "tree-sitter-cpp"
  "@tree-sitter-grammars/tree-sitter-kotlin"
)
# Versions mirror .github/workflows/ci.yml exactly.
declare -a SPECS=(
  "tree-sitter@^0.25.0"
  "tree-sitter-go@^0.25.0"
  "tree-sitter-java@^0.23.5"
  "tree-sitter-python@^0.25.0"
  "tree-sitter-cpp@^0.23.4"
  "@tree-sitter-grammars/tree-sitter-kotlin@^1.1.0"
)

# Idempotence: if every package is already present, skip.
all_present=1
for pkg in "${PKGS[@]}"; do
  if [[ ! -d "$NODE_MODULES/$pkg" ]]; then all_present=0; break; fi
done

if [[ "$all_present" -eq 1 ]]; then
  echo "native tree-sitter grammars already present in node_modules — no-op"
  exit 0
fi

echo "Installing native tree-sitter grammars into a scratch prefix (test-only)..."
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
(
  cd "$scratch"
  npm init -y >/dev/null
  npm install --legacy-peer-deps "${SPECS[@]}"
)
find "$scratch/node_modules" -maxdepth 1 -mindepth 1 ! -name '.*' \
  -exec cp -r {} "$NODE_MODULES/" \;

# Fail fast instead of ~397 cryptic test failures: load every binding and
# check the ABI via Parser.setLanguage (same smoke as the CI step).
cd "$ROOT"
node -e '
  const Parser = require("tree-sitter");
  const grammars = {
    go: require("tree-sitter-go"),
    java: require("tree-sitter-java"),
    python: require("tree-sitter-python"),
    cpp: require("tree-sitter-cpp"),
    kotlin: require("@tree-sitter-grammars/tree-sitter-kotlin"),
  };
  for (const [lang, grammar] of Object.entries(grammars)) {
    const parser = new Parser();
    parser.setLanguage(grammar);
    if (!parser.parse(" ").rootNode) throw new Error(lang + " parse failed");
  }
  console.log("native tree-sitter smoke test: all 6 packages load");
'
