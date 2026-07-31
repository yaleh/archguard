---
id: TASK-49
title: Wire the real codex-exec LLM-driven tool-call boundary test + complete
  AC6 evidence when credentials exist
status: ready
labels:
  - install
  - mcp
  - codex
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

TASK-36 evidenced the REAL codex connection layer (`codex mcp list/get`
parse the installer-written TOML, archguard enabled) and REAL MCP
tool calls driven over the exact configured stdio command — but NOT an
LLM-driven tool call inside a `codex exec` agent session: the attempt
fails at the model backend (`401 Unauthorized` from
api.openai.com/v1/responses — no OpenAI credentials in this environment).
Close the gap as far as this environment allows: add a real `codex exec`
boundary test that RUNS the full LLM-driven archguard tool call when
credentials are present (it.skipIf when absent), and document the exact
remaining boundary in TASK-36's task body.

Environment reality (be honest about it): without OPENAI_API_KEY the
LLM-driven leg cannot execute; the deliverable then is the wired,
skipping cleanly test + boundary documentation, with the evidence AC
completing itself the moment credentials exist.

## Plan

1. Add to tests/integration/installer-codex-user-scope.test.ts: a real
   `codex exec` test — isolated CODEX_HOME/HOME, installer-written config,
   a prompt that forces an archguard tool call (e.g. archguard_summary on
   a tiny fixture project), asserting the tool call appears in the session
   output. Gate: `it.skipIf(!realCodexAvailable || !openAiCreds)` —
   detect creds via OPENAI_API_KEY env only (never log or print the key).
2. Verify the skip path is clean and the run path works IF creds exist in
   the current environment (check `printenv OPENAI_API_KEY >/dev/null`);
   if they exist, capture the real evidence.
3. Update tasks/TASK-36.md AC6 note with the new test's status and any
   captured evidence; update this task's Evidence with REAL vs SIMULATED
   labeling.
4. Do NOT add fake-credential mocks that simulate the LLM leg — the point
   is the real boundary; simulated tool-call coverage already exists via
   the stdio JSON-RPC tests.

## Touches

- tests/integration/installer-codex-user-scope.test.ts (real codex exec boundary test)
- tasks/TASK-49.md
- tasks/TASK-36.md (AC6 boundary note update ONLY — no other edits)

Do NOT modify installer code, fixtures, README/docs, or touch real user
config (~/.codex) outside isolated temp dirs.

## Acceptance Criteria

- [ ] Real `codex exec` LLM-driven tool-call test exists, runs under
      isolated config, and skips cleanly (documented reason) when
      codex or OpenAI credentials are absent.
- [ ] If credentials are present in the environment: the test runs for
      real and the captured tool-call evidence is appended here and in
      TASK-36's AC6 note. If absent: both task bodies state the exact
      boundary (401, no OPENAI_API_KEY) — NOT checked as satisfied.
- [ ] Existing 44 installer tests unchanged and green; suite green.

## Definition of Done

- [ ] Test committed; evidence/boundary status appended here.

## Coordination

Independent of TASK-46/47/48 (disjoint). If credentials never appear in
this environment, the honest terminal state is needs-human with the
boundary documented — do not fake evidence to reach `done`.
