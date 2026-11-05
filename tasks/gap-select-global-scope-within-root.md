---
id: gap-select-global-scope-within-root
title: selectGlobalScopeKey 无根内约束选中项目外 scope，且外来 scope 无标记（archguard 默认命中 quay 代码）
status: todo
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

**现象（实测）**：archguard 项目自己的 `.archguard/query/manifest.json`（28 个 scope）里，12 个 scope 的 `sources` 在项目根之外（quay、claudecodeui、`/tmp` fixture），而 `manifest.globalScopeKey = b4f87b21` 指向 **quay 的根 scope**——对 archguard 项目省略 scope 调 `archguard_summary` 等，默认命中的是别人家的代码。

**根因（代码定位）**：
1. `persistQueryScopes` 不检查 scope 的 sources 是否在项目根内，也不做任何标记——外来 scope（在 cwd=X 时分析了别的目录、或测试/实验把 `/tmp` fixture 写进同一输出目录）与项目内 scope 一样落进 manifest。
2. `selectGlobalScopeKey`（`src/cli/query/query-artifacts.ts:83-99`）只按 `parsed + entityCount 最大` 选，无根内约束，所以 quay 的 `b4f87b21`（4577 实体）抢走了 archguard 的 globalScopeKey。

**修复方向（不拒绝多源分析、只标记 + 选择时排除）**：
1. `QueryScopeEntry` 增加可选 `outsideProjectRoot?: boolean`：`true` 表示 sources（realpath 后）不在项目根内。persist 时对每个 scope 计算并写入；项目根 = `workDir` 的父目录（`.archguard` 的父级）。
2. `selectGlobalScopeKey` 先过滤 `sources ⊆ projectRoot` 的 scope 再按原规则选（parsed + entityCount 最大）；若根内无 parsed scope 才退到全体（并保留现行为，避免把合法单语言仓库的全局选择弄丢）。
3. 路径比较用 `realpathOrSelf`（学 `normalizeManifestEntry` 的做法），符号链接别名不误判。
4. 明确边界：**不拒绝**项目外 sources 的 scope（多源 `-s /other/path` 是合法能力）；只标记 + 全局选择时排除。

## AC

- [ ] 夹具：manifest 里一个项目内 scope + 一个项目外 scope（sources 指向项目根外，含符号链接别名）；persist 后项目外 scope 带 `outsideProjectRoot: true`，项目内不带
- [ ] 符号链接别名不误判：sources 用 `/home/...` 别名指向项目根内目录时，realpath 后仍判为项目内（`outsideProjectRoot` 缺席）
- [ ] `selectGlobalScopeKey` 在存在项目内 parsed scope 时，永远不选项目外 scope（即使项目外 entityCount 更大）
- [ ] 退化路径：项目内无 parsed scope 时仍按原规则从全体选，行为不回归
- [ ] 真实数据：在 archguard 自身 `.archguard` 副本上，修复后 `globalScopeKey` 不再是 `b4f87b21`（quay），而是项目内最宽的 parsed scope；`b4f87b21` 等外来 scope 标 `outsideProjectRoot: true`
- [ ] 负对照：`archguard analyze -s /other/project`（合法多源）仍正常登记 scope，只是标 `outsideProjectRoot`，不被拒绝
- [ ] 向后兼容：旧 manifest 无 `outsideProjectRoot` 字段照常加载；`QueryScopeEntry` 字段可选
- [ ] `bash scripts/test.sh --for-task gap-select-global-scope-within-root` 与 `npm run type-check` 通过

## DoD

不是「加个 if 过滤」就算完成。要在 archguard 自身 `.archguard` 的真实副本上跑一次 persist/重建，展示修复前 `globalScopeKey=b4f87b21`、修复后落到项目内 scope，并列出哪些外来 scope 被标 `outsideProjectRoot: true`（含符号链接别名的对照）；同时验证合法多源分析仍能登记、旧 manifest 仍能加载。

## Touches

- tasks/gap-select-global-scope-within-root.md
- src/cli/query/query-artifacts.ts
- src/types/query-scope.ts
- tests/unit/cli/query/query-artifacts.test.ts
