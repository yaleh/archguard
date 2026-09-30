#!/usr/bin/env bash
# Version-carrier consistency guard (GOAL-001 / AC-003): the six places that carry
# the released version must be verbatim-equal to package.json's version.
#
#   package.json                              .version
#   package-lock.json                         .version
#   package-lock.json                         .packages[""].version
#   .claude-plugin/marketplace.json           .plugins[0].source.version   (npm source pin)
#   plugin/package.json                       .version
#   plugin/.claude-plugin/plugin.json         .version
#
# This is AC-003's criterion landed as an executable check. Note the criterion is the
# weaker "carriers agree with each other" shape: it cannot see a tree whose carriers all
# agree but are all stale. Lifting it to "every carrier == resolveVersion(VERSION)" is
# tracked separately (quay SPEC-release-and-hotfix-branching §12.2).
#
# Usage: bash scripts/check-version-carriers.sh [repo-root]   (default: current directory)
# Exit 0: all six agree — prints `all carriers == <version>` on stdout.
# Exit 1: CAUSE=version-carrier-unreadable — a carrier file is missing / unparseable /
#         carries no version string.
#         CAUSE=version-carriers-disagree  — at least one carrier differs from package.json.
set -uo pipefail

ROOT="${1:-.}"

exec python3 - "$ROOT" <<'PY'
import json, os, sys

root = (sys.argv[1] if len(sys.argv) > 1 else '.').rstrip('/') or '/'


def at(*keys):
    """Build an accessor that walks nested keys/indexes, raising on anything missing."""
    def pick(doc):
        cur = doc
        for key in keys:
            cur = cur[key]
        return cur
    return pick


# label -> (file it is read from, accessor). Order matters: package.json is the reference
# and must come first so the "expected" version is known before anything is compared.
CARRIERS = [
    ('package.json', 'package.json', at('version')),
    ('package-lock.json', 'package-lock.json', at('version')),
    ('package-lock.json#packages[""]', 'package-lock.json', at('packages', '', 'version')),
    ('.claude-plugin/marketplace.json (source pin)', '.claude-plugin/marketplace.json',
     at('plugins', 0, 'source', 'version')),
    ('plugin/package.json', 'plugin/package.json', at('version')),
    ('plugin/.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json', at('version')),
]


def unreadable(detail):
    sys.stderr.write('CAUSE=version-carrier-unreadable: %s\n' % detail)
    sys.exit(1)


docs = {}
got = {}

for label, rel, pick in CARRIERS:
    full = os.path.join(root, rel)
    if full not in docs:
        try:
            with open(full, encoding='utf-8') as handle:
                docs[full] = json.load(handle)
        except FileNotFoundError:
            unreadable('%s — file not found' % rel)
        except Exception as exc:  # unparseable JSON, permission denied, ...
            unreadable('%s — cannot parse (%s)' % (rel, exc))
    try:
        got[label] = pick(docs[full])
    except Exception:
        unreadable('%s — no version at "%s"' % (rel, label))

core = got['package.json']

bad = {k: v for k, v in got.items() if v != core}

if bad:
    sys.stderr.write(
        'CAUSE=version-carriers-disagree — 期望全部等于 %s，实际不符：%s\n' % (core, bad)
    )
    sys.exit(1)

print('all carriers == %s' % core)
sys.exit(0)
PY
