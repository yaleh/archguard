#!/usr/bin/env bash
# Real install verification (GOAL-001 / AC-005).
#
# "The release object exists" and "npm publish exited 0" are NOT "the release installs". This script
# is the only step that answers the second question: it installs BOTH published packages at the
# given version into a throwaway prefix and asserts that what landed on disk really carries that
# version. Its stdout ends with `install-verify=success` / `install-verify=failure`, which is
# exactly the value scripts/record-release-run.mjs wants for `--install-verify`.
#
# Usage:
#   bash scripts/verify-release-install.sh <version>             # real install (network)
#   bash scripts/verify-release-install.sh <version> --dry-run   # args + environment only, no network
#
# Exit 0 only when every installed package's package.json version equals <version>.
# Any failure: stderr `CAUSE=install-verify-failed`, exit 1, and the temp prefix is removed.
set -uo pipefail

RUNTIME_PACKAGE="@yalehwang/archguard"
PLUGIN_PACKAGE="@yalehwang/archguard-claude-plugin"

# Numeric core required; an optional prerelease/build suffix is allowed (1.2.3-rc.1, 1.2.3+build.7).
VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$'

usage() {
  echo "usage: bash scripts/verify-release-install.sh <version> [--dry-run]"
}

# The stdout marker is printed on BOTH paths: it is the machine-readable conclusion, and a caller
# that pipes it into record-release-run.mjs must never get an empty value because the run failed.
succeed() {
  echo "install-verify=success"
  exit 0
}

fail() {
  echo "install-verify=failure"
  echo "CAUSE=install-verify-failed: $1" >&2
  exit 1
}

version=""
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --dry-run) dry_run=1; shift ;;
    -*) echo "unknown flag: $1" >&2; usage >&2; fail "unknown flag: $1" ;;
    *)
      if [ -n "$version" ]; then
        fail "unexpected extra argument: $1"
      fi
      version="$1"
      shift
      ;;
  esac
done

[ -n "$version" ] || fail "version argument is required"

# `not-a-version` and friends die here — before npm is ever consulted — so a malformed version can
# never be mistaken for a registry/network problem.
case "$version" in
  v*) fail "version must be X.Y.Z (no leading 'v'), got: $version" ;;
esac
if ! printf '%s' "$version" | grep -Eq "$VERSION_PATTERN"; then
  fail "version must look like X.Y.Z, got: $version"
fi

command -v npm >/dev/null 2>&1 || fail "npm is not available on PATH"

if [ "$dry_run" -eq 1 ]; then
  succeed
fi

prefix="$(mktemp -d)" || fail "cannot create a temporary install prefix"
cleanup() { rm -rf "$prefix"; }
trap cleanup EXIT INT TERM

if ! npm install --prefix "$prefix" --no-save --no-audit --no-fund \
  "${RUNTIME_PACKAGE}@${version}" "${PLUGIN_PACKAGE}@${version}" >&2; then
  fail "npm install ${RUNTIME_PACKAGE}@${version} ${PLUGIN_PACKAGE}@${version} failed"
fi

for package in "$RUNTIME_PACKAGE" "$PLUGIN_PACKAGE"; do
  manifest="${prefix}/node_modules/${package}/package.json"
  if [ ! -f "$manifest" ]; then
    fail "${package}@${version} did not install (missing ${manifest})"
  fi
  installed="$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$manifest" 2>/dev/null)" ||
    fail "cannot read the installed version from ${manifest}"
  if [ "$installed" != "$version" ]; then
    fail "${package} installed as ${installed}, expected ${version}"
  fi
done

succeed
