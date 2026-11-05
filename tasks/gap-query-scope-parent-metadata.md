---
id: gap-query-scope-parent-metadata
title: query scope 无包含关系元数据：嵌套 scope 重复且消费方只能靠路径猜 parentScopeKey
status: ready
labels:
  - gap
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：嵌套 scope 互相重复且无包含关系元数据。archguard 自身 `.archguard` 里 `8f71319d`(964 实体，源=项目根) ⊃ `465376a8`(943，源=src) ⊃ `b5f3ff41`/`ae4141d5`/`8a020036`/`42ceaef3`/`a1ea6f54`/`6a227d25`/`58a188bc`/`c275da87`/`8f390800`（各是 src 下子目录）。同一个 `(文件, 实体名)` 在多个 scope 各有一份，消费方只能靠 `sources` 路径包含关系去猜，去重/选外层全是启发式。

**根因（代码定位）**：`QueryScopeEntry`（`src/types/query-scope.ts`）有 `kind: 'parsed'|'derived'` 和 `role`，但**没有父级关系字段**；`persistQueryScopes` 也不计算包含关系。`manifest.version` 恒为 `"1.0"`（`query-artifacts.ts:353`、`query-manifest.ts:22`），`readManifest`（`engine-loader.ts:178`）不校验 version。

**修复方向（与消费方已定稿的字段契约）**：
1. `QueryScopeEntry` 增加可选 `parentScopeKey?: string`——指向 **直接外层**（sources 路径前缀关系下的最小严格超集、且该外层在 manifest 内）；没有外层的根 scope 该字段缺席。消费方需要最外层时沿 parentScopeKey 链 walk 即可。
2. `persistQueryScopes` 在写 manifest 前，按 sources（realpath 后）的路径前缀关系计算每个 scope 的 `parentScopeKey`。
3. `manifest.version` 从 `"1.0"` 升到 `"1.1"`：`1.0` = 旧形态（parentScopeKey 永不出现），`>=1.1` = 新形态（字段可出现、也可合法缺席）。`readManifest` 容忍 1.1 并保持向后兼容 1.0。
4. 明确边界：本任务只加 parentScopeKey 与 version；`outsideProjectRoot` 字段与 globalScopeKey 限根内由 `gap-select-global-scope-within-root` 负责，不重复实现。

## AC

- [x] 夹具：manifest 含 `/proj`(根)、`/proj/src`、`/proj/src/cli` 三个 scope；persist 后 `src` 的 parentScopeKey=根的 key，`src/cli` 的 parentScopeKey=`src` 的 key，根的 parentScopeKey 缺席
- [x] 直接外层（非最外层）：`/proj/src/cli` 的 parentScopeKey 是 `src` 而不是根（取最小严格超集）
- [x] 无外层的根 scope 不写 parentScopeKey（字段缺席而非空串）
- [x] 符号链接别名：sources 用别名路径时经 realpath 仍正确判父子关系
- [x] `manifest.version` 写为 `"1.1"`；旧 `"1.0"` manifest 能被 `readManifest` 正常加载（无 parentScopeKey）
- [x] 真实数据：archguard 自身 `.archguard` 副本 persist 后，`465376a8`(src) 的 parentScopeKey 指向 `8f71319d`(根)，各子目录 scope 指向 `465376a8`；消费方无需路径启发式即可得包含链
- [x] 负对照：互不相交的 scope（如 go/java/python fixtures）之间不产生 parentScopeKey
- [x] `bash scripts/test.sh --for-task gap-query-scope-parent-metadata` 与 `npm run type-check` 通过

## DoD

不是「加个可选字段」就算完成。要在 archguard 自身 `.archguard` 的真实副本上重建 manifest，展示完整的 parentScopeKey 链（根→src→各子目录），证明消费方可以从根沿链走到底、无需猜；同时验证 1.0 旧 manifest 仍可加载、互不相交 scope 不产生父子关系、符号链接别名不误判。

## 验证记录

- 单元测试：`bash scripts/test.sh --for-task gap-query-scope-parent-metadata` 通过（3 个测试文件 / 75 tests）；`npm run type-check` 通过（merge develop 后重跑）。
- 新增用例（`tests/unit/cli/query/query-artifacts.test.ts` 的 `persistQueryScopes parentScopeKey containment`）：
  - 根/`src`/`src/cli` 三 scope：`src`→根、`cli`→`src`（直接外层而非根）、根字段缺席（`not.toHaveProperty`）。
  - 符号链接别名（`src-alias` → `src`）：realpath 后仍判 `src`→根。
  - 负对照：两个互不相交 scope 均无 parentScopeKey；跨语言包含（typescript 根 vs go 子目录）不建立父子关系。
  - 合并 pass 重算：manifest 里 `cli` 的旧 parentScopeKey 指向已消失的 key 时，persist 重算为 `src`（不留悬空链）。
  - 段边界：`/proj/src2` 不被判为在 `/proj/src` 内。
- 兼容性用例：`tests/unit/cli/query/engine-loader.test.ts` 用 1.0 manifest 调 `readManifest` 正常加载且所有 scope 均无 parentScopeKey；1.1 manifest 的 parentScopeKey 经 `loadEngine` 透传到 `availableScopes`。
- 真实数据（archguard 自身 `.archguard` 副本，28 个 scope，persist 空 scope 集做纯合并 pass）：
  - 修复前：`version=1.0`，28 个 scope 中带 parentScopeKey 的 0 个。
  - 修复后：`version=1.1`，17/28 个 scope 带 parentScopeKey，悬空链接 0 个。
  - 链：`465376a8`(src) → `8f71319d`(archguard 根)；`ae4141d5`(cli) / `b5f3ff41`(analysis) / `8a020036`(core) / `42ceaef3`(mermaid) / `a1ea6f54`(parser) / `6a227d25`(plantuml) / `58a188bc`(plugins) / `c275da87`(types) / `8f390800`(utils) 全部 → `465376a8`。
  - 消费方 walk 实测：`ae4141d5(cli) -> 465376a8(src) -> 8f71319d(archguard)`，缺字段处即链顶，无路径启发式。
  - 其他真实链同样成立：`quay` 的 `packages`/`orchestration`/`scripts`/`plugin` → `b4f87b21`；`claudecodeui` 的 `shared`/`modules` → `93e0a992`；baseline 的 `packages` → `b79ff7aa`。
  - 缺席对照：根 scope `8f71319d`、同源不同语言的 `056a3f39`(cpp) / `289f1f93`(kotlin) 均无 parentScopeKey（包含关系只在同一语言内成立）。

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务只加 query manifest 的 scope 包含关系元数据与版本号，不改架构图/依赖图结构，L_D/L_G 无可测增量

## Touches

- tasks/gap-query-scope-parent-metadata.md
- src/types/query-scope.ts
- src/cli/query/query-artifacts.ts
- src/cli/query/query-manifest.ts
- src/cli/query/engine-loader.ts
- tests/unit/cli/query/query-artifacts.test.ts
- tests/unit/cli/query/query-manifest.test.ts
- tests/unit/cli/query/engine-loader.test.ts
