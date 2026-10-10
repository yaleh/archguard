#!/usr/bin/env bash
# Atomic release cut (GOAL-001 / AC-002).
#
# AC-002 reads the WORKING TREE's package.json version and requires a same-named `v*` tag:
#
#   v=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
#   git rev-parse -q --verify "refs/tags/v$v"   # must exist
#
# A release that bumps `package.json` (and the other version carriers) in the tree, commits,
# and only THEN tags leaves an untagged window: from "the tree shows 0.1.39" to "tag v0.1.39
# exists" the acceptance reads a version with no tag and goes red. The 0.1.38 (2026-10-08) and
# 0.1.39 (2026-10-10T05:11) releases each hit it (~60-90s), because the release was run by hand
# in the MAIN checkout — the exact tree the goal driver polls every ~40s — and the runbook used
# `npm version patch --no-git-tag-version`, which defers the tag by design.
#
# This script removes BOTH halves of the window:
#
#   1. It refuses to run in the MAIN worktree. The main checkout's working tree is what AC-002
#      samples; a release therefore never touches it. Run this inside a LINKED worktree
#      (`git worktree add ...`) and the acceptance tree stays untouched for the whole release.
#      Refusal is stable: CAUSE=release-must-run-in-a-linked-worktree.
#
#   2. It makes bump and tag atomic in the tree it DOES run in: the release commit is built in
#      the object database (hash-object / write-tree / commit-tree) from a scratch copy, the tag
#      is created pointing at that commit, and only then is the working tree advanced to it
#      (`git reset --hard`). The working-tree version therefore never has a value whose tag is
#      missing — a sampler polling package.json + refs/tags sees either (old version, old tag) or
#      (new version, new tag), never (new version, no tag).
#
# Order of operations (one non-interactive call, no build/test in between):
#   CHANGELOG placeholder -> set X.Y.Z in package.json -> derive VERSION + the six carriers
#   -> derive the plugin exact-core pin (seventh carrier) -> check-version-carriers.sh must pass
#   -> build `release: X.Y.Z` commit -> create tag vX.Y.Z -> advance the worktree -> self-verify.
# On self-verify failure the tag is deleted and the branch is left at the pre-release commit.
#
# The main checkout is fast-forwarded to the release commit only AFTER the release is complete
# (see the release runbook) — never bumped in place.
#
# Usage: bash scripts/release.sh X.Y.Z
#        bash scripts/release.sh --help
#
# Exit codes:
#   0  released: commit `release: X.Y.Z` created and tag `vX.Y.Z` exists
#   1  refused or failed (CAUSE=... on stderr)
#   2  usage error
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
usage: bash scripts/release.sh X.Y.Z

Cut one atomic release: write a CHANGELOG placeholder, sync the seven version carriers from
X.Y.Z, verify them, create the `release: X.Y.Z` commit and immediately create the `vX.Y.Z`
tag — with no window in which the tree shows a version whose tag does not exist.

MUST run inside a LINKED git worktree, never the main checkout: the main checkout's working
tree is what GOAL-001 / AC-002 samples, so it must never carry a bumped version. This script
refuses with CAUSE=release-must-run-in-a-linked-worktree otherwise.

After it succeeds: push the branch to develop and push the tag (the tag push triggers
.github/workflows/release.yml, whose advance-master job fast-forwards master). The main
checkout is then fast-forwarded to the release commit — never bumped in place.
EOF
}

die() {
  printf '%s\n' "$1" >&2
  exit "${2:-1}"
}

VERSION=""
for arg in "$@"; do
  case "$arg" in
    -h | --help) usage; exit 0 ;;
    -*) die "CAUSE=release-usage: unknown flag '$arg'" 2 ;;
    *) VERSION="$arg" ;;
  esac
done

