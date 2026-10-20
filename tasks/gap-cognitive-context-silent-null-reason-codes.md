---
id: gap-cognitive-context-silent-null-reason-codes
title: cognitive/CCB/project-semantics 的 found:false 与 null 字段带 reason code，缺
  project-semantics 显式报缺
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

cognitive/context 层把多种「没有」混成一个静默 false/null：`get_cognitive_summary` 的 `found:false` 无法区分「实体不在图 / 在图但无 cognitive artifact / id 格式不匹配」（`cognitive-summary-tool.ts:85-87`）；`get_ccb` 的 behavioral/git/guidance 与 testCoverageRatio 等字段在缺 project-semantics 时静默 null；project-semantics 缺失也无显式 preflight。实测出现 find_entity 查得到而 cognitive `found:false`、ccb `structural.found:false` 而 cognitive `found:true` 的自相矛盾。修法：所有 found:false/null 字段带 reason code，project-semantics 缺失显式报缺。

## AC

- [x] `archguard_get_cognitive_summary` 的 `found:false` 附带 reason code（`not-in-graph` / `in-graph-no-artifact` / `id-format-mismatch`），`tests/unit/cli/mcp/cognitive-summary-tool.test.ts` 有断言
- [x] `archguard_get_ccb` 的 null 字段（behavioral/git/guidance/coverage）带 reason 或 `not-collected` 标记，不再裸 null；`tests/unit/cli/mcp/ccb-tool.test.ts` 有断言
- [x] project-semantics 缺失时显式返回 `projectSemantics: "missing"`（或等价 preflight），而非静默把 testCoverageRatio/entityCoverageRatio 置 null；`tests/unit/analysis/project-semantics-loader.test.ts` 有断言

## DoD

在 claudecodeui 的 `ChatComposer`（memo 组件）与一个无 project-semantics 的 scope 上，`get_cognitive_summary`/`get_ccb` 能各自说出「为什么没有」——修完 memo/forwardRef（gap-ts-parser-hoc-memo-forwardref-entities）后 find_entity 与 cognitive 对同一实体给出一致结论。

## Touches

- src/cli/mcp/tools/cognitive-summary-tool.ts
- src/cli/mcp/tools/ccb-tool.ts
- src/cli/cognitive/ccb-assembler.ts
- src/analysis/project-semantics-loader.ts
- tests/unit/cli/mcp/cognitive-summary-tool.test.ts
- tests/unit/cli/mcp/ccb-tool.test.ts
- tests/unit/analysis/project-semantics-loader.test.ts
- tasks/gap-cognitive-context-silent-null-reason-codes.md