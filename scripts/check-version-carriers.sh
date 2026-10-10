#!/usr/bin/env bash
# Version-carrier consistency guard (GOAL-001 / AC-003 + AC-004).
#
# The released version must be carried, verbatim, in SIX `.version` places across four files:
#
#   package.json                              .version
#   package-lock.json                         .version
#   package-lock.json                         .packages[""].version
#   .claude-plugin/marketplace.json           .plugins[0].source.version   (npm source pin)
#   plugin/package.json                       .version
#   plugin/.claude-plugin/plugin.json         .version
#
# ...and in a SEVENTH carrier, a dependency-range string rather than a `.version`:
#
#   plugin/package.json   .dependencies["@yalehwang/archguard"]   (exact-core pin, AC-004)
#
# The six are checked against the EXTERNAL single source, the repo-root `VERSION` file — not
# merely "the carriers agree with each other". The weaker shape cannot see a tree whose carriers
# all agree but are all stale, and it does not stop the partial bump that `npm version` alone
# leaves behind (npm side ahead of the plugin side). That is the AC-003 long-term fix.
#
# The seventh is checked against `package.json` `.version`, verbatim, exactly as AC-004's own
# criterion reads it: a missing dependency is `CAUSE=plugin-missing-core-dependency`; a value that
# differs (including any `^`/`~` range) is `CAUSE=plugin-core-dependency-not-exact`. The pin lives
# in a nested object, so the six-carrier `.version` enumeration could never see it — the
# 2026-10-10T05:11 window where the npm side was 0.1.39 and the pin still 0.1.38 is exactly the
# gap this seventh carrier closes.
#
# Each comparison lives in one script, shared with its generator, so this guard and the generators
# cannot disagree about what "consistent"/"exact" means:
#   scripts/sync-version-carriers.mjs  --check             — the six against VERSION (AC-003)
#   scripts/sync-plugin-core-pin.mjs   --check-if-declared — the seventh against package.json
#                                                            version (AC-004), when declared
# The pin's guard mode skips a plugin package that declares no `dependencies` object at all: the
# pre-existing six-carrier regression contract (tests/unit/scripts/version-carriers-check.test.ts)
# pins that shape as healthy, and the pin's PRESENCE is enforced by strict `sync-plugin-core-pin.mjs
# --check` — which is the AC-004 criterion's own implementation and is run by the goal gate.
# `npm version` runs both generators (package.json `version` lifecycle), deriving VERSION + the six
# + the pin inside one `npm version` call, so the partial-bump window cannot hang.
#
# Usage: bash scripts/check-version-carriers.sh [repo-root]   (default: current directory)
# Exit 0: all seven consistent (where declared) — prints `all carriers == <version>` (six) on stdout.
# Exit 1: CAUSE=version-carrier-unreadable — VERSION or a carrier file is missing / unparseable
#                                            / carries no version string.
#         CAUSE=version-carriers-disagree  — at least one `.version` carrier differs from VERSION.
#         CAUSE=plugin-missing-core-dependency    — a declared `dependencies` set lacks the core pin.
#         CAUSE=plugin-core-dependency-not-exact  — the declared pin differs from the core version.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-.}"

# Six `.version` carriers against VERSION, then the seventh pin against package.json's version.
node "$SCRIPT_DIR/sync-version-carriers.mjs" --check "$ROOT" || exit $?
node "$SCRIPT_DIR/sync-plugin-core-pin.mjs" --check-if-declared "$ROOT" || exit $?