[ -n "$VERSION" ] || { usage >&2; die "CAUSE=release-version-missing: expected an X.Y.Z version argument" 2; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "CAUSE=release-version-invalid: '$VERSION' is not an X.Y.Z version" 2

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "CAUSE=release-not-in-a-git-repo: not inside a git working tree"
cd "$ROOT"

# --- 1. main-worktree refusal ---------------------------------------------------
# A LINKED worktree has its own git dir under <common>/worktrees/<name>; the MAIN worktree's
# git dir IS the common dir. Equal => main => refuse.
git_dir_abs="$(cd "$(git rev-parse --absolute-git-dir 2>/dev/null || git rev-parse --git-dir)" && pwd -P)"
common_abs="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
if [ "$git_dir_abs" = "$common_abs" ]; then
  die "CAUSE=release-must-run-in-a-linked-worktree: refusing to release inside the main worktree ($ROOT). Create a linked worktree (git worktree add <path> -b <branch>) and run this script there — the main checkout must be left untouched so AC-002 never samples a bumped-but-untagged tree."
fi

# --- preconditions -------------------------------------------------------------
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null 2>&1 &&
  die "CAUSE=release-tag-already-exists: tag v$VERSION already exists"

git rev-parse -q --verify HEAD >/dev/null 2>&1 ||
  die "CAUSE=release-no-commit: the worktree has no commit to release from"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "CAUSE=release-worktree-dirty: the release worktree has uncommitted tracked changes; commit or discard them first so the release commit contains only the release"
fi

BASE="$(git rev-parse HEAD)"

# The files a release rewrites (bump + tag never touch anything else).
FILES=(
  CHANGELOG.md
  package.json
  package-lock.json
  VERSION
  .claude-plugin/marketplace.json
  plugin/package.json
  plugin/.claude-plugin/plugin.json
)

SCRATCH="$(mktemp -d)"
TMP_INDEX="$(mktemp)"
cleanup() { rm -rf "$SCRATCH" "$TMP_INDEX"; }
trap cleanup EXIT

# --- 2. build the release content in a scratch copy (working tree stays clean) ---
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  mkdir -p "$SCRATCH/$(dirname "$f")"
  cp "$f" "$SCRATCH/$f"
done

today="$(date -u +%Y-%m-%d)"
CHANGELOG="$SCRATCH/CHANGELOG.md"
if [ -f "$CHANGELOG" ] && grep -qE "^## \[$VERSION\]" "$CHANGELOG"; then
  : # an entry for this version already exists — leave it (idempotent)
else
  entry="## [$VERSION] - $today

### Changed

- Placeholder release entry — replace with the real notes before publishing.
"
  if [ -f "$CHANGELOG" ]; then
    awk -v entry="$entry" '
      BEGIN { inserted = 0 }
      { if (!inserted && $0 ~ /^## \[/) { print entry; inserted = 1 } print }
      END { if (!inserted) print entry }
    ' "$CHANGELOG" > "$CHANGELOG.tmp" || die "CAUSE=release-changelog-failed: could not write the CHANGELOG entry"
    mv "$CHANGELOG.tmp" "$CHANGELOG"
  else
    printf '# Changelog\n\nAll notable changes to ArchGuard will be documented in this file.\n\n%s' "$entry" > "$CHANGELOG" ||
      die "CAUSE=release-changelog-failed: could not create CHANGELOG.md"
  fi
fi

# --- 3. set X.Y.Z in the scratch package.json, then derive every carrier from it ---
node -e '
const fs = require("node:fs");
const file = process.argv[1];
const version = process.argv[2];
const doc = JSON.parse(fs.readFileSync(file, "utf-8"));
doc.version = version;
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
' "$SCRATCH/package.json" "$VERSION" || die "CAUSE=release-bump-failed: could not set version in package.json"

node "$SCRIPT_DIR/sync-version-carriers.mjs" --from-package "$SCRATCH" ||
  die "CAUSE=release-carrier-sync-failed: sync-version-carriers.mjs failed"
node "$SCRIPT_DIR/sync-plugin-core-pin.mjs" --from-package "$SCRATCH" ||
  die "CAUSE=release-carrier-sync-failed: sync-plugin-core-pin.mjs failed"

# --- 4. the mandatory consistency check (delegates to the same guard the goal gate runs) ---
bash "$SCRIPT_DIR/check-version-carriers.sh" "$SCRATCH" ||
  die "CAUSE=release-carriers-inconsistent: check-version-carriers.sh rejected the staged release"

# --- 5. build the release commit WITHOUT touching the working tree -------------
# The index lives in a temp file, seeded from BASE, so the repo's real index (and every tracked
# file) is untouched while the release commit is assembled in the object database.
export GIT_INDEX_FILE="$TMP_INDEX"
git read-tree "$BASE" || die "CAUSE=release-commit-build-failed: read-tree"
for f in "${FILES[@]}"; do
  [ -f "$SCRATCH/$f" ] || continue
  blob="$(git hash-object -w -- "$SCRATCH/$f")" || die "CAUSE=release-commit-build-failed: hash-object $f"
  git update-index --add --cacheinfo "100644,$blob,$f" || die "CAUSE=release-commit-build-failed: update-index $f"
done
tree="$(git write-tree)" || die "CAUSE=release-commit-build-failed: write-tree"
unset GIT_INDEX_FILE
commit="$(git commit-tree "$tree" -p "$BASE" -m "release: $VERSION")" ||
  die "CAUSE=release-commit-build-failed: commit-tree"

# --- 6. tag first, then advance the tree --------------------------------------
# At this instant the working tree still shows BASE's version, whose tag exists; after
# `git reset --hard` it shows X.Y.Z, whose tag now exists too. No untagged tree state.
git update-ref "refs/tags/v$VERSION" "$commit" || die "CAUSE=release-tag-creation-failed: update-ref refs/tags/v$VERSION"
git reset --hard "$commit" >/dev/null || {
  git update-ref -d "refs/tags/v$VERSION" >/dev/null 2>&1
  die "CAUSE=release-materialize-failed: could not advance the worktree to the release commit"
}

# --- 7. self-verify; roll back on any surprise ---------------------------------
if ! git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null 2>&1; then
  git update-ref -d "refs/tags/v$VERSION" >/dev/null 2>&1
  git update-ref -d "$(git symbolic-ref HEAD)" "$BASE" >/dev/null 2>&1
  die "CAUSE=release-tag-creation-failed: tag v$VERSION is not resolvable after the release"
fi

printf 'released %s — commit %s tagged v%s\n' "$VERSION" "$(git rev-parse --short "$commit")" "$VERSION"
