#!/usr/bin/env bash
# Stage 61.1 — generate the L0–L5 representation-level artifacts from obf/.
#
# L0  obfuscated tree file-name listing (stable sort)
# L1  package-level Mermaid   (analyze --diagrams package)
# L2  class-level Mermaid     (analyze --diagrams class)
# L3  method-level Mermaid    (analyze --diagrams method) + call-edge appendix
# L4  full ArchJSON (root query scope, private members included) + callGraph
# L5  concatenated obfuscated module sources (the two scope modules only,
#     no dependency-closure files — §5 L5 token-budget definition)
#
# Discipline (plan 60.3/61.1): every analyze run gets an EXPLICIT --work-dir
# under artifacts/work/<level> — never let the CLI default to the repo root
# .archguard.
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT=../..
CLI="$REPO_ROOT/dist/cli/index.js"
SRC=obf/d1                       # obfuscated source root (multi-module)
OBF_TSCONFIG=obf/tsconfig.json
LEVELS=artifacts/levels
WORK=artifacts/work
# Original module prefixes whose obfuscated dirs form the L5 / callgraph scope.
MODULES="${MODULES:-src/mermaid src/parser}"
MAPPING="${MAPPING:-artifacts/gt/mapping.json}"

if [ ! -f "$CLI" ]; then
  echo "== dist/ missing: building main repo =="
  (cd "$REPO_ROOT" && npm run build)
fi

echo "== resolving scope module dirs from $MAPPING =="
MODULE_DIRS=$(MODULES="$MODULES" MAPPING="$MAPPING" node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.env.MAPPING, "utf8"));
  const prefixes = process.env.MODULES.trim().split(/\s+/);
  const dirs = new Set();
  for (const [orig, obf] of Object.entries(m.files.forward)) {
    if (prefixes.some((p) => orig.startsWith(p + "/"))) {
      dirs.add(obf.split("/").slice(0, -1).join("/"));
    }
  }
  const all = [...dirs].sort();
  const minimal = all.filter((d) => !all.some((o) => o !== d && d.startsWith(o + "/")));
  console.log(minimal.join(" "));
')
echo "   modules: $MODULES -> obf dirs: $MODULE_DIRS"

rm -rf "$LEVELS/L0" "$LEVELS/L1" "$LEVELS/L2" "$LEVELS/L3" "$LEVELS/L4" "$LEVELS/L5" \
       "$WORK/L1" "$WORK/L2" "$WORK/L3" "$WORK/L4"
mkdir -p "$LEVELS/L0" "$LEVELS/L5"

echo "== L0: obfuscated file-name listing =="
(cd "$SRC" && find . -type f -name '*.ts' | sed 's|^\./||' | LC_ALL=C sort) \
  > "$LEVELS/L0/filenames.txt"

run_level () { # <level> <diagram-filter...>
  local level="$1"; shift
  echo "== $level: analyze $* =="
  node "$CLI" analyze -s "$SRC" --work-dir "$WORK/$level" --output-dir "$LEVELS/$level" \
    --no-cache "$@"
}

run_level L1 -f mermaid --diagrams package
run_level L2 -f mermaid --diagrams class
run_level L3 -f mermaid --diagrams method
run_level L4 -f json

echo "== L4: extracting root-scope ArchJSON (full members incl. private) =="
GLOBAL_KEY=$(node -p "JSON.parse(require('fs').readFileSync('$WORK/L4/query/manifest.json','utf8')).globalScopeKey")
cp "$WORK/L4/query/$GLOBAL_KEY/arch.json" "$LEVELS/L4/arch.json"

echo "== callgraph on obf scope modules =="
# shellcheck disable=SC2086 -- intentional word splitting of module dir list
npx tsx callgraph.ts \
  --sources $(for d in $MODULE_DIRS; do printf 'obf/%s ' "$d"; done) \
  --base "$SRC" --tsconfig "$OBF_TSCONFIG" --out "$LEVELS/callgraph-obf.json"

echo "== injecting call edges into L3 (mermaid appendix) + L4 (callGraph field) =="
npx tsx inject-callgraph.ts --callgraph "$LEVELS/callgraph-obf.json" \
  --mermaid "$LEVELS"/L3/method/*.mmd \
  --archjson "$LEVELS/L4/arch.json"

echo "== L5: concatenated obfuscated module sources =="
L5_OUT="$LEVELS/L5/source.txt"
: > "$L5_OUT"
# shellcheck disable=SC2086
for f in $(cd obf && find $MODULE_DIRS -type f -name '*.ts' | LC_ALL=C sort); do
  printf '===== %s =====\n' "$f" >> "$L5_OUT"
  cat "obf/$f" >> "$L5_OUT"
  printf '\n' >> "$L5_OUT"
done

echo "== level artifact sizes =="
for lvl in L0 L1 L2 L3 L4 L5; do
  du -sh --exclude=snapshots "$LEVELS/$lvl" | sed 's|artifacts/levels/||'
done
echo "callgraph edges: $(node -p "JSON.parse(require('fs').readFileSync('$LEVELS/callgraph-obf.json','utf8')).edges.length")"
echo "done."
