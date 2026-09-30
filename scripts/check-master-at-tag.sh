#!/usr/bin/env bash
# GOAL-001 / AC-001 — master's value domain is single-valued: master must sit
# exactly on a commit carrying a `vX.Y.Z` release tag. Anywhere else is drift.
#
# The only permitted forward event for master is .github/workflows/release.yml's
# `advance-master` job fast-forwarding it to the released tag after every other
# job is green (quay SPEC-release-and-hotfix-branching-2026-09-15 §3.1 / §6).
# This script is that criterion turned into an executable judgement, shared by
# the goal check and by CI.
#
# Judgement, in order:
#   1. `git rev-parse refs/heads/master`      -> master's commit (no master ref => CAUSE=no-master-ref)
#   2. `git tag --points-at <sha>`            -> every tag on that commit
#   3. match ^v[0-9]+\.[0-9]+\.[0-9]+$        -> at least one release tag, else CAUSE=master-not-at-a-version-tag
#
# Usage: bash scripts/check-master-at-tag.sh [repo-root]   (default: current directory)
# Exit 0: master is at a version tag (the tag name is printed on stdout).
# Exit 1: drift detected; `CAUSE=...` is printed on stderr.
set -uo pipefail

ROOT="${1:-.}"

# Step 1 — master's commit. `refs/heads/master` is named explicitly so a
# remote-tracking `origin/master` can never be silently substituted for the
# local branch whose position this criterion is about.
master_sha="$(git -C "$ROOT" rev-parse -q --verify 'refs/heads/master^{commit}' 2>/dev/null)" || master_sha=""

if [ -z "$master_sha" ]; then
  echo "CAUSE=no-master-ref: $ROOT has no local master branch to judge" >&2
  exit 1
fi

# Steps 2+3 — tags pointing at master's commit, filtered to release tags.
# `git tag --points-at` alone is not enough: a non-release tag (e.g. a scratch
# or bookmark tag) on master is still drift for this criterion, so the exact
# shape regex decides, not the mere presence of some tag.
release_tag=""
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  if printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    release_tag="$tag"
    break
  fi
done < <(git -C "$ROOT" tag --points-at "$master_sha" 2>/dev/null)

if [ -z "$release_tag" ]; then
  pointing="$(git -C "$ROOT" tag --points-at "$master_sha" 2>/dev/null | tr '\n' ' ')"
  echo "CAUSE=master-not-at-a-version-tag: master ($master_sha) carries no vX.Y.Z tag (tags pointing at it: ${pointing:-none})" >&2
  exit 1
fi

echo "ok: master $master_sha is at $release_tag"
