---
id: gap-default-exclude-build-artifacts
title: 默认排除只挡 node_modules/test：dist/vendor/archive 被当作源码分析，实体数与所有下游指标虚高（quay 实测）
status: done
labels:
  - gap
  - defect
  - cli
  - parser
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：对 `/data/home/yale/work/quay` 的默认分析把构建产物与历史归档当成源码：
- `package.mmd:41` 出现 `packages_quay_dist["packages/quay/dist"]`，随之产生 `node_fs` / `node_child_process` 等外部边；
- `package.mmd:73-75` 出现 `archive_group` 下的 `archive/2026-09-07-zero-call-scripts/plugin/scripts`（89 实体）与 `archive/2026-09-07-second-copy-retirement/...`；
- `get_package_metrics` 对该 archive 目录报 `fanOut=83`，`detect_god_packages` 把它报成 god package；
- 整个 scope 的 5847 实体 / 7616 关系因此系统性虚高，所有下游计数（summary、duplicates、cycles、fan-in/out）都受污染。

**根因（代码定位）**：默认排除集合里没有任何构建产物/归档目录：
- `src/cli/utils/file-discovery-service.ts:48`：`['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/node_modules/**']`
- `src/cli/config-loader.ts:151`：`['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']`
- `src/plugins/typescript/index.ts:196-206`（`builtinExcludes`）：test/spec + node_modules

三处各自硬编码、内容还不一致，也没有 `**/dist/**`、`**/vendor/**`、`**/archive/**`。

**修复方向**：
1. 抽一份共享的默认排除集合（单一来源），file discovery / config 默认值 / TS plugin `builtinExcludes` 都引用它，内容至少包含 `**/dist/**`、`**/vendor/**`、`**/archive/**`（node_modules 与 test/spec 保持现状）。
2. 保留既有逃生口：显式 `-e`/config `exclude` 仍整体替换默认集合（现有语义）；显式 `sources` 直接指向默认被排除的目录（例如 `-s ./dist`）时，该目录仍要被分析，不能因为默认规则把用户显式选择吞掉。
3. 什么都不改的默认行为要可解释：verbose 输出沿用既有“Exclude rules”可见性，能看出本次用的是默认集合。

<!-- dedup-ref -->
相关但不同机制：已完成的 `bug-default-exclude-gitignore-archguardignore` 引入的是 `.gitignore` 感知与 `.archguardignore`（opt-in 的忽略文件机制）；本任务加的是**无需任何配置就生效的内置默认排除**，并统一三处硬编码，两者互补、不重复。

## AC

- [x] 合成夹具（`src/keep.ts` + `dist/gen.ts` + `vendor/lib.ts` + `archive/old/x.ts` + `node_modules/pkg/y.ts`，每个文件含可提取实体）：默认 analyze 后只出现 `keep.ts` 的实体，其余四类都不出现在 ArchJSON/summary 中
- [x] 逃生口：同一夹具上显式 `-s <fixture>/dist` 或 `--exclude` 只写自定义规则时，`dist` 内容仍被分析（默认集合不吞掉用户显式选择）
- [x] 三个入口同源：file discovery、config 默认 exclude、TS plugin `builtinExcludes` 引用同一份默认集合；单测机械断言三处展开后的集合一致（不是各写各的）
- [x] 显式 `-e`/config `exclude` 仍整体替换默认集合；负对照：只传一个自定义 exclude 时 `dist` 不再被自动排除
- [x] 真实数据验证：复制 `/data/home/yale/work/quay`（或只复制其源码 + 复制出的 `.archguard`，不改原仓库）后用默认参数复跑 analyze，`package.mmd` 不再出现 `packages_quay_dist` 与 `archive_group` 节点，并记录 entityCount 前后差值
- [x] `bash scripts/test.sh --for-task gap-default-exclude-build-artifacts` 与 `npm run type-check` 通过

## DoD

不是“加了三条 glob 字符串、单测断言数组长度”就算完成。要在合成夹具和 quay 副本上各跑一次完整 analyze：前者证明五类目录的取舍与逃生口都按预期工作，后者证明默认产物里 `packages_quay_dist` / `archive_group` / god-package 误报确实消失，并给出修复前后的实体数、包列表和 `detect_god_packages` 输出对照。

## Verification Evidence

合成夹具（无 `archguard.config.json` 的 cwd）：

| 场景 | 结果 |
|---|---|
| 默认 analyze（`-s <fixture>`） | `architecture.json` 仅有 `KeepMe`；Dist/Vendor/Archive/NodeModules 实体均不存在；verbose 显示 `default exclude: 5 rule(s)` |
| `-s <fixture>/dist` | `DistEntity` 被分析；报告 `default exclude: 4 rule(s)`（`**/dist/**` 被显式源豁免） |
| `-e '**/nothing-matches/**'` | 5 个实体全部出现（显式 exclude 整体替换默认集合） |

quay 副本（`/tmp/quay-baseline` vs `/tmp/quay-after`，同一份源码，主检出旧构建 vs 本分支构建）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| class/all-classes entityCount | 5830 | 5727（−103） |
| class/all-classes relations | 7577 | 7461（−116） |
| overview/package 包节点 | 61 | 52 |
| `method/archive` 图 | 94 实体 | 不再生成 |
| `package.mmd` 节点 | 含 `packages_quay_dist`、`archive_group` | 两者均无（`archive/`、`quay/dist` 全文无匹配） |
| `detect_god_packages` 数量 | 15 | 13 |
| 其中误报 | `archive/2026-09-07-zero-call-scripts/plugin/scripts`（fanOut=83, entityCount=89）、`packages/quay/dist`（fanOut=20, entityCount=9） | 两者均消失 |

## Touches

- tasks/gap-default-exclude-build-artifacts.md
- src/cli/utils/file-discovery-service.ts
- src/cli/utils/default-excludes.ts
- src/cli/utils/ignore-file-loader.ts
- src/cli/utils/project-structure-detector.ts
- src/cli/config-loader.ts
- src/plugins/typescript/index.ts
- tests/unit/cli/utils/file-discovery-service.test.ts
- tests/unit/cli/utils/file-discovery-ignore.test.ts
- tests/unit/cli/config-loader.test.ts
- tests/plugins/typescript/index.test.ts
- tests/integration/custom-config-path.test.ts
