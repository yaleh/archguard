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

Read the full issue body. Extract:
- The task description
- The `## DoD` section (list of shell commands)
- The `## Constraints` section if present

## Step 4: Prepare worktree

git worktree add ../archguard-T<number> -b task/T<number>
cd ../archguard-T<number>
npm ci --silent --prefer-offline

Work exclusively inside this worktree. Do not modify the main working tree.

(Note: `--prefer-offline` reuses cached packages from `~/.npm`; a full download still occurs
if the cache is empty. The worktree shares git objects with the main tree but has its own
`node_modules` directory.)

## Step 5: Implement

Implement the task described in Step 3. Follow all constraints. Do not introduce changes
outside the scope described.

## Step 6: Verify DoD

Run each command from the `## DoD` section. Commands must exit 0.

If all pass → proceed to Step 7.
If any fail → fix and retry (maximum 3 attempts). If still failing after 3 attempts → proceed to Step 8.

## Step 7: Success path

git add -A && git commit -m "<task title> (closes #<number>)"
gh pr create --title "<task title>" --body "Closes #<number>." --label "ready-for-review"

# Run from inside the worktree (../archguard-T<number>) where the branch is checked out:
PR_URL=$(gh pr view --json url -q .url)

# Update issue state before removing worktree (update is idempotent; removal might fail)
gh issue comment <number> --body "PR opened: ${PR_URL}"
gh issue edit <number> --remove-label "in-progress" --add-label "done"
gh issue close <number>

# Remove worktree last; if this fails, run `git worktree prune` manually
cd /home/yale/work/archguard
git worktree remove ../archguard-T<number>

## Step 8: Failure path

gh issue comment <number> --body "L0 failed after 3 attempts. Last DoD failure:

\`\`\`
<paste the exact failing command and its output>
\`\`\`

Escalating to human."

gh issue edit <number> --remove-label "in-progress" --add-label "needs-human"

Do NOT open a PR. Do NOT close the issue.

cd /home/yale/work/archguard
git worktree remove ../archguard-T<number> --force
