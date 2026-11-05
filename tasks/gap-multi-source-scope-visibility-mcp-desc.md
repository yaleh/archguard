---
id: gap-multi-source-scope-visibility-mcp-desc
title: archguard_analyze sources 描述未写明「每 source 独立 scope、跨 scope 边不可见」（DSI
  B3，docs 已写 MCP desc 漏）
status: todo
labels:
  - gap
  - docs
  - mcp
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：quay-fleet DSI 开发域残差原子 B3——「多 source 各成独立 scope、scope 间边不可见」这一约定只写了 docs（`gap-doc-multi-source-scope-cross-directory-edges` 已落），但 `archguard_analyze` 的 MCP 工具 `sources` 参数描述没写，模型先验里没有、又不会去翻 docs。

**现象（核实）**：`src/cli/mcp/analyze-tool.ts:36-38` 的 `sources` 参数描述只有「Source paths relative to the target project root. Omit to analyze the project root.」——没有说明每个 source 各自成一个 scope、scope 间边不可见、要跨目录分析用共同上层根。

**修复方向（纯文档，不改行为）**：在 `sources` 参数 describe 里补一句：多个 source 各自成为独立 query scope、scope 之间的边不可见；要跨目录分析需给它们一个共同的上级根（或只传一个根）。

## AC

- [ ] `archguard_analyze` 的 `sources` 参数描述包含「each source becomes an independent scope；cross-scope edges are not visible；pass a common parent root to see edges across them」等价语义
- [ ] 负对照（纯文档）：本次改动不改变任何分析/scope 生成行为；`git diff` 只含 `analyze-tool.ts` 的 description 字符串
- [ ] 相关测试仍绿：`tests/unit/cli/mcp/analyze-tool.test.ts` 通过（若断言旧描述则同步更新）
- [ ] `npm run type-check` 通过

## DoD

不是「加一句描述」就算完成。要给出改动前后 `sources` 描述字符串的 diff，证明「跨 scope 边不可见 + 用共同上层根」从接口描述即可读出；并确认无任何实现行为被改动（diff 只含描述）。

## Touches

- tasks/gap-multi-source-scope-visibility-mcp-desc.md
- src/cli/mcp/analyze-tool.ts
- tests/unit/cli/mcp/analyze-tool.test.ts
