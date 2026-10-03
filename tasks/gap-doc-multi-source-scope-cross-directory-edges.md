---
id: gap-doc-multi-source-scope-cross-directory-edges
title: 文档：多个 sources 各成独立 scope、scope 间 import 边不可见；需要跨目录边时用共同上层根
status: done
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
---
## Proposal

quay 项目的架构审查会话（两次独立运行）报告：对 `archguard_analyze` 传多个 sources（`["packages","plugin/scripts"]`）时，每个 source 各生成一个独立 query scope，scope 之间的 import 边在 ArchGuard 输出里完全不可见（例如 `plugin/scripts/*.ts` 指向 `packages/quay/src/**` 的真实 import），调用方只能用 grep 补查。对方后来也承认"每个 source 一个 scope"可能是设计如此，真正的问题是**文档没有说明这一点**，用户因此误以为 ArchGuard 会给出跨 sources 的依赖图。

已验证的事实（2026-10-02，archguard 自身）：以仓库根为**唯一** source 时，目录级边完整，`src/cli -> src/core`、`src/analysis -> src/cli` 等跨目录边都在 `extensions.tsAnalysis.moduleGraph.edges` 里。**未验证**：多 sources 拆成独立 scope 后跨 scope 边确实缺失（对方在 quay 上观察到，本仓库没有复现）——本任务的 DoD 要求用一个最小夹具真实复现，再落笔写进文档，不能只转述对方的描述。

文档应写明（落点：`docs/user-guide/architecture-checking-scenarios.md`，在 "7. Compare Subsystems with Query Scopes" 一节内新增一个小节，英文，沿用该文件现有风格）：

- 每个 source / 每个 diagram 配置对应一个 scope，`archguard query --list-scopes` 能看到；
- 各 scope 内部的目录边完整，但**scope 之间的 import 不会出现在任何一个 scope 的依赖图里**；
- 需要跨目录/跨子系统的依赖与分层检查时，用一个**共同的上层根**作为单一 source（例如仓库根），再用目录或 glob 区分子系统，而不是拆成多个 sources；
- 跨 scope 的依赖目前只能自行补查，并且补查要按**位置**判定 import 语句（注释里提到路径不算依赖）；
- 同一目录通过符号链接别名（如 `/home/x` 与 `/data/home/x`）分析两次，会在 manifest 里产生重复 scope，建议统一用同一种路径写法并用 `archguard cache clear` / scope 清理命令移除旧条目（先确认该命令的真实名称与行为再写，不要凭记忆）。

不在本任务范围：让 ArchGuard 真正支持跨 scope 边（另立实验，见后续建议）；manifest 路径规范化的代码修复。

## AC

- [x] 用一个最小夹具（两个目录 `p/` 与 `q/`，`q/x.ts` import `../p/y.ts`）分别以"单一上层根"与"两个 sources"各运行一次 `node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/<dir>`，记录两次的 scope 数量和 `moduleGraph.edges` 中是否存在 `q -> p` 边，结果写在本任务的 Evidence 小节里（单根应存在该边；两 sources 的结果以实测为准，若与"缺失"不符则按实测修改文档结论）
- [x] `docs/user-guide/architecture-checking-scenarios.md` 在第 7 节内新增小节，且 `grep -n "common parent root\|single source" docs/user-guide/architecture-checking-scenarios.md` 能命中新增的建议句
- [x] 文档中提到的任何命令都已实际执行过并核对输出（`archguard query --list-scopes` 等），不存在凭记忆写的命令名
- [x] `npm run format:check` 对改动文件通过（或该文件不在 prettier 范围内）

## DoD

不是"文档写了"就算完成：必须有夹具的真实运行结果支撑文档中"跨 scope 边不可见/单一根可见"的每一句结论，Evidence 里贴出两次运行的 scope 列表与相关 edges，且文档结论以实测为准。

## Evidence

夹具（`/tmp/ag-ms/fixture`）：`p/core/z.ts`、`p/y.ts`（`p/y.ts` import `./core/z`）；`q/util/w.ts`、`q/x.ts`（`q/x.ts` import `../p/y` 与 `./util/w`）。每个文件都含 class，使解析器产出实体、scope 被登记（仅 `const` 导出的最小夹具解析出 0 实体，`QueryScopeCollector.register` 因 `hasQueryableContent` 为假而跳过，manifest 不会写出——这也是实测发现的）。

构建产物来自本任务 worktree 的 `npm run build`。

### Run A — 单一上层根（JSON）

```
node dist/cli/index.js analyze -s /tmp/ag-ms/fixture --lang typescript -f json --diagrams package \
  --work-dir /tmp/ag-ms/work-single --output-dir /tmp/ag-ms/out-single
```

