---
id: TASK-102
title: "TASK-102: 函数体重复检测，并把 const 箭头函数纳入实体（P2 新功能，需先出方案）"
status: ready
labels:
  - gap
  - feature
  - analysis
  - proposal-needed
parent: null
children: []
extra: {}
---
## Proposal

09-24 的一次真实任务是「找项目里的重复函数」，archguard 没有函数体重复检测，最后不得不改用自写的 TypeScript 编译器抽取脚本：脚本得到 15359 个实体，archguard 对同一目录只有 3525 个。两者对「实体」的定义不同（哪个更准未核实），但差距说明 `const foo = () => {}` 这类箭头函数很可能没有进入实体（`src/parser/function-extractor.ts` 是抽取入口，具体覆盖范围待核实）。

本任务是新功能，不与 TASK-89 至 TASK-101 的缺陷修复混做，且**先出方案后实现**：
1. 核实并记录：`function-extractor.ts` 当前抽取哪些形态（function 声明、`const` 箭头函数、类方法、对象字面量方法），与自写脚本的差异清单，写入本文件 `## Finding`。
2. 决定重复的判据：AST 归一化后的结构哈希（忽略标识符与字面量）、token 序列相似度，或两者组合；给出误报控制（最小语句数、排除测试与生成代码）。
3. 决定输出形态：新增 MCP 工具（如 `archguard_detect_duplicates`）加对应 CLI flag（受 ADR-007 约束：每个 MCP 工具必须有对应 CLI flag），返回重复组（成员的 file/line/实体名、相似度、共同行数）。
方案定稿（含判据、阈值、性能预算）后，再据此细化 AC 并推进到 ready。

<!-- dedup-ref -->
与 TASK-96 无关：那里是既有工具对 TS 失效，这里是新增能力。「植入已知缺陷」的对照方式适用于本功能，届时在 TASK-101 的测试文件里追加重复函数的正对照。

## AC

- [ ] 本文件新增 `## Finding` 小节，列出 `function-extractor.ts` 各形态的抽取现状与和自写脚本的差异清单（`grep -n "^## Finding" tasks/TASK-102.md` 有结果）
- [ ] 本文件新增 `## Design` 小节，写明判据、阈值、误报控制、性能预算与输出形态，并经人确认后才可推进到 ready
- [ ] `const` 箭头函数被纳入实体：`npx vitest run tests/unit/parser/function-extractor.test.ts` exit 0，含箭头函数用例（文件名以实际测试文件为准）
- [ ] 重复检测：对植入 2 份相同函数体（标识符不同）的 fixture，检测器报出 1 个重复组；对结构不同的函数不报
- [ ] `npm run check:adr` exit 0（新增 MCP 工具有对应 CLI flag）
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

对本仓库自身或一个真实项目实际运行重复检测，报告中至少有一组经人工核对确为重复的函数；`const` 箭头函数实体数与自写脚本的差异被解释清楚（差异清单里每一项都有结论）。

## Touches

- `src/parser/function-extractor.ts`
- `src/cli/mcp/mcp-server.ts`
- `src/cli/commands/query.ts`
- `tests/unit/parser/function-extractor.test.ts`
- `tasks/TASK-102.md`
