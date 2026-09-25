---
id: TASK-89
title: "TASK-89: analyze 传多个 sources 只处理第一个、其余静默丢弃，且响应不列出 scope"
status: todo
labels:
  - gap
  - defect
  - mcp
  - query
parent: null
children: []
extra: {}
---
## Proposal

`archguard_analyze`（MCP）和 `analyze -s a b`（CLI）传多个 source 时只处理第一个，其余静默丢弃。机制（源码核实）：`src/cli/analyze/normalize-to-diagrams.ts` 里除 Go 外的每个分支（TS/Python 通用分支、语言 detector、unknown 自动探测）都只取 `cliOptions.sources[0]`；`config.diagrams` 一旦存在会整体覆盖 `sources`，同样不报。MCP 响应（`src/cli/mcp/analyze-tool.ts` 的 `formatAnalyzeResponse`）只打印 "N scopes written"，没有 scope key、路径、实体数，调用方无从发现丢弃。实测：传 5 个 sources 只写出 1 个 scope（810 实体，等于单独分析第一个目录）。

方案：
1. 非 Go 语言对 `sources` 逐个走现有单 source 逻辑，合并各自的 diagrams（最小改动，不重写检测器）。
2. 不同 source 的 basename 相同时给 diagram name 加消歧后缀，避免互相覆盖输出（`plugin/scripts/archguard-runner.ts` 已踩过这个坑）。
3. `config.diagrams` 与 sources 同时出现时发 warning，明确说明 sources 被忽略。
4. `RunAnalysisResult` 暴露 `persistQueryScopes` 返回的 scope 条目；MCP 响应和 CLI verbose 输出逐 scope 打印一张表（key、sources、entityCount、kind/role）。

<!-- dedup-ref -->
相关但机制不同：TASK-90（全局 scope key 选取规则）、TASK-92（scope key 哈希前 realpath）。三者都出自 quay 对 archguard 使用情况的分析报告，各自独立落地。

## AC

- [ ] `npx vitest run tests/unit/cli/analyze/normalize-to-diagrams.test.ts` exit 0，且新增用例断言：TS 传 2 个不同 source 时返回的 diagrams 覆盖两个 source（sources 集合相等）；两个 source basename 相同时 diagram name 互不相同
- [ ] 同一测试文件新增用例：`config.diagrams` 存在且传了 sources 时产生 warning（断言 warning 文案包含 "sources"）
- [ ] `npx vitest run tests/unit/cli/mcp/analyze-tool.test.ts` exit 0，新增用例断言响应含逐 scope 表，且表行数等于 `queryScopesPersisted`
- [ ] `npx vitest run tests/unit/cli/analyze/run-analysis.test.ts` exit 0，新增用例断言 `RunAnalysisResult` 携带 scope 条目
- [ ] 实操：`npm run build` 后对两个不同目录的 fixture 执行 `node dist/cli/index.js analyze -s <dirA> <dirB> --output-dir <tmp>`，读 `<work-dir>/query/manifest.json`，`scopes` 至少含两个 key 且各自 `sources` 指向对应目录
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

对一个真实的多 source 输入（至少 2 个互不重叠的目录）实际跑过 CLI 与 MCP `archguard_analyze` 两条入口，manifest 里的 scope 数等于去重后的 source 数，响应里的 scope 表与 manifest 逐项一致；不再存在任何 sources 被静默忽略的路径（要么处理、要么显式 warning）。仅有单元测试不算完成。

## Touches

- `src/cli/analyze/normalize-to-diagrams.ts`
- `src/cli/analyze/run-analysis.ts`
- `src/cli/mcp/analyze-tool.ts`
- `tests/unit/cli/analyze/normalize-to-diagrams.test.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`
- `tests/unit/cli/mcp/analyze-tool.test.ts`
- `tasks/TASK-89.md`
