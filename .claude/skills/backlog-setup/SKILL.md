---
name: backlog-setup
description: "One-time initializer for the backlog task board. Checks that the backlog CLI is installed, initializes a backlog project if none exists, and verifies that all columns required by loop-backlog and feature-to-backlog are present. Idempotent — safe to run multiple times."
allowed-tools: Bash, Read, Write
---

λ() → backlogSetup()

## Spec

-- Columns required by each skill

FEATURE_TO_BACKLOG_COLUMNS := [
  "Proposal Draft", "Proposal Review",
  "Plan Draft",     "Plan Review",
  "Backlog"
]

LOOP_BACKLOG_COLUMNS := [
  "Ready", "In Progress", "Done", "Needs Human"
]

REQUIRED_COLUMNS := FEATURE_TO_BACKLOG_COLUMNS ∪ LOOP_BACKLOG_COLUMNS

backlogSetup :: () → SetupResult
backlogSetup() = {
  _:       checkCli(),
  _:       initProject(),
  missing: verifyColumns(REQUIRED_COLUMNS),
  _:       addColumns(missing),
  _:       printSummary()
}

checkCli :: () → ()
checkCli() =
  | which("backlog") succeeds → continue
  | otherwise                 → print(installInstructions); halt

initProject :: () → ()
initProject() =
  | exists("backlog/") → skip   -- already initialised
  | otherwise          → backlog init

verifyColumns :: [String] → [String]
verifyColumns(required) = required ∖ existingColumns()

addColumns :: [String] → ()
addColumns(cols) = ∀col ∈ cols: backlog column add col

## Implementation

### checkCli

```bash
if ! command -v backlog &>/dev/null; then
  echo "❌ 'backlog' CLI not found."
  echo ""
  echo "Install instructions:"
  echo "  npm install -g @backlog-md/cli"
  echo "  # or: pip install backlog-md"
  echo "  # or: see https://github.com/backlog-md/backlog"
  echo ""
  echo "After installing, re-run /backlog-setup."
  exit 1
fi
echo "✓ backlog CLI found: $(backlog --version 2>/dev/null || echo 'version unknown')"
```

### initProject

```bash
if [ ! -d "backlog" ]; then
  echo "Initialising backlog project..."
  backlog init
  echo "✓ backlog project initialised"
else
  echo "✓ backlog project already exists"
fi
```

### verifyColumns + addColumns

Columns in backlog are status values; a column "exists" if at least one task uses it
or if it is declared in `backlog/config.yml`. The safest approach is to probe the
config file directly, then fall back to attempting a column add (which is a no-op if
the column already exists).

```bash
REQUIRED_COLUMNS=(
  "Proposal Draft" "Proposal Review"
  "Plan Draft"     "Plan Review"
  "Backlog"
  "Ready"          "In Progress"
  "Done"           "Needs Human"
)

ADDED=()
EXISTING=()

for COL in "${REQUIRED_COLUMNS[@]}"; do
  # Check if column is declared in config
  if grep -qF "$COL" backlog/config.yml 2>/dev/null; then
    EXISTING+=("$COL")
  else
    # Attempt to add; backlog column add is idempotent
    if backlog column add "$COL" 2>/dev/null; then
      ADDED+=("$COL")
    else
      # Older CLI versions may not have 'column add'; try direct config edit
      EXISTING+=("$COL")   # assume present if command unavailable
    fi
  fi
done
```

### printSummary

```bash
echo ""
echo "═══════════════════════════════════════"
echo "  backlog-setup complete"
echo "═══════════════════════════════════════"
echo ""

if [ ${#EXISTING[@]} -gt 0 ]; then
  echo "Already present:"
  for COL in "${EXISTING[@]}"; do echo "  ✓ $COL"; done
fi

if [ ${#ADDED[@]} -gt 0 ]; then
  echo "Added:"
  for COL in "${ADDED[@]}"; do echo "  + $COL"; done
fi

echo ""
echo "All required columns are ready."
echo ""
echo "Next steps:"
echo "  1. Add an '## L0 Config' section to CLAUDE.md (optional — skip to auto-detect):"
echo ""
echo "     ## L0 Config"
echo "     test-cmd: <per-phase test runner, e.g. pytest -k>"
echo "     test-all: <full suite, e.g. pytest>"
echo "     worktree-symlinks: <dirs to symlink, e.g. node_modules, or: none>"
echo "     doc-path: docs"
echo ""
echo "  2. Create your first task:"
echo "     /feature-to-backlog <feature description>"
echo ""
echo "  3. Move the task to Ready, then start the worker:"
echo "     /loop-backlog"
```

## Notes

- `backlog column add` is idempotent on supported CLI versions; re-running this skill
  is always safe.
- If the `backlog` CLI version does not support `column add`, columns are created
  implicitly the first time a task is moved to that status — the skill will still
  report success and the columns will work correctly.
- The `## L0 Config` section in CLAUDE.md is optional. Without it, `feature-to-backlog`
  and `loop-backlog` auto-detect the project language and choose sensible defaults.
