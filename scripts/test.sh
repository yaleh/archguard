#!/usr/bin/env bash
# Test entrypoint for quay's mechanical fan-in (loop.test_command).
#
# quay appends its own value-taking flags to this script:
#   --buckets <task-id> --root <worktree> --state-dir <dir> --runner <name>
#   --log-file <path> --run-id <id> --test-concurrency=<N>
# Contract (see quay init skill, "loop.test_command contract"):
#   1. consume a value-taking flag TOGETHER with its value (shift 2);
#   2. never read a flag's value as a positional test file;
#   3. a positional path that does not exist is an ERROR, not a skip.
#
# Usage:
#   bash scripts/test.sh                      # full suite (vitest run)
#   bash scripts/test.sh tests/unit/foo.test.ts [more files...]   # scoped run
set -euo pipefail

FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    # quay fan-in value-taking flags: drop flag AND value.
    --buckets|--root|--state-dir|--runner|--log-file|--run-id) shift 2 ;;
    # vitest runs with pool=forks/singleFork (vitest.config.ts); concurrency is not tunable here.
    --test-concurrency=*) shift ;;
    -*) shift ;;  # unknown flags are ignored rather than failing the gate
    *)
      [ -e "$1" ] || { echo "error: test file not found: $1" >&2; exit 1; }
      FILES+=("$1"); shift ;;
  esac
done

if [ ${#FILES[@]} -gt 0 ]; then
  exec npx vitest run "${FILES[@]}"
fi
exec npx vitest run
