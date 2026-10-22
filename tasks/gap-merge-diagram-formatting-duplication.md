---
id: gap-merge-diagram-formatting-duplication
title: 合并 plantuml/mermaid 的 generator-formatting 重复，格式无关逻辑抽共享模块
status: ready
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`src/plantuml/generator-formatting.ts`（14 个导出函数）与 `src/mermaid/generator-formatting.ts`（11 个导出函数）高度重复：`normalizeEntityName`、`isNoisyTarget` 逐字节相同，`generateMemberLine` 只差 PlantUML `{static}` vs Mermaid `static`，`generateRelationLine`/`escapeId`/`sanitizeType`/`shouldIncludeMember`/`getVisibilitySymbol`/`generateClassDefinition` 同名同责。抽一个共享格式化模块，格式无关逻辑只留一份，格式差异用参数或策略注入。

## AC

- [ ] `normalizeEntityName` / `isNoisyTarget` / `shouldIncludeMember` / `getVisibilitySymbol` / `sanitizeType` 等格式无关函数在 `src/` 下只剩一份定义（`grep -rn "export function normalizeEntityName" src/` 仅 1 处，其余同名同理）
- [ ] `generateMemberLine` / `generateRelationLine` / `generateClassDefinition` 的格式差异（`{static}` vs `static`、别名映射类型）通过参数/策略注入，不再复制整函数体
- [ ] `npm test -- --run tests/unit/mermaid/generator-formatting.test.ts tests/unit/mermaid/generator-formatting-pure.test.ts tests/unit/plantuml/generator.test.ts` 全绿，输出与现状等价（golden/现有断言不变）

## DoD

PlantUML 与 Mermaid 两个渲染器仍产出等价输出，且跨文件的同名重复函数体消失——`grep -rn "export function normalizeEntityName" src/` 证明只剩一处，共享模块被两个 generator-formatting 同时 import。

## Touches

- src/plantuml/generator-formatting.ts
- src/mermaid/generator-formatting.ts
- src/diagram/generator-formatting.ts (new)
- tests/unit/mermaid/generator-formatting.test.ts
- tests/unit/mermaid/generator-formatting-pure.test.ts
- tests/unit/plantuml/generator.test.ts
- tasks/gap-merge-diagram-formatting-duplication.md