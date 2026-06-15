#!/usr/bin/env bash
# One-time script to create GitHub labels for the L0 Agent Queue.
# Safe to re-run: gh label create is idempotent with --force.
set -euo pipefail

REPO="yaleh/archguard"

gh label create "agent-run"    --repo "$REPO" --color "0075ca" --description "L0: task ready for autonomous execution"      --force
gh label create "in-progress"  --repo "$REPO" --color "e4e669" --description "L0: task currently being executed"           --force
gh label create "needs-human"  --repo "$REPO" --color "d73a4a" --description "L0: task failed DoD after 3 retries"        --force
gh label create "done"         --repo "$REPO" --color "0e8a16" --description "L0: task completed, PR opened"               --force
gh label create "plan"         --repo "$REPO" --color "3e4b9e" --description "L0: feature spec (Parent Issue)"             --force
gh label create "phase"        --repo "$REPO" --color "7b5ea7" --description "L0: executable phase (Child Issue)"          --force
gh label create "in-review"    --repo "$REPO" --color "e06c00" --description "L0: parent under architect review"           --force
gh label create "ready"        --repo "$REPO" --color "0d9488" --description "L0: parent reviewed, children may queue"     --force
gh label create "blocked"      --repo "$REPO" --color "b45309" --description "L0: child blocked by open dependency"        --force

echo "Labels created successfully."
