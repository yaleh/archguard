---
id: gap-fitness-check-relations-stub
title: archguard check 的 no-dependency 规则因 check.ts 硬编码空 relations 永不失败（死桩）
status: todo
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

## AC

- [ ] `check.ts` 从 analyze 产物加载真实 relations（不再是 `[]`），且无产物/无该粒度边时打印明确的"未评估"提示而非静默 pass
- [ ] `tests/unit/cli/commands/check.test.ts` 新增成对用例：存在 from→to 禁止边时 `no-dependency` 判 fail；不存在该边时 pass；运行 `npx vitest run tests/unit/cli/commands/check.test.ts` 退出码 0
- [ ] 真实对照：在 archguard 自身配置一条当前树真实存在的禁止方向（先用 `query` 确认该边存在），`node dist/cli/index.js check` 退出码 1 且打印该条边；删除该规则后退出码 0
- [ ] `npm run type-check` 与全量测试通过

## DoD

不是"relations 不再是空数组"就算完成：必须在真实项目上配置一条真实存在的禁止方向，用修复后的构建真实跑 `check` 得到非零退出码与具体边证据（修前同配置恒为 0），并有一个真实触发的"未评估"样本（无产物或无该粒度边时），而不只是单测假夹具。

## Touches

- src/cli/commands/check.ts
- src/analysis/fitness/rule-evaluator.ts
- src/analysis/fitness/dependency-checker.ts
- tests/unit/cli/commands/check.test.ts
- tasks/gap-fitness-check-relations-stub.md