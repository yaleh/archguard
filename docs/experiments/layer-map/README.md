# 多层架构展示 + 语义映射（实验原型）

目的：验证"ArchGuard 输出 → 人审的层声明 → 确定性方向检查 → 单页展示"这条流程在本项目上能否跑通，
作为后续 archguard plugin 里 skill / subagent / workflow 的设计依据。**不是已落地的功能。**
与 quay 项目会话（`archguard 架构语义映射`）的原型做法对照过。

## 流程

```bash
# 1. 分析（用独立输出目录，避免读到 .archguard/output 下的旧文件）
node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/ag-layer-demo

# 2. 检查 + 展示（退出码 0=通过 / 1=有新增违例 / 2=未评估）
node docs/experiments/layer-map/check-layers.mjs /tmp/ag-layer-demo/archguard/overview/package.json \
  --html /tmp/ag-layer-map.html --json /tmp/ag-layer-report.json
```

- `layers.yml`：glob → 层、`allowed` 方向、`known_violations` 基线。LLM 只起草，人审后才生效。
  ArchGuard 的 `project-semantics.json` 的 `architecturalLayers` 只能表达分组，表达不了方向，所以另建。
- `check-layers.mjs`：确定性，不含 LLM。取边直接用 `extensions.tsAnalysis.moduleGraph.edges`（不解析 `relation.id`）；
  违例边再按**位置**扫描源文件行首的 `import/export ... from`，拆分 type-only 与值依赖。

## 本次在 archguard 上的结果（2026-10-02，数据时间戳见脚本输出）

27 条层间边，5 条违例，全部已用独立的位置判定 grep 核对：

| 违例 | 目录级边 | 值依赖 | type-only |
|---|---|---|---|
| analysis -> cli | 3 | 1 | 3 |
| core -> mermaid | 1 | 0 | 1 |
| core -> cli | 1 | 0 | 1 |
| plugin-runtime -> core | 1 | 0 | 1 |
| plugin-runtime -> parser | 1 | 1 | 0 |

`plugins/shared`（plugin-runtime）与 core、parser 互指：这是 `detect_cycles(package)` 返回 `[]` 却存在目录级环的一个具体实例。

## 对照用例（已跑过）

- 基线建立后 → pass，退出码 0
- 从基线删去一条 → fail，退出码 1，且只新增那一条
- 输入缺 moduleGraph / 文件不存在 / 空图 / glob 与目录全不匹配 → not-evaluated，退出码 2（**不得与 pass 同形**）

## Refactor Slice / Expected Delta（`slice-delta.mjs`，2026-10-09 追加）

问的是另一类问题：**"按这份显式给出的切法动刀，这棵树的 architecture delta 会是什么？"**
——不是"该不该动这刀"。切法由外部输入提供，脚本不发明方案、不排序、不建议。

```bash
node docs/experiments/layer-map/slice-delta.mjs <current.arch.json> \
  --slice <slice.json> [--observed <observed.json>] [--json <out.json>]
# 0 = 已评估且护栏通过 | 1 = 已评估但护栏被触发 | 2 = 未评估
```

- **取边**：同样是 `extensions.tsAnalysis.moduleGraph`，且脚本自己按 Tarjan 重算 size>1 的 SCC
  与 `moduleGraph.cycles` 做集合比对；**不一致即 not-evaluated**（在这张图上不可信的模拟不出结论）。
- **对账靠 `importedNames`，不靠被喂答案**：`proposedCut.moves` 只说"哪个文件的哪些符号从哪个目录搬到哪个目录"，
  脚本自己判断进入 moved-from 目录的哪条边被这次搬迁完整覆盖（覆盖不全 → not-evaluated，不按比例折算）。
- **predicted / declared / observed 物理分区**：`computedDelta` 只由图 + 切法算出；人写的 `declaredPrediction`
  与后验的 `--observed` 只在最后装配对比段时被读。反向测试（换掉 observed 后 `computedDelta` 逐字节不变）
  在 `tests/unit/architecture/slice-delta.test.ts` 里看住这条。
- **negative control 由机制强制**：`restoreEdges` 为空即 not-evaluated。判据是"这次切法踢出去的目录是否
  全部回到环里"（SCC 恰好恢复 before 成员），**不是**"subject 在 size>1 的环里"——后者会被一条无关边满足。
- **首个 dogfood = quay GOAL-033**：fixture 是 fork point 真实子树（treeSha `5213eb61...`）的 package 级 ArchJSON。
  脚本从图上算出 SCC **6 → 4**（`cli` 与 `fan-in` 一起离开，因为 `fan-in` 的唯一入边是 `cli -> fan-in`），
  而 goal 正文手写的预测是 6 → 5 —— 两个读数分开记录，本脚本不改写人写的那个。
- **边界**：不修改 `check-layers.mjs` / `layers.yml`，不产出 `pass`/`fail` 字段名，不做 ownership 语义推断、不做自动 proposer。
  已知覆盖缺口写在输出里：目录级图看不见同目录 import，搬迁后由"同目录 import 变成跨目录 import"产生的新边
  只能由 `consumers` 显式声明（标 `source: declared-consumer`）；`importedNames` 不携带"符号→文件"定位，
  所以边强度增量算不出来，只记 `strengthenedEdges`。

## 踩过的坑（写 skill 时要带上）

- **空输入会返回 pass**：初版对空 moduleGraph 返回通过（什么都没评估到）。已修：没有 internal 目录或没有层间边时返回"未评估"。
- **别名未解析的边看不见**：`@/types` 这类别名在个别位置没被解析成 internal 目录，目录级图里缺这条边。脚本把它列入"覆盖缺口"，没有悄悄忽略。
- **关键词 grep 会把注释当 import**（来自 quay 会话的教训）：必须按位置（行首语句）判定。
- **读旧产物目录**：`.archguard/output/<name>/overview` 可能是几天前的文件；用独立 `--output-dir`，并在输出里打印数据时间戳。
- **层定义必须人审**：按目录名机械归层会把 `plugins/shared` 并进 `plugins`，把正常依赖误报成违例。

## 依赖的 ArchGuard 缺陷（已立 quay 任务）

- `gap-detect-cycles-ignores-output-scope-package`：`detect_cycles` 在 package 粒度不返回目录级环。
- `gap-ts-package-json-relations-metrics-inconsistent`：package 层 JSON 的 relations 被折叠、与 metrics 不一致；修好后取边无需读 `moduleGraph`。
- `gap-ts-package-graph-capability-undeclared`：TS 上 `packageGraph` 恒 false，相关工具无明确不可用声明。
- `gap-ts-package-stats-root-prefix-and-count-semantics`：根目录 `entityCount` 恒为 0，父目录按子树累计。

## 未做 / 未验证

- 运行时层（manager/worker、任务状态机）不在 import 图里，本检查不覆盖。
- 层的 `allowed` 是 LLM 起草的草案，未经人审；基线只代表现状快照，不代表这些方向是对的。
- 单页 HTML 只在字符串层面检查了生成，没有在浏览器里目视验证。
- 没有做成 skill / subagent / workflow；按本项目约定应先走 `feature-to-backlog` 出 proposal。
