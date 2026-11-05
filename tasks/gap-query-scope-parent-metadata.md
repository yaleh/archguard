---
id: gap-query-scope-parent-metadata
title: query scope 无包含关系元数据：嵌套 scope 重复且消费方只能靠路径猜 parentScopeKey
status: todo
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

- [ ] 夹具：manifest 含 `/proj`(根)、`/proj/src`、`/proj/src/cli` 三个 scope；persist 后 `src` 的 parentScopeKey=根的 key，`src/cli` 的 parentScopeKey=`src` 的 key，根的 parentScopeKey 缺席
- [ ] 直接外层（非最外层）：`/proj/src/cli` 的 parentScopeKey 是 `src` 而不是根（取最小严格超集）
- [ ] 无外层的根 scope 不写 parentScopeKey（字段缺席而非空串）
- [ ] 符号链接别名：sources 用别名路径时经 realpath 仍正确判父子关系
- [ ] `manifest.version` 写为 `"1.1"`；旧 `"1.0"` manifest 能被 `readManifest` 正常加载（无 parentScopeKey）
- [ ] 真实数据：archguard 自身 `.archguard` 副本 persist 后，`465376a8`(src) 的 parentScopeKey 指向 `8f71319d`(根)，各子目录 scope 指向 `465376a8`；消费方无需路径启发式即可得包含链
- [ ] 负对照：互不相交的 scope（如 go/java/python fixtures）之间不产生 parentScopeKey
- [ ] `bash scripts/test.sh --for-task gap-query-scope-parent-metadata` 与 `npm run type-check` 通过

## DoD

不是「加个可选字段」就算完成。要在 archguard 自身 `.archguard` 的真实副本上重建 manifest，展示完整的 parentScopeKey 链（根→src→各子目录），证明消费方可以从根沿链走到底、无需猜；同时验证 1.0 旧 manifest 仍可加载、互不相交 scope 不产生父子关系、符号链接别名不误判。

## Touches

- tasks/gap-query-scope-parent-metadata.md
- src/types/query-scope.ts
- src/cli/query/query-artifacts.ts
- src/cli/query/query-manifest.ts
- src/cli/query/engine-loader.ts
- tests/unit/cli/query/query-artifacts.test.ts
- tests/unit/cli/query/query-manifest.test.ts
- tests/unit/cli/query/engine-loader.test.ts
