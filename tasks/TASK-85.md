---
id: TASK-85
title: "TASK-85: analyze 大 package 图渲染上限 500-edge 硬失败——降级/缩放而非 exit 1（默认 303<500 不触发）"
status: ready
labels:
  - defect
  - self-validation
  - hardening
parent: null
children: []
extra: {}
---
# TASK-85: analyze 大 package 图渲染上限 500-edge 硬失败——降级/缩放而非 exit 1

## Proposal

**前提更正（TASK-83 实测，2026-08-11）**：早前判定「master 默认 analyze 确定性 exit 1（521>500）」
是**误报**——那是 TASK-83 执行期误删 tracked `archguard.config.json`（Path-2 测试覆盖它）产生的
测试工件；还原该 config（exclude tests/dist/node_modules/experiments/scripts）后，默认 analyze
exit **0**（package 图 303 edges < 500）。**当前 master 默认自验证路径不失败，非回归。**

但**真实存在的潜在缺陷**：mermaid 渲染 500-edge 上限是硬失败——任何 package 级图超 500 边即
`Worker render failed: Edge limit exceeded` 且 analyze **exit 1**（整体失败，不降级）。触发条件：
仓库继续增长、用户分析大项目无 exclude config、或 config excludes 变化。另有
`src/mermaid/validator-render.ts` 的 `maxEdges = 200` 校验上限需厘清与 500 的关系。

本任务：让超限大图**优雅降级/缩放而非硬失败**，保自验证与外部大项目分析健壮。

### 选定机制（inner 定位后定夺）

1. **提升/推导渲染上限**（500 → 更大或按节点规模）。
2. **大图分块/降级**：超限 package 图自动拆分/降级（如按子包分层），非图产物照出。
3. **渲染失败非致命**：渲染错误降级为警告 + 其余图集照出（若既有契约允许）。

## Acceptance Criteria

- [x] 确认当前默认 analyze exit 0（还原 config 后，303<500）；复现超限失败（构造 >500 边图或临时不加 exclude）
- [x] 定位精确上限点（500 渲染上限 + validator-render maxEdges=200）
- [x] 选定并实现一种机制——超限图不再整体 exit 1
- [x] 不回归默认路径（303 边正常产出）与 `.archguard/output/` 布局（意图）
- [x] lint-clean；相关测试绿

## Touches

- `src/mermaid/validator-render.ts`（及渲染上限所在代码/配置）
- `src/cli/commands/analyze.ts`（若降级路径需改）
- `tasks/TASK-85.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 默认 `analyze -v` exit 0（不回归）且构造超限图不再整体失败（exit 0 或明确降级标记） |
| band | 默认路径 exit 0；超限图有明确降级/警告而非裸 exit 1 |
| invariant | `.archguard/output/` 布局（意图）不破；默认自验证不回归 |
| invoke | worktree 内 `npm run build` + `node dist/cli/index.js analyze -v`（及构造超限场景） |
| control | 撤掉实现 ⇒ 超限图裸 exit 1 复现（负控制） |
| resume | 从「厘清 validator 200 与 render 500 两处上限」续 |

## Definition of Done

- [x] 超限大图不再裸 exit 1（降级或显式警告）；默认路径不回归（exit 0）
- [x] before/after 证据 + 机制说明落盘
- [x] lint-clean，测试绿

## Evidence (2026-08-11, outer dispatch tick)

**前提确认（AC1）**：worktree 内 `npm ci` + build 后，默认 `analyze -v`（还原仓库自有
`archguard.config.json`）**exit 0**，package 图 303 edges < 500——非当前失败，与 TASK-83 更正一致。
超限复现：`analyze -v --exclude "**/*.test.ts" "**/*.spec.ts" "**/node_modules/**"`（不 exclude
experiments/scripts）→ package 图 **525 edges** > 500 → `Worker render failed: Edge limit exceeded`
→ **exit 1**，`.mmd` 已写但 SVG/PNG 缺失、index.md 标 Error。

**两处上限厘清（AC2）**：
- **500**：mermaid 内建 `maxEdges` 默认（`render-worker.ts`/`renderer.ts` 的 `mermaid.initialize`
  未设置 → 用 mermaid schema 默认 500）。这是**硬失败**源——超限即抛、analyze exit 1。
- **200**：`src/mermaid/validator-render.ts` `maxEdges = 200`——只发 **warning** severity
  （非 error），不阻塞渲染。**两处独立**：validator 200 是事前软提示，render 500 是事后硬失败。

**机制选定（AC3，Option 3 渲染失败非致命）**：`DiagramOutputRouter` 新增私有
`renderSvgOrDegrade()`——worker pool 渲染失败 → main-thread `renderSVGRaw` 回退 → 仍失败（超限）
→ **降级为警告**（`.mmd` 已写保留、SVG/PNG 跳过、不抛错）。四个渲染块（default / Atlas / TS module
graph / C++ package）统一改用它。**未提升 500 上限**（机制 1 不解决任意大图）、**未分块**（机制 2
改动面大、风险高）——机制 3 通用且与既有 PNG 降级模式一致。

**验证**：
- 超限（525 edges）after：**exit 0** + 明确降级警告
  `TS module graph SVG skipped (Edge limit exceeded) — MMD saved, no SVG/PNG`；`.mmd` 在、
  index.md 正常列出（无 Error）。
- 默认（303 edges）after：**exit 0** + SVG/PNG 正常产出（不回归）。
- 负控制（AC5/control）：`git stash` src 修复 + rebuild → 超限 **exit 1**（`Failed diagrams:
  Edge limit exceeded`）复现 → 恢复 + rebuild → exit 0。
- 测试：`diagram-output-router.test.ts` 39/39（含原「pool 失败回退 renderSVGRaw」与「pool 成功
  直写 poolResult.svg」契约）；mermaid + processors 全量 **814 passed**；lint 0 errors；
  type-check 0。
- **full suite（after）**：`npx vitest run` = **359 files passed | 3 skipped (362)**；
  **5183 passed | 18 skipped (5201)**；**0 failed**；**exit 0**（router 改动无回归，与 TASK-84
  全绿基线一致）。

**不变性（AC4）**：`.archguard/output/` 布局（意图）未动；默认自验证路径（303 edges）不回归；
仅渲染失败路径改为降级警告。
