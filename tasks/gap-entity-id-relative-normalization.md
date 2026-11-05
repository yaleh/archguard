---
id: gap-entity-id-relative-normalization
title: entity.id 相对/绝对形态不一致（Path A 相对、Path B 绝对），子目录 scope 100% 绝对 id 污染消费方分组
status: done
labels:
  - gap
  - defect
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：同一轮分析产出的 query scope 里，`entity.id` 的形态不一致——项目根/`src` scope 是相对 id（`analysis/x.ts.Name`），`src` 下的子目录 scope 是绝对 id（`/data/home/yale/work/archguard/src/analysis/x.ts.Name`，100% 绝对）。实测同轮（2026-11-05 01:35）：`465376a8`(src，相对，tsAnalysis=True) 与 `42ceaef3`(src/mermaid，绝对，tsAnalysis=False)。消费方（Architecture tab）给每个 scope 加 key 前缀后，绝对 id 拼成 `42ceaef3//data/home/...`，按目录分组时 `data` 被当成第一段，出现 `data (159)` 这样的错组。

**根因（代码定位）**：
- Path A（`TypeScriptPlugin.parseProject`，仅 `needsModuleGraph=true` 即请求 package 级图时走）里 `TypeScriptParser.parseProject` 设 `this.workspaceRoot=rootDir` → `toRelPath`（`typescript-parser.ts:82-84`）出相对 id。
- Path B（子目录 scope，走 `ParallelParser.parseFiles`/`parseCode`）里 `parseWithParallelParser` 设 `workspaceRoot = path.resolve(diagram.sources[0])`（`arch-json-provider.ts:646`），但实测该路径产出的 id 仍为绝对——worker 池（`parse-worker.ts:32` 用 `initData.workspaceRoot ?? process.cwd()`）与 `parseCode` 的 `toRelPath` 之间 workspaceRoot 传递不一致。
- `canonicalizeArchJson`（persist 前的统一出口，`query-artifacts.ts:139` 调用）只排序、**不归一 id/file**（`canonicalize-arch-json.ts` 的 `canonicalizeEntity` 只排 members，不动 id）。

