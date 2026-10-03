# Plan A4 — Declared-Layer Direction Check + Architecture View

> Proposal: `docs/proposals/proposal-architecture-layer-check.md` (Approved v2, 2026-10-03)
> Review task: `gap-a4-architecture-layer-check-proposal-review`
> Status: Active — 阶段 0/0.5/1/A0 均已完成（2026-10-03）；阶段 2–4 的入口形态裁定点**现已到**，待人裁定
> Priority: MEDIUM

---

## Overview

把「声明层 → 确定性方向检查 → 单页展示」从外部原型（`docs/experiments/layer-map/`）落成 ArchGuard 的内置能力。

三条已生效的评审裁定约束本计划：

1. **层声明是「路径 → 层」的唯一正本**（裁定 3 / 方案 1）。`project-semantics.json` 的
   `architecturalLayers` 降为 analyze 时的派生投影，渲染器不改，无声明时行为不变。
2. **入口形态延后裁定**（裁定 2）。先修 fitness 引擎死桩，看到其真实能力后再定
   「扩展 `archguard check`」还是「独立 `check-layers` 子命令」。
3. **先补阶段 0/1 验收**（裁定 4）。检查器的正确性整体依赖 moduleGraph 边集合完整，先独立对账。

### Proposal-to-Phase mapping

| Proposal 阶段 | Plan 阶段 | 内容 | 任务 | 状态 |
|---|---|---|---|---|
| 0 | — | moduleGraph 边集合完整 | `gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges` | done |
| 1 | — | type-only / 值依赖拆分 | `gap-ts-module-graph-type-only-edge-split` | done |
| —（评审新增） | **0.5** | 阶段 0/1 验收补回：独立位置判定对账 | `gap-verify-module-graph-edge-completeness` | done |
| —（评审新增） | **A0** | 修 fitness 引擎死桩 | `gap-fitness-check-relations-stub`、`gap-query-cycles-ignores-output-scope-package` | done |
| 2 | **B** | 层声明 schema + 检查器内核 + 基线（**入口形态待裁定**） | 未立项 | blocked |
| 3 | **C** | 单页展示 + 确定性输出 + `--check` | 未立项 | blocked |
| 4 | **D** | 编排 skill + 起草 subagent + discovery skill 改产出 | 未立项 | blocked |

**当前状态（2026-10-03）**：阶段 0/0.5/1/A0 全部落地；阶段 B/C/D 仍阻塞在入口形态裁定上。

- **0.5**：独立对账脚本（`docs/experiments/layer-map/verify-edge-completeness.mjs`，不读 moduleGraph）
  在 archguard 自身与 quay 两个真实项目上 internal 漏边/多报均为 0/0，
  `strength === typeOnlyStrength + valueStrength` 逐条成立，type-only 判定与独立扫描一致。
  过程中发现的类型位置 `import('...')` 与 external 边两类漏边已另立 gap 任务并已完成
  （见 proposal 的两条「补记」）。
- **A0**：`check.ts` 不再硬编码空 relations —— 真实禁止方向得退出码 1 并打印具体边，无产物得
  `NOT-EVALUATED`（退出码 2）；CLI `query --cycles --output-scope package` 对 archguard 自身
  返回 4 个目录级 SCC（修前同参数报「无环」）。

**下一人动作**：按裁定 2 定入口形态（见「A0 完成后的裁定点（人，现已到）」），随后立阶段 B/C/D 任务。

---

## 阶段 0.5 — 阶段 0/1 验收补回

**任务**：`gap-verify-module-graph-edge-completeness`（**done**，2026-10-03）

**为什么**：阶段 0/1 两个 gap 任务的 AC 是修前树写的、只验证了各自缺口。检查器内核一旦建在其上，
边集合的任何遗漏都会变成检查器的静默漏报。补一组独立对账：

- （a）独立的位置判定扫描（按行首 `import/export … from`，含 `export * from`、动态 `import()`、
  裸 `@/` 别名按 tsconfig `paths` 解析）与 `extensions.tsAnalysis.moduleGraph.edges` 对账。
- （b）每条边校验 `strength === typeOnlyStrength + valueStrength`，type-only 判定与独立扫描一致。
- 范围：archguard 自身 + quay 两个真实项目。

**出口条件**：两项目各产出可复读的对账结果；漏边为 0 或逐条归因；若发现新漏边，立新 gap 任务，
不在本阶段内顺手修。

