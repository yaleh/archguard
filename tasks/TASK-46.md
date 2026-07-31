---
id: TASK-46
title: Make the gopls per-query timeout configurable (env + config, same
  precedence as the startup budget)
status: ready
labels:
  - reliability
  - golang
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

TASK-44 bounded every gopls stage under one startup budget
(`atlas.goplsTimeoutMs`, env > config > 120s default), but the PER-QUERY
`textDocument/implementation` timeout remains a hardcoded 30s in
`GoplsClient.sendRequest`. In a pathological slow-but-responding module,
N interfaces × 30s can still blow far past the configured total budget
without ever tripping the budget guard. Make the per-query timeout
configurable with the same precedence chain, and make the interface matcher
honor the remaining budget across the query set.

Audit observation from TASK-44's landing (non-blocking there; filed here).

## Plan

1. Add `atlas.goplsPerQueryTimeoutMs` (config) + `ARCHGUARD_GOPLS_PER_QUERY_TIMEOUT_MS`
   (env) with precedence env > config > 30000 default; invalid/non-positive
   values fall through (same pattern as the startup budget in
   `resolveEffectiveGoplsTimeoutMs`).
2. Thread the resolved per-query timeout into `GoplsClient.sendRequest` /
   the interface-matcher query path.
3. Optionally (honest minimum): let the matcher cap the remaining total
   budget across the interface set — only if it can be done without
   changing the degradation contract; otherwise document why per-query
   configurability alone suffices.
4. Tests first: precedence (env wins over config; neither → 30000), a slow
   query timing out at the configured value with an injected fake gopls,
   and unchanged degradation behavior.
5. Document both knobs in the golang plugin usage guide.

## Touches

- src/plugins/golang/gopls-client.ts (per-query timeout resolution + sendRequest)
- src/plugins/golang/interface-matcher.ts (honor per-query/remaining budget)
- src/types/config-global.ts (atlas.goplsPerQueryTimeoutMs declaration)
- docs/user-guide/golang-plugin-usage.md (both knobs, precedence table)
- tests/unit/plugins/golang/gopls-client.test.ts
- tests/unit/plugins/golang/interface-matcher.test.ts
- tasks/TASK-46.md

Do NOT modify the startup-budget semantics from TASK-44, shared parser
runtime, CLI/MCP, or non-Go languages.

## Acceptance Criteria

- [ ] Per-query timeout configurable via env + config with documented
      precedence (env > config > 30s default); invalid values fall through.
- [ ] A slow-but-responding gopls query times out at the configured
      per-query value (test with injected fake gopls).
- [ ] TASK-44 degradation/reaping/poison-pill behavior unchanged (existing
      tests green, no weakened assertions).
- [ ] Docs updated; full suite green.

## Definition of Done

- [ ] Tests + docs committed; run summaries appended here.

## Coordination

Overlaps TASK-47 on gopls-client.ts / config-global.ts / docs — the loop
scheduler must serialize them (not touches-disjoint). Independent of
TASK-48/49.
