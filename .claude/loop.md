# ArchGuard L0 Worker

Poll the GitHub Issue queue for pending development tasks. Work autonomously. Do not ask for clarification.

## Step 0: Reaper — recover stuck tasks

gh issue list --label "in-progress" --state open --json number,updatedAt --limit 10

For each result: if updatedAt is more than 30 minutes ago:
  gh issue edit <number> --remove-label "in-progress" --add-label "agent-run"
  gh issue comment <number> --body "Requeued by L0 reaper: in-progress timeout exceeded 30 minutes."

## Step 1: Claim next task

gh issue list --label "agent-run" --state open \
  --author yaleh \
  --json number,title,body --limit 1

If no results: print "Queue empty." and stop.

## Step 2: Atomic claim

gh issue edit <number> --remove-label "agent-run" --add-label "in-progress"

(Do this immediately. Do not read the issue body first. This minimises the window in which
two sessions could claim the same issue.)

## Step 3: Read and parse

Read the full issue body. Detect the issue format:

**Multi-phase format** (body contains one or more `## Phase` headings):
- Extract all `## Phase X: <title>` sections in order
- For each phase: extract its `### Task` and `### DoD` sub-sections
- Extract global `## Constraints` section if present

**Single-task format** (no `## Phase` headings — legacy):
- Extract `## Task` description
- Extract `## DoD` section (list of shell commands)
- Extract `## Constraints` section if present

## Step 4: Prepare worktree

REPO_ROOT=$(git rev-parse --show-toplevel)
git pull origin master
git worktree add ../archguard-T<number> -b task/T<number>
cd ../archguard-T<number>
ln -s "${REPO_ROOT}/node_modules" ./node_modules
ln -s "${REPO_ROOT}/.agents" ./.agents

Work exclusively inside this worktree. Do not modify the main working tree.

## Step 5: Implement

**Multi-phase**: implement phases in order. For each phase:
1. Implement the work described in `### Task`
2. Run all `### DoD` commands (see Step 6 for retry logic)
3. If pass → post `gh issue comment <number> --body "Phase X ✅"` and continue to next phase
4. If fail after 3 retries → proceed to Step 8 (note which phase failed)

**Single-task**: implement the task described in Step 3.

Follow all constraints. Do not introduce changes outside the described scope.

## Step 6: Verify DoD

Run each DoD command in order. Commands must exit 0.

If all pass → proceed to Step 7.
If any fail → fix and retry (maximum 3 attempts total). If still failing → proceed to Step 8.

## Step 7: Success path

# Append implementation log before committing
SLUG=$(gh issue view <number> --json title -q '.title' \
  | sed 's/^\[L0\] //' | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-' | cut -c1-60)
mkdir -p docs/implemented
printf "\n## %s ✅\nDate: %s\nIssue: #%s\n" \
  "$(gh issue view <number> --json title -q '.title')" \
  "$(date +%Y-%m-%d)" "<number>" >> "docs/implemented/${SLUG}.md"

git add -A
git commit -m "<task title> (closes #<number>)"
gh pr create --title "<task title>" --body "Closes #<number>."

# Run from inside the worktree (../archguard-T<number>) where the branch is checked out:
PR_URL=$(gh pr view --json url -q .url)

# Append PR URL to the log entry
printf "PR: %s\n" "$PR_URL" >> "docs/implemented/${SLUG}.md"
git add "docs/implemented/${SLUG}.md"
git commit --amend --no-edit

# Update issue state before removing worktree (update is idempotent; removal might fail)
gh issue comment <number> --body "PR opened: ${PR_URL}"
gh issue edit <number> --remove-label "in-progress" --add-label "done"
gh issue close <number>

# Remove worktree last; if this fails, run `git worktree prune` manually
cd "${REPO_ROOT}"
git worktree remove ../archguard-T<number>

## Step 8: Failure path

gh issue comment <number> --body "L0 failed after 3 attempts. Last DoD failure:

\`\`\`
<paste the exact failing command and its output>
\`\`\`

Escalating to human."

gh issue edit <number> --remove-label "in-progress" --add-label "needs-human"

Do NOT open a PR. Do NOT close the issue.

cd "${REPO_ROOT}"
git worktree remove ../archguard-T<number> --force