**结果**：两项目（archguard 自身、quay `packages/`）对账均 `pass`，internal 漏边/多报 0/0，
拆分母等式与 type-only 判定全部一致；`mg.unresolved` 与 `mg.unevaluatedDynamicImports` 与独立扫描逐一吻合。
对账过程中发现两类偏差（external 边解析相关、类型位置 `import('...')` 整类不产边），
已按出口条件**另立**两个 gap 任务（`gap-ts-module-graph-external-edge-resolution-dependent`、
`gap-ts-module-graph-misses-type-position-import-type`）并均已完成，未在本阶段内顺手修。

---

## 阶段 A0 — 修 fitness 引擎死桩（形态裁定的前置）

**任务**：`gap-fitness-check-relations-stub`、`gap-query-cycles-ignores-output-scope-package`（均 **done**，2026-10-03）

**为什么**：`archguard check` 已有一等规则引擎（`fitness.rules` + `no-dependency`），但
`src/cli/commands/check.ts:59` 硬编码空 `relations`，规则永不生效；CLI `query --cycles` 又忽略
`--output-scope`（MCP 侧同类缺陷已在 37005f9a 修复，CLI 侧漏修）。这两条决定了阶段 B 入口形态的
选择依据——引擎能不能承载层方向检查，取决于它修完之后的真实形状。

**出口条件**：两个任务 done，各自有真实项目上的非零退出码 / 非空输出证据。

**结果**：两任务各自的 DoD 均以真实项目证据满足——`archguard check` 对真实禁止方向返回退出码 1
并打印具体违例边（修前同配置恒为 0），无产物时返回 `NOT-EVALUATED` 且退出码 2（不再与 pass 同形）；
CLI `query --cycles --output-scope package` 对 archguard 自身返回 4 个目录级 SCC（size 13/10/2/2），
修前同参数打印「No dependency cycles detected.」。据此引擎的真实形状已可见，入口形态裁定所需依据齐备。

**A0 完成后的裁定点（人，现已到）**：入口形态 = 扩展 `archguard check` 的 fitness 规则类型，还是独立
`archguard check-layers` 子命令？命令名？是否同时提供 MCP 工具？编排 skill 是否放进 archguard plugin？

---

## 阶段 B — 层声明 schema + 检查器内核 + 基线（blocked on A0 裁定）

**内容**（形态确定后细化并立任务）：

- 层声明文件 schema：`layers: {name: {rank, globs}}` + `ignore` + `allowed` + `known_violations`，
  含 YAML schema 校验；非法/不可解析输入一律 `not-evaluated`。
- 检查器：确定性、不含 LLM；输入目录级边 + 层声明；三态 pass / fail / not-evaluated；
  type-only 与值依赖分别计数；棘轮基线只减不增。
- 投影：analyze 时按每包对 `globs` 最长匹配，投影出 `architecturalLayers` 注入
  `ArchJSON.extensions.projectSemantics`（裁定 3）。**渲染器不改**；无声明文件时行为不变。
- 出口码：0 通过 / 1 有新增违例 / 2 未评估。

**验收需覆盖的成对夹具**（来自原型踩坑）：注释/字符串里的路径提及**不得**产生边；
真实代码**不得**被当成注释（原型正则剥块注释曾吞掉真实代码）；空图与 glob 全不匹配 → `not-evaluated`，
不得与 pass 同形。

**入口形态未定前不立任务**——这部分是本阶段最大的未决变量。

---

## 阶段 C — 单页展示 + 确定性输出 + `--check`（blocked on B）

- 单页 HTML：层按 rank 分行、违例表（方向、基线/新增、目录级边数、值依赖数、type-only 数、示例文件）、
  覆盖缺口说明。
- 输出确定性：排序稳定、不嵌生成时间（数据时间戳作为输入单独显示）；`--check` 模式盘上产物与重新
  生成不一致则非零退出。
- **AC 必须包含浏览器目视验证**——原型只在字符串层验证过（裁定 1 的开放问题处置 5）。
- Mermaid component 图作为可选输出，沿用现有渲染链路。

---

## 阶段 D — 编排 skill + 起草 subagent（blocked on B、C）

- 编排 skill：引导 分析 → 起草层声明 → 人审 → 检查 → 展示；把已知陷阱写进 skill
  （关键词 grep 把注释当 import；读到旧产物目录；别名路径造成重复 scope）。
- 起草 subagent：仅起草层声明初版，输出标注「未经人审」。
- `project-semantics-discovery`：产出形状从 `architecturalLayers` 改为起草**层声明**（裁定 3）。

---

## 风险

- **入口形态未定**是阶段 B 的最大不确定性；A0 完成前不立 B 的任务。
- 层声明维护成本：目录重组会使 glob 失效 → 必须 `not-evaluated` 而非 pass（已在设计内）。
- 多语言：本计划只覆盖 TS；Go 已有 Atlas 包图，Java/Python 另行评估。
- 运行时耦合（quay A3）与本提案互相独立，不在范围内。
