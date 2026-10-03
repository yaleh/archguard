---
id: gap-doc-multi-source-scope-cross-directory-edges
title: 文档：多个 sources 各成独立 scope、scope 间 import 边不可见；需要跨目录边时用共同上层根
status: todo
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

- [ ] 用一个最小夹具（两个目录 `p/` 与 `q/`，`q/x.ts` import `../p/y.ts`）分别以"单一上层根"与"两个 sources"各运行一次 `node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/<dir>`，记录两次的 scope 数量和 `moduleGraph.edges` 中是否存在 `q -> p` 边，结果写在本任务的 Evidence 小节里（单根应存在该边；两 sources 的结果以实测为准，若与"缺失"不符则按实测修改文档结论）
- [ ] `docs/user-guide/architecture-checking-scenarios.md` 在第 7 节内新增小节，且 `grep -n "common parent root\|single source" docs/user-guide/architecture-checking-scenarios.md` 能命中新增的建议句
- [ ] 文档中提到的任何命令都已实际执行过并核对输出（`archguard query --list-scopes` 等），不存在凭记忆写的命令名
- [ ] `npm run format:check` 对改动文件通过（或该文件不在 prettier 范围内）

## DoD

不是"文档写了"就算完成：必须有夹具的真实运行结果支撑文档中"跨 scope 边不可见/单一根可见"的每一句结论，Evidence 里贴出两次运行的 scope 列表与相关 edges，且文档结论以实测为准。

## Touches

- docs/user-guide/architecture-checking-scenarios.md
- tasks/gap-doc-multi-source-scope-cross-directory-edges.md
