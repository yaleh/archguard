# Phase 76.2 — Rewrite Prompt Smoke Test

**Status: PENDING**

LLM_BASE_URL and LLM_API_KEY are not set in the current environment.
This smoke test must be run manually after setting credentials:

```bash
export LLM_BASE_URL="<your-rewrite-model-base-url>"
export LLM_API_KEY="<your-api-key>"
npx tsx scripts/rewrite-smoke.ts
```

Per plan Phase 76.2: 3 rewrite arms (rewrite-Haskell / rewrite-JSON / rewrite-clean-prose),
each arm sends k=1 rewrite request, then runs p_f(rewrite_output) == C roundtrip check.
Any C' != C instances are recorded as H-info deviations (D-76.x).

This placeholder was created because credentials were unavailable at freeze time.
Completing this test before Phase 78 data collection is mandatory.
