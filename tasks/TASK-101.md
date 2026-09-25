---
id: TASK-101
title: "TASK-101: 检测器「植入已知缺陷」正对照测试——环、字面量分散、符号链接根、多 source、TS 包边界"
status: ready
labels:
  - gap
  - test
  - analysis
parent: null
children: []
extra: {}
depends_on:
  - TASK-89
  - TASK-92
  - TASK-96
  - TASK-103
---
## Proposal

现有检测器（环检测、shape smell/字面量分散、cluster boundary）返回 0 或 `[]` 时，没有已知为真的正对照来证明「0」是测出来的而不是检测器失灵：quay 的分析里 `shape_smells` 连续返回 0 无法判断对错，`cluster_boundary` 对 TS 失效也是靠 grep 才发现，字面量检测只认双引号的漏检（TASK-103）同样是这种静默失效。本任务把「植入已知缺陷」做成自动化集成测试，防止同类静默失效复发。

方案：新增 `tests/integration/detector-positive-controls.test.ts`，在临时目录里生成小型 TS 项目并走真实的 `runAnalysis` → `loadEngine` 路径（不依赖 Claude CLI），逐项植入并断言检测器**能**报出：
1. 植入一个 A↔B 模块环，`detect_cycles` 报出该环，去掉后为 `[]`（成对的负对照）；
2. 植入同一状态字面量分散在 3 个文件，literal dispersion / shape smell 报出；**fixture 必须同时覆盖单引号与双引号两种写法**（依赖 TASK-103）；
3. 植入指向同一目录的符号链接根，manifest 只有 1 个 scope（依赖 TASK-92）；
4. 传 2 个 source，manifest 有 2 个 scope（依赖 TASK-89）；
5. 3 个目录、无点实体名的 TS 项目，cluster boundary 的 `packageCount` 为 3（依赖 TASK-96）。
每条都带成对的负对照（去掉缺陷后不报），保证不是恒真。

<!-- dedup-ref -->
相关：TASK-89、TASK-92、TASK-96、TASK-103 各自的单元测试覆盖本项的单点行为；本任务是跨工具、走真实分析管线的端到端对照，不重复它们的用例。

## AC

- [ ] `npx vitest run tests/integration/detector-positive-controls.test.ts` exit 0，5 组植入均含正对照与负对照用例，其中字面量分散组含单引号与双引号两种 fixture
- [ ] 手工回退验证：临时还原 TASK-96 的修复（或在测试里把 `packageOf` 置空）后，对应用例变红，恢复后变绿；结果记入本文件 `## Evidence`
- [ ] `npm run test:integration` exit 0（不因新增用例拖垮既有集成测试）
- [ ] 测试不依赖网络与 Claude CLI，临时目录在 `finally` 中清理（`grep -n "finally" tests/integration/detector-positive-controls.test.ts` 有结果）
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

对照测试在 CI 用的同一测试入口下运行，且至少一次通过回退修复证明它会在检测器失灵时变红；本文件 Evidence 记录该次变红/变绿的命令与输出。

## Touches

- `tests/integration/detector-positive-controls.test.ts`
- `tasks/TASK-101.md`
