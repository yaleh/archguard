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
