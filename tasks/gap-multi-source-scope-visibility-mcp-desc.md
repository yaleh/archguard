---
id: gap-multi-source-scope-visibility-mcp-desc
title: archguard_analyze sources 描述未写明「每 source 独立 scope、跨 scope 边不可见」（DSI
  B3，docs 已写 MCP desc 漏）
status: ready
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

- [x] `archguard_analyze` 的 `sources` 参数描述包含「each source becomes an independent scope；cross-scope edges are not visible；pass a common parent root to see edges across them」等价语义
- [x] 负对照（纯文档）：本次改动不改变任何分析/scope 生成行为；`git diff` 只含 `analyze-tool.ts` 的 description 字符串
- [x] 相关测试仍绿：`tests/unit/cli/mcp/analyze-tool.test.ts` 通过（若断言旧描述则同步更新）
- [x] `npm run type-check` 通过

## DoD

不是「加一句描述」就算完成。要给出改动前后 `sources` 描述字符串的 diff，证明「跨 scope 边不可见 + 用共同上层根」从接口描述即可读出；并确认无任何实现行为被改动（diff 只含描述）。

### Evidence（落地时记录）

`sources` 描述字符串 before → after（唯一实现改动）：

```diff
-      'Source paths relative to the target project root. Omit to analyze the project root.'
+      'Source paths relative to the target project root. Omit to analyze the project root. ' +
+        'Each source becomes an independent query scope: dependency edges are complete within ' +
+        'a scope, but cross-scope edges are not visible (neither scope records them). ' +
+        'To see edges between directories, pass a common parent root (or a single root) as one source instead.'
```

三条语义逐句可读出：

- 每个 source 独立成 scope：`Each source becomes an independent query scope`
- 跨 scope 边不可见：`cross-scope edges are not visible (neither scope records them)`
- 跨目录要看边就用共同上层根：`pass a common parent root (or a single root) as one source instead`

负对照（纯文档，无行为改动）：

- `git diff --numstat develop...HEAD` = `4	1	src/cli/mcp/analyze-tool.ts`——单文件、单 hunk，全部落在 `sources` 字段的 `.describe(...)` 字符串字面量内；未触碰任何分析/scope 生成/输出路径。
- `npm run type-check`（`tsc --noEmit`）通过。
- `npx vitest run tests/unit/cli/mcp/analyze-tool.test.ts` → 25/25 通过（现有测试未断言旧描述字符串，无需同步更新）。
- anti-drift Touches 检查：`ANTI-DRIFT OK … 1 actual file(s), all within declared Touches (3 glob(s))`。

- L_D docLines=0 codeLines=4 ratio=0.000 verdict=ok（git diff --numstat：src/cli/mcp/analyze-tool.ts +4/−1（净 +3），0 行 .md/.txt；doc:code = 0:4）

## Touches

- tasks/gap-multi-source-scope-visibility-mcp-desc.md
- src/cli/mcp/analyze-tool.ts
- tests/unit/cli/mcp/analyze-tool.test.ts

## Blocker

**2026-11-05T16:25:18.925Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: suite red
- run_id：wk-prod-anchor
- session_id：bc82d66b-16ec-47e5-b7c7-686c9ba02188