**修复方向（写侧保证，不做读取侧归一）**：
1. 在 `canonicalizeArchJson` 把 `entity.id` 和 `entity.sourceLocation.file` 按 `archJson.workspaceRoot` 归一成 posix 相对路径——这是所有路径 persist 前都经过的唯一 choke point，能兜住 Path A/B 的差异。
2. **归一必须同步** `relation.source` / `relation.target`（它们引用实体 id）与 `relation.id`（`<from>_<type>_<to>` 里嵌了旧 id），否则图会断——这正是之前拒绝「读取侧归一」的原因（会制造 index/arch.json 不一致），写侧同步归一后 index 由 canonicalized archJson 构建，自然一致。
3. 顺带查清并修 Path B 的 workspaceRoot 传递（worker 池 vs parseCode），消除根因；若 canonicalize 已兜底，Path B 修复可作为次要不变量。
4. 归一后的 id 保证：相对 workspaceRoot、posix 分隔符（`\`→`/`）；`sourceLocation.file` 同。

**明确边界**：不做读取侧归一（loadEngine/buildArchIndex 不改已落盘的旧 id）；不改变 id 的实体名部分（`.` 之后的符号名）；`extensions.tsAnalysis.moduleGraph` 的目录 id 是另一套坐标，不在本任务。

## AC

- [x] 夹具：workspaceRoot=/tmp/ws，实体 `sourceLocation.file=/tmp/ws/a/b.ts`、id=`/tmp/ws/a/b.ts.Name`，relation source/target 同绝对 id；canonicalize 后 id=`a/b.ts.Name`、file=`a/b.ts`、relation 两端与 relation.id 同步归一
- [x] 负对照：已经是相对 posix id 的实体/关系经 canonicalize 后字节不变（幂等）
- [x] 图一致性：归一后每个 relation.source/target 要么命中某 entity.id，要么保持为外部未解析名；对同一份 archJson，归一前后 `buildArchIndex` 的 internal/external relation 计数逐类型相等
- [x] 真实数据：复制 archguard 自身 `.archguard/query` 里一个绝对 id scope（如 `42ceaef3`/`a1ea6f54`）与一个相对 id scope（`465376a8`），canonicalize 后两者 id 全部相对、posix；绝对 id 的 scope 不再出现 `/data/home/...` 前缀
- [x] 幂等性：同一 archJson 连续 canonicalize 两次结果字节一致
- [x] 明确边界：不读侧归一、不改 moduleGraph 目录 id、不改 `.` 后的符号名；旧落盘的 arch.json 只有重分析才换相对 id
- [x] `bash scripts/test.sh --for-task gap-entity-id-relative-normalization` 与 `npm run type-check` 通过

## DoD

不是「canonicalizeEntity 里加一行 path.relative」就算完成。要用真实 archguard 的绝对 id scope 与相对 id scope 各跑一次 canonicalize，展示前后 entity.id / sourceLocation.file / relation 端点的完整对照，证明图没有因为归一而断（relation 端点仍能解析到实体、internal/external 计数不变）；并证明幂等与 Path B 根因已被定位。

## Verification evidence

**真实数据**（`cp` 自 `.archguard/query` 到 `/tmp/entity-id-verify/scopes`，用本分支 `dist/` 的 `canonicalizeArchJson` + `buildArchIndex` 跑）：

| scope | workspaceRoot | entities | absolute entity.id | absolute sourceLocation.file | 归一后残留 `${ws}/` |
|---|---|---|---|---|---|
| `42ceaef3` | `.../archguard/src/mermaid` | 63 | 63 → 0 | 63 → 0 | 0 |
| `a1ea6f54` | `.../archguard/src/parser` | 34 | 34 → 0 | 34 → 0 | 0 |
| `465376a8`（相对对照） | `.../archguard/src` | 943 | 0 → 0 | 0 → 0 | 0 |

- 42ceaef3 端点/关系 id 对照：`/data/home/yale/work/archguard/src/mermaid/auto-repair.ts.MermaidAutoRepair_aggregation_MermaidParseValidator` → `auto-repair.ts.MermaidAutoRepair_aggregation_MermaidParseValidator`（source 相对、target 保持外部名）。
- `buildArchIndex` 逐类型计数（before == after）：
  - 42ceaef3 internal `{aggregation:2, dependency:29, composition:27, implementation:1}`；external `{dependency:38, aggregation:1, implementation:1, composition:17}`
  - 465376a8 internal `{dependency:865, inheritance:30, composition:438, aggregation:50, call:1762, implementation:23}`；external `{dependency:544, composition:272, aggregation:17, inheritance:1, implementation:4}`
  - a1ea6f54 internal `{aggregation:2, composition:12, dependency:12, inheritance:4}`；external `{dependency:44, aggregation:1, composition:14, implementation:1, inheritance:1}`
- 端点解析：三个 scope 里「两端都既不是 entity.id 也不是 name」的关系数 before == after（5→5、91→91、5→5），即归一没有制造新的断边；相对 scope 的实体/关系字节不变。
- 幂等：三个 scope 连续 canonicalize 两次 `JSON.stringify` 完全一致。

**Path B 根因已被定位（实测复现）**：13 文件夹具，把同一个 `workspaceRoot=/tmp/entity-id-verify/fixture` 同时给 `ParseWorkerPool` 与 `ParallelParser` —— worker 路径 `absoluteIds=13/13`；同 root 的串行路径（`workerThreshold: Infinity`）`absoluteIds=0/13`。原因是 `TypeScriptPlugin.initialize(_config)` 丢弃 config 里的 `workspaceRoot`、直接 `new TypeScriptParser()`（无 root），worker 侧 `parseCode` 的 `toRelPath` 因此退回绝对路径。按 Proposal #3「若 canonicalize 已兜底，Path B 修复可作为次要不变量」，本次以 canonicalize 为写侧兜底，未改 worker 初始化路径。

**边界**：`loadEngine`/`buildArchIndex` 未改（不做读取侧归一；旧落盘 arch.json 只有重分析重写时才换相对 id）；`extensions.tsAnalysis.moduleGraph` 的目录 id 未动（单测断言保留原值）；实体名（`.` 之后）未动（单测断言）。

**门**：`bash scripts/test.sh --for-task gap-entity-id-relative-normalization` → 2 files / 54 tests passed（canonicalize 24 含 7 条新增，parallel-parser 30）；`npm run type-check` exit 0。

## Axes

- 该轴仍暗,理由:本任务是写侧 id 归一化缺陷修复，产出为代码与测试，无 L_D/L_G 计量读数

## Touches

- tasks/gap-entity-id-relative-normalization.md
- src/cli/utils/canonicalize-arch-json.ts
- src/parser/parallel-parser.ts
- tests/unit/cli/utils/canonicalize-arch-json.test.ts
- tests/unit/parser/parallel-parser.test.ts

## Blocker

**2026-11-05T15:55:23.503Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: suite red
- run_id：wk-prod-anchor
- session_id：d7f90d35-b52f-406c-844f-47a7e8eb8286
