## Go Atlas Pattern Detection

Status: backlog

Scope:

- worker-pool detection
- pipeline detection
- fan-out / fan-in detection
- mapping detected patterns onto `GoroutinePattern`

Current behavior:

- `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts` returns `undefined` from `classifyPattern()`
- renderer output remains stable and does not claim unsupported pattern inference

Deferral reason:

- this refactor focuses on structural decomposition, deterministic rendering, and compatibility preservation
- implementing pattern detection now would expand behavior scope beyond the current refactor gate
