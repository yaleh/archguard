#!/usr/bin/env bash
# GOAL-001 / AC-005 criterion, as an executable check.
#
# "A release is not done until a local ledger says so." `.quay/release-runs.jsonl` is the carrier
# (gitignored — deliberately local, see the goal's AC-005), and its LAST line must record all three
# conclusions at once:
#   cli-publish=success AND plugin-publish=success AND install-verify=success
# Rows above the last one are history: earlier `failure` rows do NOT poison the verdict, they are
# exactly what the ledger is for. Only the last row describes the current release attempt.
#
# Usage: bash scripts/check-release-ledger.sh [ledger-path]   (default: .quay/release-runs.jsonl)
#
# Exit 0: last row has all three columns = success.
# Exit 1: CAUSE=carrier-absent       — no ledger file at all (nothing has ever recorded a release)
#         CAUSE=carrier-empty        — the file exists but holds no records
#         CAUSE=release-run-incomplete — the last row is unparseable, lacks a column, or has a
#                                        column that is not `success`
set -uo pipefail

ledger="${1:-.quay/release-runs.jsonl}"

if [ ! -f "$ledger" ]; then
  echo "CAUSE=carrier-absent: no release-run ledger at $ledger" >&2
  exit 1
fi

if ! records="$(node -e '
const fs = require("node:fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => l.trim() !== "");
process.stdout.write(String(rows.length));
' "$ledger" 2>/dev/null)"; then
  echo "CAUSE=carrier-absent: cannot read the release-run ledger at $ledger" >&2
  exit 1
fi

if [ -z "$records" ] || [ "$records" -eq 0 ]; then
  echo "CAUSE=carrier-empty: $ledger holds no release-run records" >&2
  exit 1
fi

if ! summary="$(node -e '
const fs = require("node:fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => l.trim() !== "");
const last = JSON.parse(rows[rows.length - 1]);
for (const key of ["cli-publish", "plugin-publish", "install-verify"]) {
  process.stdout.write(key + "=" + String(last[key]) + "\n");
}
' "$ledger" 2>/dev/null)"; then
  echo "CAUSE=release-run-incomplete: the last row of $ledger is not a readable release-run record" >&2
  exit 1
fi

while IFS= read -r column; do
  if [ "${column#*=}" != "success" ]; then
    echo "CAUSE=release-run-incomplete: last row records ${column} (all three columns must be success)" >&2
    exit 1
  fi
done <<< "$summary"

echo "ok: $ledger last row records cli-publish=success plugin-publish=success install-verify=success"
