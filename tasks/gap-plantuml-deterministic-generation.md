---
id: gap-plantuml-deterministic-generation
title: PlantUML 确定性生成：ArchJSON → PlantUML 类图 .puml emitter（复用 grouper，renderer
  facade 去 Mermaid 化）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 关联已 done 的 gap-layer-violations-relocate-misplaced-types（已把 MermaidOutputOptions/RenderJob 从 mermaid 迁到 core/interfaces，本任务在其上进一步格式中性化）——不同机制，另行立案。

v1.x 的 PlantUML 由 LLM 整份生成，复杂类图渲染失败率 40–60%，v2 已删。本任务用确定性 emitter 把 PlantUML 接回：ArchJSON + GroupingDecision（复用 src/mermaid/grouper.ts，格式无关）→ 确定性产出 @startuml/@enduml 包裹的 .puml 文本。发射层新增 src/plantuml/generator-formatting.ts，逐函数对译 src/mermaid/generator-formatting.ts（实体声明/成员行/关系行/分组）；泛型经 sanitizeType 确定性清洗为 PlantUML 可表达形态（PlantUML 类图不支持 Map<K,V>，旧 plantuml-validator.ts 的 containsGenericType 即为此而生）。structural validator 复用旧 validateRelationshipReferences 语义保证关系端点只引用已定义实体。CLI 加 -f plantuml（emit-only，只产出 .puml，不做渲染——渲染是后续方向，另行立项）。

## AC

- [ ] src/plantuml/generator-formatting.ts 逐函数对译 src/mermaid/generator-formatting.ts 的发射面：class/interface/enum/abstract class 声明、成员行、四种关系（--|> 继承、..|> 实现、..> 依赖、--> 关联）、package/namespace 分组；含空格/特殊字符的类名产出 `"..." as alias` 且关系端点引用别名
- [ ] src/plantuml/generator.ts 从 ArchJSON + GroupingDecision 确定性产出 @startuml/@enduml 包裹的 .puml，空 ArchJSON 产出合法空图；含泛型实体/端点不产出含 `Map<K,V>` 的非法声明
- [ ] src/plantuml/validator-structural.ts：@startuml/@enduml 配对、拒绝 containsGenericType 的非法声明与端点、关系端点必须引用已定义实体（未定义端点 = 负对照断言报错）
- [ ] src/core/interfaces/renderer-facade.ts 与 renderer-types.ts 去 Mermaid 化：RenderJob.mermaidCode → diagramCode + format（'mermaid'|'plantuml'），outputPath.mmd → source；src/mermaid/diagram-generator.ts 适配后 tests/unit/mermaid/generator.test.ts 全绿
- [ ] src/cli/config-loader.ts 放行 plantuml 格式（emit-only），tests/unit/cli/config-loader-plantuml-removal.test.ts 由「拒绝 plantuml」反转为「放行 plantuml 为 emit-only 格式」；src/cli/utils/output-path-resolver.ts 产出 .puml 路径
- [ ] tests/unit/plantuml/generator.test.ts（黄金文件 byte-identical）+ tests/unit/plantuml/validator-structural.test.ts 覆盖：空 ArchJSON、含泛型实体、含空格类名、四种关系、package 分组、未定义端点负对照

## DoD

对 fixtures 中含泛型/空格类名/四种关系的 TS 项目跑 `node dist/cli/index.js analyze -f plantuml`，产出 .puml 且（a）与黄金文件 byte-identical，（b）经 src/plantuml/validator-structural.ts 校验 0 未定义端点、0 非法泛型声明；`npm test`、`npm run type-check`、`npm run build` 全绿。

## Touches

- src/core/interfaces/renderer-facade.ts
- src/core/interfaces/renderer-types.ts
- src/mermaid/diagram-generator.ts
- src/cli/config-loader.ts
- src/cli/processors/diagram-output-router.ts
- src/cli/utils/output-path-resolver.ts
- src/plantuml/generator.ts
- src/plantuml/generator-formatting.ts
- src/plantuml/validator-structural.ts
- src/plantuml/index.ts
- tests/unit/cli/config-loader-plantuml-removal.test.ts
- tests/unit/cli/config-loader.test.ts
- tests/unit/mermaid/generator.test.ts
- tests/unit/architecture/layer-imports.test.ts
- tests/integration/render-separation.test.ts
- tests/unit/plantuml/generator.test.ts
- tests/unit/plantuml/validator-structural.test.ts
- tasks/gap-plantuml-deterministic-generation.md