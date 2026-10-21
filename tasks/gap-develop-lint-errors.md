---
id: gap-develop-lint-errors
title: CI develop Lint 步红（47 errors）：lint:fix + 手动清 3 个 no-unused-vars
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

CI develop 工作流（0.1.42 发布后的 develop push）在 Lint 步红了：`npx eslint src tests --quiet` 报 47 errors —— 44 个 auto-fixable（`prettier/prettier` + `no-unnecessary-type-assertion`）+ 3 个 `no-unused-vars`。这些错误来自 loop 机械 fan-in 落进 develop 的代码（fan-in 门不跑 lint），在 release commit（只动版本载体）之前就存在，与 0.1.42 发布无关。Release 工作流（build+test，无 lint）照常绿、master 照常推进；但 develop 的 CI 红需修掉。

修法：`npm run lint:fix` 自动修 44 个格式错误 + 手动清 3 个未使用导入/类型参数。

## AC

- [x] `npm run lint:fix` 修掉全部 auto-fixable 错误（prettier/prettier + no-unnecessary-type-assertion）
- [x] `src/plugins/shared/parser-runtime.ts` 删除未使用的 `ParserBackend`（:33）与 `ParserRuntimeKind`（:44）导入
- [x] `tests/fixtures/plantuml/src/core.ts` 的 `BaseEntity<T>` 未用泛型 `T` 修复（改名 `_T` 或 eslint-disable，保留泛型 fixture 语义；若 plantuml golden 因改名漂移则同步更新）
- [x] `npm run lint` 退出 0（0 errors，CI Lint 步的精确门）
- [x] 改动的测试文件全绿：`npm test` 通过

## DoD

`npm run lint` 0 errors（exit 0）且 `npm test` 全绿——develop 的 CI Lint 步不再红。

## Touches

- src/cli/mcp/mcp-server.ts
- src/cli/mcp/tools/cognitive-summary-tool.ts
- src/cli/mcp/tools/shape-smell-tools.ts
- src/parser/metrics-calculator.ts
- src/parser/parse-worker-pool.ts
- src/plugins/shared/parser-runtime.ts
- tests/fixtures/plantuml/src/core.ts
- tests/unit/analysis/project-semantics-loader.test.ts
- tests/unit/architecture/layer-imports.test.ts
- tests/unit/cli/cache/diagram-manifest.test.ts
- tests/unit/cli/commands/check.test.ts
- tests/unit/cli/mcp/cognitive-summary-tool.test.ts
- tests/unit/cli/mcp/mcp-server.test.ts
- tests/unit/packaging/plugin-package.test.ts
- tests/unit/scripts/version-carriers-check.test.ts
- tests/unit/skills/arch-layer-review-skill.test.ts
- tasks/gap-develop-lint-errors.md