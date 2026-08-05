#!/bin/bash
# Copy tree-sitter .scm query files into dist so the packed artifact resolves
# queries via `new URL('./queries/', import.meta.url)` identically to src.
#
# TASK-62 externalized cpp extraction to .scm query files; the tsc build only
# emits .js/.d.ts, so dist/plugins/cpp/queries/ was missing and a packed install
# (npm pack) fell back to empty queries → driver-path output diverged from direct
# parseCode (parser-runtime-packed / install-policy integration tests). Copying
# the query files into dist closes that gap.
set -e

for d in src/plugins/*/queries; do
  [ -d "$d" ] || continue
  plugin="$(basename "$(dirname "$d")")"
  mkdir -p "dist/plugins/$plugin/queries"
  cp "$d"/*.scm "dist/plugins/$plugin/queries/"
done

echo "✓ .scm query files copied to dist"
