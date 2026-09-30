#!/usr/bin/env bash
# Test entrypoint for quay's mechanical fan-in (loop.test_command).
#
# quay appends its own value-taking flags to this script:
#   --for-task <task-id> --buckets <task-id> --root <worktree> --state-dir <dir>
#   --runner <name> --log-file <path> --run-id <id> --test-concurrency=<N>
#   --allow-thin (boolean: a thin selection is acceptable to the caller)
# Contract (see quay init skill, "loop.test_command contract"):
#   1. consume a value-taking flag TOGETHER with its value (shift 2);
#   2. never read a flag's value as a positional test file;
#   3. a positional path that does not exist is an ERROR, not a skip.
#
# quay's fan-in ALSO drives the per-task SCOPED gate through this same entrypoint, as
#   bash <worktree>/scripts/test.sh --for-task <task-id> --allow-thin
# spawned with the CALLER's cwd (the main checkout), not the worktree's — hence the self-locating
# `cd` below. Without it a relative test path would resolve against the main checkout and the scoped
# gate would silently judge a tree that is not the one under test.
#
# Usage:
#   bash scripts/test.sh                      # full suite (vitest run)
#   bash scripts/test.sh tests/unit/foo.test.ts [more files...]   # scoped run
#   bash scripts/test.sh --for-task <task-id> [--allow-thin]      # scoped run over the task's Touches
set -euo pipefail

# Self-locating: run against the tree this script lives in, whatever cwd the caller had.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FILES=()
SCOPED_TASK=""

while [ $# -gt 0 ]; do
  case "$1" in
    # quay's scoped gate: run the test files the named task declares in its ## Touches section.
    --for-task) SCOPED_TASK="${2:-}"; shift 2 ;;
    # quay fan-in value-taking flags: drop flag AND value.
    # --for-task <task-id> is what the driver's scoped gate passes (worker-driver
    # resolveScopedGateCommand). Leaving it out of this list made the task id fall
    # through to the positional arm below, where it was read as a test-file path —
    # the exact failure the contract above forbids ("error: test file not found:
    # <task-id>"), which reds the scoped gate for every task.
    --for-task|--buckets|--root|--state-dir|--runner|--log-file|--run-id) shift 2 ;;
    # --allow-thin is boolean (no value): the caller permits a thin selection. This
    # script's selection is never thin — with no positional files it runs the full
    # suite, which is strictly more signal than the caller asked to allow.
    --allow-thin) shift ;;
    # vitest runs with pool=forks/singleFork (vitest.config.ts); concurrency is not tunable here.
    --test-concurrency=*) shift ;;
    --allow-thin) shift ;;  # the scoped set may legitimately be smaller than the suite
    -*) shift ;;  # unknown flags are ignored rather than failing the gate
    *)
      [ -e "$1" ] || { echo "error: test file not found: $1" >&2; exit 1; }
      FILES+=("$1"); shift ;;
  esac
done

# --for-task <id> → the test files named in tasks/<id>.md's ## Touches section, minus any that do not
# exist on disk. A task whose Touches declare no test file resolves to an EMPTY set: that is the
# thin scoped run quay passes --allow-thin for, and it must not fall through to the full suite.
# (An unknown task warns loudly instead of reddening the gate — the scoped set is genuinely empty.)
if [ -n "$SCOPED_TASK" ]; then
  task_file="tasks/${SCOPED_TASK}.md"
  if [ ! -f "$task_file" ]; then
    echo "warning: --for-task ${SCOPED_TASK}: ${task_file} not found; scoped set is empty" >&2
  else
    while IFS= read -r touched; do
      case "$touched" in
        *.test.ts|*.test.mjs|*.test.js|*.spec.ts|*.spec.mjs|*.spec.js)
          if [ -e "$touched" ]; then
            FILES+=("$touched")
          fi
          ;;
      esac
    done < <(
      awk '
        /^##[[:space:]]+Touches[[:space:]]*$/ { in_touches = 1; next }
        /^##[[:space:]]/ { in_touches = 0 }
        in_touches && /^[-*][[:space:]]+/ {
          sub(/^[-*][[:space:]]+/, "")
          sub(/[[:space:]]*\([^()]*\)[[:space:]]*$/, "")   # drop a trailing "(new)" / "(modified)" tag
          gsub(/`/, "")
          sub(/^\.\//, "")
          print
        }
      ' "$task_file"
    )
  fi
fi

if [ ${#FILES[@]} -gt 0 ]; then
  # De-duplicate: --for-task and an explicit positional may name the same file.
  mapfile -t FILES < <(printf '%s\n' "${FILES[@]}" | awk '!seen[$0]++')
  exec npx vitest run "${FILES[@]}"
fi

if [ -n "$SCOPED_TASK" ]; then
  echo "scoped gate: ${SCOPED_TASK} declares no test file in ## Touches — nothing to run (thin)"
  exit 0
fi

exec npx vitest run
