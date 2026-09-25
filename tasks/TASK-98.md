---
id: TASK-98
title: "TASK-98: 测试分析只看最大 scope 的 workspaceRoot，且零测试诊断文案写死、与实际原因不符"
status: ready
labels:
  - gap
  - defect
  - mcp
  - test-analysis
parent: null
children: []
extra: {}
---
## Proposal

两处叠加造成误导：
1. `src/cli/analyze/run-analysis.ts` 的 test analysis 段用 `processor.getLastArchJson()`（实体最多者胜）的 `workspaceRoot` 作为测试发现范围。测试目录不在被分析的源根之下时（实测：测试都在 `plugin/test`，共 545 个文件，源目录是 `plugin/scripts` 等），发现结果为 0，且没有任何参数能指定测试目录。
2. `src/cli/mcp/tools/test-analysis-tools.ts` 的 `buildZeroTestsDiagnosticResponse` 文案写死：「scope 只覆盖 src/ 而不含 tests/」「用 --include-tests 重跑」，不检查是否已传 `includeTests`。实测已传 `includeTests:true` 仍被建议加该参数；同时它读的是引擎加载的 scope，全局 key 过期时会读到旧数据。

方案：(a) `archguard_analyze` 与 CLI 增加 `testSources`（测试目录列表，默认行为不变）；(b) 诊断文案按实际情况分支：是否有测试分析产物、`testSources` 或源根是什么、测试发现命中的 glob 与目录，以及建议使用 MCP 参数名 `includeTests`/`testSources` 而不是 CLI flag；(c) 诊断里回显所读 scope 的 key 与 generatedAt。

<!-- dedup-ref -->
相关但机制不同：TASK-89（多 source 丢弃）、TASK-90（全局 key 选取）。本任务只处理测试发现的范围与诊断文案。

## AC

- [x] `npx vitest run tests/unit/cli/mcp/test-analysis-scope.test.ts` exit 0，新增用例：已做测试分析但发现 0 个测试时，诊断不再建议「加 includeTests」，而是列出实际的测试发现根目录与 `testSources` 用法
- [x] `npx vitest run tests/unit/cli/mcp/test-analysis-mcp.test.ts` exit 0（回归）
- [x] `npx vitest run tests/unit/cli/analyze/run-analysis.test.ts` exit 0，新增用例：传 `testSources` 指向源根之外的目录时，测试分析发现该目录下的测试文件
- [x] `npx vitest run tests/unit/cli/mcp/analyze-tool.test.ts` exit 0，`testSources` 透传用例
- [x] `npm run type-check && npm run lint` exit 0

## DoD

对一个测试目录与源目录互为兄弟（不嵌套）的真实布局（如本仓库 `plugin/scripts` 与 `plugin/test`），通过 MCP `archguard_analyze`（`includeTests:true` 加 `testSources`）后 `archguard_get_test_metrics` 返回非零测试文件数；不传 `testSources` 时诊断能说出「测试不在被分析的源根下」。

## Touches

- `src/cli/analyze/run-analysis.ts`
- `src/cli/mcp/analyze-tool.ts`
- `src/cli/mcp/tools/test-analysis-tools.ts`
- `src/types/config-cli.ts`
- `src/analysis/test-analyzer.ts`
- `src/cli/commands/analyze.ts`
- `src/types/extensions/test-analysis.ts`
- `tests/unit/cli/mcp/test-analysis-scope.test.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`
- `tests/unit/cli/mcp/analyze-tool.test.ts`
- `tests/unit/analysis/test-analyzer.test.ts`
- `tasks/TASK-98.md`
