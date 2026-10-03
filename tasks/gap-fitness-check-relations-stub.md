---
id: gap-fitness-check-relations-stub
title: archguard check 的 no-dependency 规则因 check.ts 硬编码空 relations 永不失败（死桩）
status: ready
labels:
  - gap
  - defect
  - cli
  - fitness
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`archguard check` 已有一等的 fitness 规则引擎（`src/analysis/fitness/`），配置段 `fitness.rules` 支持 `type: 'no-dependency'`（from/to glob，见 `src/types/fitness-rules.ts:19`），但 `src/cli/commands/check.ts:59` 硬编码 `const relations: Relation[] = []` —— 注释写着 "try to load from ArchJSON; fall back to empty array"，实际从未加载。于是 `evaluateAllRules(..., relations)`（`src/analysis/fitness/rule-evaluator.ts:64`）把空数组交给 `checkDependencyConstraint`（`src/analysis/fitness/dependency-checker.ts:6`），该函数遍历 relations，永远不命中，规则恒为 pass。结果：no-dependency 是死桩，配置了也不生效，`check` 退出码永远为 0。

这是机制缺陷不是症状：任何 from→to 禁止方向都检测不到。修复方向：从 analyze 产物加载真实关系边（ArchJSON 的 relations，或 TS moduleGraph 的目录级边——取哪个口径由本任务确定，需与 A4 层检查提案对齐）；加载不到时明确报"未评估"，不得与"通过"同形（沿用三态原则）。不在本任务范围：allowlist/分层语义、棘轮基线、type-only 拆分、展示（属 A4 层检查提案）。

### 实施记录（口径与验证）

- **取边口径**：analyze 持久化的 query 产物 `<workDir>/query/<globalScopeKey>/arch.json` 的 `relations`（实体级 ArchJSON 边）。选它是因为 `query`/MCP 读同一份产物，AC 里"先用 query 确认该边存在"可直接对上；A4 提案的目录级 moduleGraph 依赖阶段 0/1（`gap-ts-module-graph-*`）两个未完成任务，暂不采用。
- **顺带修掉的第二个"恒为 0"来源**：`check` 从 `--output-dir` 默认值 `.archguard` 读快照，而 `analyze` 把快照写到 `<outputDir>/snapshots`（默认 `./.archguard/output/snapshots`），因此裸跑 `check` 从来找不到快照、在求值前就返回 0。现改为快照读 `config.outputDir`（`--output-dir` 可覆盖）、关系读 `config.workDir`。
- **三态**：`RuleResult.evaluated?: boolean`（省略即已求值）。无产物/无该粒度边 → `evaluated: false` + 打印 `NOT-EVALUATED`，退出码 2；有真实违例退出码 1；否则 0。

## AC

- [x] `check.ts` 从 analyze 产物加载真实 relations（不再是 `[]`），且无产物/无该粒度边时打印明确的"未评估"提示而非静默 pass
- [x] `tests/unit/cli/commands/check.test.ts` 新增成对用例：存在 from→to 禁止边时 `no-dependency` 判 fail；不存在该边时 pass；运行 `npx vitest run tests/unit/cli/commands/check.test.ts` 退出码 0
- [x] 真实对照：在 archguard 自身配置一条当前树真实存在的禁止方向（先用 `query` 确认该边存在），`node dist/cli/index.js check` 退出码 1 且打印该条边；删除该规则后退出码 0
- [x] `npm run type-check` 与全量测试通过

### 验收证据

AC3 在 archguard 自身工作树（`/tmp/wt-gap-fitness-check-relations-stub`，源码即 archguard 本体）用修复后的构建实跑：

```
# 前置：query 确认边存在
$ node dist/cli/index.js query --deps-of createCheckCommand --format json
  ... src/analysis/fitness/rule-evaluator.ts.evaluateAllRules ...

# 修后（规则写进 archguard.config.json，裸跑）
$ node dist/cli/index.js check
FAIL  CLI must not depend on fitness internals — Forbidden dependency:
      src/cli/commands/check.ts.createCheckCommand → src/analysis/fitness/rule-evaluator.ts.evaluateAllRules
>>> exit code = 1

# 修前基线：develop 的 dist（含 `const relations = []`）跑同一棵树、同一产物、同一配置
$ node <main-checkout>/dist/cli/index.js check --output-dir .archguard/output --config <同上>
PASS  CLI must not depend on fitness internals
>>> exit code = 0

# 删除该规则后，裸跑
$ node dist/cli/index.js check
No fitness rules configured.
>>> exit code = 0
```

真实"未评估"样本（真实快照 + 真实空缺的 query 产物）：

```
$ node dist/cli/index.js check --config <workDir=/tmp/ne-demo, outputDir=<真实 output>>
Relation data unavailable: no query artifacts under /tmp/ne-demo/query (run `archguard analyze`).
  'no-dependency' rules will be reported as NOT-EVALUATED.
NOT-EVALUATED  CLI must not depend on fitness internals (no relation data available ...)
>>> exit code = 2
```

全量测试：`Test Files 373 passed | 3 skipped (376)`、`Tests 5479 passed | 18 skipped (5497)`。

## DoD

不是"relations 不再是空数组"就算完成：必须在真实项目上配置一条真实存在的禁止方向，用修复后的构建真实跑 `check` 得到非零退出码与具体边证据（修前同配置恒为 0），并有一个真实触发的"未评估"样本（无产物或无该粒度边时），而不只是单测假夹具。

## Touches

- src/cli/commands/check.ts
- src/cli/utils/fitness-relations-loader.ts
- src/analysis/fitness/rule-evaluator.ts
- src/analysis/fitness/dependency-checker.ts
- src/types/fitness-rules.ts
- tests/unit/cli/commands/check.test.ts
- tests/unit/cli/utils/fitness-relations-loader.test.ts
- tasks/gap-fitness-check-relations-stub.md
