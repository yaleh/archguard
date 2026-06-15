#!/usr/bin/env bash
# One-time script to create GitHub labels for the L0 Agent Queue.
# Safe to re-run: gh label create is idempotent with --force.
set -euo pipefail

REPO="yaleh/archguard"

gh label create "agent-run"    --repo "$REPO" --color "0075ca" --description "L0: task ready for autonomous execution" --force
gh label create "in-progress"  --repo "$REPO" --color "e4e669" --description "L0: task currently being executed"      --force
gh label create "needs-human"  --repo "$REPO" --color "d73a4a" --description "L0: task failed DoD after 3 retries"   --force
gh label create "done"         --repo "$REPO" --color "0e8a16" --description "L0: task completed, PR opened"          --force

echo "Labels created successfully."
