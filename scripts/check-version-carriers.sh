#!/usr/bin/env bash
# Version-carrier consistency guard (GOAL-001 / AC-003).
#
# The released version must be carried, verbatim, in six places across four files:
#
#   package.json                              .version
#   package-lock.json                         .version
#   package-lock.json                         .packages[""].version
#   .claude-plugin/marketplace.json           .plugins[0].source.version   (npm source pin)
#   plugin/package.json                       .version
#   plugin/.claude-plugin/plugin.json         .version
#
# The criterion is the EXTERNAL single source: every carrier must equal the repo-root
# `VERSION` file — not merely "the carriers agree with each other". The weaker shape cannot
# see a tree whose carriers all agree but are all stale, and it does not stop the partial bump
# that `npm version` alone leaves behind (npm side ahead of the plugin side). Lifting it to the
# external source is the AC-003 long-term fix (quay SPEC-release-and-hotfix-branching §12.2).
#
# The comparison itself lives in scripts/sync-version-carriers.mjs (run with --check): one
# implementation, shared with the generator, so this guard and the generator cannot disagree
# about what "consistent" means. `npm version` runs the generator (package.json `version`
# lifecycle), which derives VERSION + the six in the same call — the partial-bump window
# cannot hang.
#
# Usage: bash scripts/check-version-carriers.sh [repo-root]   (default: current directory)
# Exit 0: all six == VERSION — prints `all carriers == <version>` on stdout.
# Exit 1: CAUSE=version-carrier-unreadable — VERSION or a carrier file is missing / unparseable
#                                            / carries no version string.
#         CAUSE=version-carriers-disagree  — at least one carrier differs from VERSION.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-.}"

exec node "$SCRIPT_DIR/sync-version-carriers.mjs" --check "$ROOT"
