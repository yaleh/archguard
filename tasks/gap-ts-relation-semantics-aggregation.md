---
id: gap-ts-relation-semantics-aggregation
title: TS 关系语义与 UML 不符：构造注入被标成 composition（过声明），且 dependency/composition
  边界无文档（下游只能保守降级）
status: todo
labels:
  - gap
  - parser
  - docs
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：TypeScript 的关系语义与 UML 不一致，下游只能保守降级。
- `src/parser/relation-extractor.ts:136-151` 把**字段类型**和**构造函数参数类型**都标成 `composition`；
- `src/parser/relation-extractor.ts:154-167` 把方法参数/返回类型标成 `dependency`；
- `RelationType` 本身已经包含 `aggregation`（`src/types/index.ts:206-214`），C++ 插件也按指针/值区分 composition vs aggregation（`src/plugins/cpp/cpp-type-extractor.ts:158-166`），但 TypeScript 从不产出 `aggregation`；
- Mermaid/PlantUML 生成器已经支持两种箭头（`src/mermaid/generator-formatting.ts:170-174`：composition `*--`，aggregation `o--`）。

按 UML：composition = 强拥有/同生命周期；aggregation = 弱持有/外部拥有。构造注入（`constructor(private repo: Repo)`）属于后者，当前却叫 composition，是过声明；下游只能把它画成空心菱形，或反向把 composition 当 aggregation 映射。

**修复方向（TypeScript 范围）**：
1. 构造参数（含 parameter property）产生的关系改为 `aggregation`：参数由外部注入、生命周期不在本类，语义明确。
2. 字段保持 `composition`，但在文档中明确它的实际口径是「字段持有」——archguard 拿不到生命周期信息，不能断言强拥有；`private x = new Foo()` 与 `private x: Foo` 不做强/弱推断（避免用启发式再次过声明）。
3. 在 `docs/dev-guide/archjson-levels.md` 增加「关系类型判定口径」小节，逐条写明：
   - `inheritance`：`class/interface extends`；
   - `implementation`：`class implements`；
   - `composition`：字段类型持有（生命周期未知，下游可保守映射为 association/aggregation）；
   - `aggregation`：构造注入/弱持有；
   - `dependency`：import、方法参数、返回类型等类型引用；
   - `call`：方法/函数间的调用边（类级存储时不含方法名）。
   并给出 dependency vs composition/aggregation 的边界例子。
4. 兼容性：不重命名 `composition`、不改 ArchJSON schema；只改变 TS 构造参数边的 type，更新受影响的测试断言。

## AC

- [ ] 夹具：`class A { constructor(private repo: Repo) {} }` 产出 `A -> Repo` 的 `aggregation`；`class B { private x = new Foo(); }` 仍产出 `composition`；方法参数/返回仍产出 `dependency`
- [ ] 同一对 (source,target) 不会同时出现 composition 与 aggregation（无重复边）
- [ ] 现有 TypeScript 关系测试按新语义更新并通过；非 TS 插件（C++ 的指针/值分类）行为不变
- [ ] 文档：`docs/dev-guide/archjson-levels.md` 有「关系类型判定口径」表，覆盖全部 RelationType，并明确 composition 是「字段持有、生命周期未知」、aggregation 是「构造注入/弱持有」，附 dependency 与它们的边界示例
- [ ] 真实数据：复制 claudecodeui `93e0a992` 的 arch.json 重跑关系提取，记录 composition → aggregation 的迁移条数，并与构造参数数量对得上
- [ ] 渲染不回归：Mermaid 对 aggregation 产出 `o--`、composition 产出 `*--`（现有 generator 测试覆盖）
- [ ] 明确边界：不做字段级强/弱推断、不重命名类型、不改变其他语言插件
- [ ] `bash scripts/test.sh --for-task gap-ts-relation-semantics-aggregation` 与 `npm run type-check` 通过

## DoD

不是「把字符串 composition 换成 aggregation」就算完成。要在 claudecodeui 的真实副本上重跑一次关系提取，展示迁移前后的类型计数与具体样例边（构造注入 → aggregation），并给出文档中的判定表；同时证明 Mermaid 产物中 `o--` 与 `*--` 都按预期出现，且没有同一对实体被重复标注两种关系。

## Touches

- tasks/gap-ts-relation-semantics-aggregation.md
- src/parser/relation-extractor.ts
- docs/dev-guide/archjson-levels.md
- tests/unit/parser/relation-extractor.test.ts