- 产出 1 个 diagram/scope；manifest `globalScopeKey=f8e52758`，`label="fixture (typescript)"`，`entityCount=5`，`sources=["/tmp/ag-ms/fixture"]`
- `extensions.tsAnalysis.moduleGraph.nodes = ["p", "p/core", "q", "q/util"]`
- `moduleGraph.edges = ["p -> p/core", "q -> p", "q -> q/util"]`
- **`q -> p` 边存在：是**

### Run B — 两个 sources（JSON）

```
node dist/cli/index.js analyze -s /tmp/ag-ms/fixture/p /tmp/ag-ms/fixture/q --lang typescript -f json --diagrams package \
  --work-dir /tmp/ag-ms/work-multi --output-dir /tmp/ag-ms/out-multi
```

- 产出 2 个 diagram/scope；manifest `globalScopeKey=3971bc6a`，两个 scope：
  - `3971bc6a` `label="p (typescript)"` `entityCount=3` `sources=["/tmp/ag-ms/fixture/p"]`
  - `ff800881` `label="q (typescript)"` `entityCount=2` `sources=["/tmp/ag-ms/fixture/q"]`
- `p/overview/package.json`：`moduleGraph.nodes = ["", "core"]`，`moduleGraph.edges = ["'' -> core"]`
- `q/overview/package.json`：`moduleGraph.nodes = ["", "util"]`，`moduleGraph.edges = ["'' -> util"]`
- **`q -> p` 边是否存在：两个 scope 中都不存在**

结论：单一上层根能看到 `q -> p`；拆成两个 sources 后，各 scope 内部目录边（`root -> core` / `root -> util`）仍在，但真实的 `q -> p` import 从两个 scope 的 moduleGraph 里都消失了。与 Proposal 假设一致，文档结论按此写。

### scope 列表（`archguard query --list-scopes`，实测）

单一根（`--arch-dir /tmp/ag-ms/work-single`）：

```
  f8e52758 (parsed)
    Label:    fixture (typescript)
    Sources:  /tmp/ag-ms/fixture
    Entities: 5, Relations: 4
Total: 1 scope(s)
```

两个 sources（`--arch-dir /tmp/ag-ms/work-multi`）：

```
  3971bc6a (parsed)   Label: p (typescript)   Sources: /tmp/ag-ms/fixture/p   Entities: 3, Relations: 2
  ff800881 (parsed)   Label: q (typescript)   Sources: /tmp/ag-ms/fixture/q   Entities: 2, Relations: 2
Total: 2 scope(s)
```

### 逐 scope 查询（`archguard query --scope ff800881 --summary`，实测）

q scope 的 summary 只列出 `W`、`X` 两个实体（`p` 的 `Y`/`Z` 不在其中），即跨 scope 实体/边在该 scope 内不可见。

### 路径规范化与 `cache prune-scopes`（实测，修正 Proposal 的符号链接假设）

Proposal 断言"符录链接别名会产生重复 scope"。实测**不成立**：`hashSources`（`src/cli/processors/arch-json-utils.ts`）在算 scope key 前先 `realpath` 归一化（注释原文 "Paths are realpath-resolved first so symlinked routes share one key"）。对同一目录用 5 种写法各分析一次（真实路径、`ln -s` 别名、别名带尾斜杠、`/.`、`..`）写进同一 work-dir，manifest 始终只有 **1 个** scope。故文档按实测写成"realpath 归一化，别名/尾斜杠/`..` 归为同一 scope"，并给出真实存在的清理命令。

清理命令的真实名称是 `archguard cache prune-scopes`（`src/cli/commands/cache.ts`，选项 `--key` / `--older-than-days` / `--dry-run` / `--work-dir`），不是凭记忆的 `cache clear`。实测：

```
$ node dist/cli/index.js cache prune-scopes --work-dir /tmp/ag-ms/work-multi --key ff800881 --dry-run
Would remove ff800881 (q (typescript), generatedAt ...)
✓ Would remove 1 scope(s); 1 remaining
$ node dist/cli/index.js cache prune-scopes --work-dir /tmp/ag-ms/work-multi --key ff800881
Removed ff800881 (q (typescript), generatedAt ...)
✓ Removed 1 scope(s); 1 remaining
```

### 文档落点

`docs/user-guide/architecture-checking-scenarios.md` 第 7 节内新增 `### Scopes Do Not Share Dependency Edges`。`grep -n "common parent root\|single source"` 命中第 214、217 行。

### `npm run format:check`

`format:check` 只覆盖 `src/**/*.ts`、`tests/**/*.ts`；本任务改动文件是 `.md`，不在其范围内。全量 `npm run format:check` 报出的 8 个 `src/`、`tests/` 文件在 develop 上即已存在，`git diff --name-only` 显示本任务只改了该 `.md`，与之无关。

## Touches

- docs/user-guide/architecture-checking-scenarios.md
- tasks/gap-doc-multi-source-scope-cross-directory-edges.md
