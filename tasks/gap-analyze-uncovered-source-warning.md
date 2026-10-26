---
id: gap-analyze-uncovered-source-warning
title: analyze 对根目录未被任何 scope 覆盖的 .ts 源码给出告警
status: done
labels:
  - gap
  - cli
parent: null
children: []
extra:
  schema: execution
---
## Proposal

无 `-s`/config 时 analyze 走自动探测（`src/cli/analyze/normalize-to-diagrams.ts`），只认 `src/lib/app/source` 等 well-known 根（`project-structure-detector.ts`）或语言探测的 `candidate.roots[0]`（`default-scope-planner.ts`）。根下不在任何 scope 里的散源码（实测 claudecodeui 的 `shared/`、`scripts/`）不会出现在架构图与重复检测里，且当前没有任何提示，用户会误以为「已全量分析」。

修复方向：analyze 收尾在 `persistQueryScopes` 后，对比「已注册 scope 的 sources 并集」与「根下 .ts 文件全集（套用默认排除）」，对落在集合外的含 .ts 目录打印一条 warn 列出目录。纯告警、advisory，不改 scope 选择语义。

## AC

- [x] analyze 收尾（默认输出或 verbose）对根下未落入任何已注册 scope sources 的含 .ts 目录打印一条 warn，并列出目录名；`npx vitest run tests/unit/cli/analyze/run-analysis.test.ts` exit 0，新增用例断言 warn 出现/不出现
- [x] 合成夹具：根下 `src/`（被覆盖）与 `shared/`（未覆盖）各含 .ts；analyze 后 warn 提到 `shared/` 而不提 `src/`
- [x] 默认排除（node_modules/dist/.d.ts/test 文件）内的文件不触发 warn；夹具含一个 `dist/` 下 .ts 不被计入
- [x] `npm run type-check` 通过

## DoD

合成夹具（`src/` 被覆盖、`shared/` 未覆盖）跑真实 `analyze` 后，输出可见 `shared/` 被列为未覆盖源码目录——「漏了半边」可机械读出，而非靠人肉数文件。

## Touches

- tasks/gap-analyze-uncovered-source-warning.md
- src/cli/analyze/run-analysis.ts
- tests/unit/cli/analyze/run-analysis.test.ts
