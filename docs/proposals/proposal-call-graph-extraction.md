# Proposal: Call Graph Extraction — 方法级调用边

**状态**: 草案  
**日期**: 2026-06-12  
**前置依赖**: `proposal-llm-aware-output.md`（`outputScope='method'` 的语义补完）  
**涉及 ADR**: ADR-002（ArchJSON extensions）、ADR-007（CLI/MCP 接口一致性）

---

## 背景

### 为什么需要调用边

`proposal-llm-aware-output.md` 中 `outputScope='method'` 当前只暴露 `Entity.members[]`
（方法签名、参数、返回类型），**不包含方法间调用关系**。而 granularity 实验的 L3 最优粒度，
其完整语义是"method 级 + call graph"。

没有调用边，以下查询在 ArchGuard 中无法回答：
- "谁调用了 `UserService.save()`？"（直接调用方）
- "变更 `CacheManager.invalidate()` 后，哪条调用链会受影响？"（影响链追踪）
- "这个方法的所有传递依赖路径是什么？"（C 类综合任务）

当前这些问题只能靠 LLM 从 class 级关系推断，精度低且幻觉多。调用边补全后，
`archguard_get_dependencies` 和 `archguard_get_change_context` 可以直接回答。

### 现状盘点（代码检查结论）

| 语言 | 方法体 AST 遍历 | 调用边数据 | 写入 ArchJSON Relation |
|---|---|---|---|
| TypeScript | ❌ 无（regex 文本扫描） | ❌ 无 | ❌ |
| Go | ✅ `GoCallExpr`（Atlas） | ✅ `FlowGraph.CallEdge` | ❌ 存在 extensions，未映射 |
| Java | ❌ 无 | ❌ 无 | ❌ |
| Python | ❌ 无 | ❌ 无 | ❌ |

**Go 的工作量最小**：数据已有，只需把 `CallEdge` 归一化映射进 `Relation[]`。  
**TypeScript 工作量居中**：ts-morph 的 `parseProject()` 已持有 TypeChecker，
可以通过 `node.getCallExpressions()` 遍历方法体 CallExpression，解析调用目标类型。  
**Java/Python 工作量最大**：tree-sitter bridge 需要新增方法体遍历逻辑。

### Schema 现状

```typescript
// src/types/index.ts:196
export type RelationType =
  | 'inheritance' | 'implementation'
  | 'composition' | 'aggregation'
  | 'dependency'  | 'association';

// src/types/index.ts:207
export interface Relation {
  id: string;
  type: RelationType;
  source: string;   // entity id（class 级）
  target: string;   // entity id（class 级）
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls';
}
```

`Relation.source/target` 当前是 class 级 entity id，没有 method 粒度字段。

---

## 决策

### 决策 1 — 扩展 `RelationType` 和 `Relation` 支持方法级调用边

```typescript
// src/types/index.ts
export type RelationType =
  | 'inheritance' | 'implementation'
  | 'composition' | 'aggregation'
  | 'dependency'  | 'association'
  | 'call';                           // ← 新增

export interface Relation {
  id: string;
  type: RelationType;
  source: string;             // entity id（class 级，不变）
  target: string;             // entity id（class 级，不变）
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls';
  // 新增：type='call' 时有效，精确到方法粒度
  sourceMethod?: string;      // 调用方方法名（e.g. "save"）
  targetMethod?: string;      // 被调用方方法名（e.g. "invalidate"）
  callType?: 'direct' | 'interface' | 'indirect';
}
```

**设计原则**：
- `source/target`（class 级）向后兼容，所有现有代码无需修改
- `sourceMethod/targetMethod` 仅在 `type='call'` 时填充，其余类型保持 undefined
- `outputScope='class'` 时过滤掉 call 边（或聚合为 class 间 dependency）；
  `outputScope='method'` 时包含全部 call 边

### 决策 2 — 分三阶段实现，Go 优先

#### Phase A：Go Atlas CallEdge → ArchJSON Relation（低成本，高收益）

**文件**：`src/plugins/golang/archjson-mapper.ts:mapRelations()`

Go Atlas 的 `FlowGraph.CallChain.calls: CallEdge[]` 已有完整调用边数据，
只需在 mapper 里将其归一化：

```typescript
// archjson-mapper.ts — mapRelations() 新增段落
for (const chain of flowGraph.callChains) {
  for (const edge of chain.calls) {
    const [sourceClass, sourceMethod] = edge.from.split('.');
    const [targetClass, targetMethod] = edge.to.split('.');
    relations.push({
      id: `call:${edge.from}:${edge.to}`,
      type: 'call',
      source: resolveEntityId(sourceClass),
      target: resolveEntityId(targetClass),
      sourceMethod,
      targetMethod,
      callType: edge.type,
      confidence: edge.confidence,
      inferenceSource: 'gopls',
    });
  }
}
```

前提：`mapRelations()` 须能访问到 `BehaviorAnalyzer` 构建的 `FlowGraph`。
当前 Go plugin 在 `index.ts:392` 将 FlowGraph 附加到 `extensions.goAtlas.layers.flow`，
需在同一位置将 call 边也写入 `archJson.relations`。

#### Phase B：TypeScript AST CallExpression 提取（中等成本）

**文件**：`src/parser/relation-extractor.ts` 新增 `extractCallEdges()`

ts-morph 的 `parseProject()` 持有完整 TypeChecker（`project` 对象），可以解析
CallExpression 的接收者类型：

```typescript
// relation-extractor.ts 新增方法
extractCallEdges(sourceFile: SourceFile): Relation[] {
  const relations: Relation[] = [];
  const checker = this.project.getTypeChecker();

  sourceFile.getClasses().forEach(cls => {
    cls.getMethods().forEach(method => {
      method.getBody()?.getDescendantsOfKind(SyntaxKind.CallExpression)
        .forEach(call => {
          const access = call.getExpression();
          if (!Node.isPropertyAccessExpression(access)) return;

          // 解析接收者类型
          const receiverType = checker.getTypeAtLocation(access.getExpression());
          const targetClass = receiverType.getSymbol()?.getName();
          if (!targetClass || !this.isProjectEntity(targetClass)) return;

          relations.push({
            id: `call:${cls.getName()}.${method.getName()}:${targetClass}.${access.getName()}`,
            type: 'call',
            source: this.resolveEntityId(cls.getName()),
            target: this.resolveEntityId(targetClass),
            sourceMethod: method.getName(),
            targetMethod: access.getName(),
            callType: 'direct',
            confidence: 0.85,
            inferenceSource: 'explicit',
          });
        });
    });
  });
  return relations;
}
```

**关键过滤**：`isProjectEntity(name)` 只保留项目内实体，过滤掉 stdlib、`node_modules`、
原始类型。使用现有 `archJson.entities` 的 id 集合作为白名单。

**限制**：
- `parseCode()`（in-memory，无 TypeChecker）不支持，只在 `parseProject()` 路径提取
- 多态调用（interface 方法 dispatch）`callType` 标记为 `'interface'`，confidence 降为 0.6
- callback / 高阶函数调用无法静态解析，跳过

#### Phase C：Java / Python tree-sitter 方法体遍历（较高成本）

**Java**（`src/plugins/java/tree-sitter-bridge.ts`）：

在 `extractMethod()` 后增加 `extractMethodCalls(methodNode)` —— 遍历
`method_declaration` 节点的 `block` 子树，匹配 `method_invocation` 节点：

```
method_invocation
  ├── object: identifier / field_access  → 接收者
  └── name: identifier                   → 方法名
```

接收者类型解析：先查同类字段类型（`this.fieldType` map），找不到降级为
`confidence=0.5` 的模糊边（source=当前 class，target=unknown，记录方法名）。

**Python**（`src/plugins/python/tree-sitter-bridge.ts`）：

`extractFunction()` / `extractMethod()` 已取到 `body` 节点，在此基础上
遍历 `call` 节点：

```
call
  ├── function: attribute  → receiver.method
  └── function: identifier → standalone function call
```

Python 无静态类型（duck typing），接收者类型基本不可静态解析，
confidence 统一 0.4，标记 `callType='indirect'`。

---

### 决策 3 — `outputScope` 对 call 边的处理规则

在 `OutputScopeFilter`（`src/core/query/output-scope-filter.ts`，`proposal-llm-aware-output` 新增）中：

| `outputScope` | call 边处理 |
|---|---|
| `'package'` | 丢弃 call 边（package 间依赖已由 dependency 关系覆盖） |
| `'class'` | 聚合：将同 source+target class 的 call 边合并为一条 `dependency` 关系（增加 `inferenceSource: 'call-aggregated'`）；不重复已有 dependency |
| `'method'` | 保留全部 call 边，含 `sourceMethod`/`targetMethod` 字段 |

这样 `outputScope='class'` 的调用方不会看到 call 边爆炸（TypeScript 大项目可能有数万条），
`outputScope='method'` 的调用方拿到完整调用图。

### 决策 4 — `archguard_find_callers` MCP 工具（新增）

基于 call 边数据，新增专用工具：

```
archguard_find_callers(entityName, methodName?, depth?)
```

返回调用指定实体（可精确到方法）的所有调用方，支持传递追踪（BFS，depth 上限 5）。
与 `archguard_get_dependents` 的区别：dependents 是 class 级结构依赖；callers 是
method 级运行时调用链。

**CLI 对称**：`query --callers <Entity.method> [--depth 3]`（ADR-007 §4 对称性）。

---

## 实施规范

### 分层架构

```
Phase A: golang/archjson-mapper.ts      ← FlowGraph.CallEdge → Relation[]
Phase B: parser/relation-extractor.ts   ← ts-morph CallExpression → Relation[]
Phase C: java/tree-sitter-bridge.ts     ← method_invocation → Relation[]
         python/tree-sitter-bridge.ts   ← call node → Relation[]
                     ↓
           src/types/index.ts           ← RelationType += 'call'; Relation += sourceMethod/targetMethod
                     ↓
           src/core/query/output-scope-filter.ts  ← call 边聚合/过滤规则
                     ↓
           src/cli/mcp/tools/           ← archguard_find_callers
           src/cli/commands/query.ts    ← --callers flag
```

### 精度声明（MCP 工具描述，ADR-006 §2.3）

```
archguard_find_callers:
  "Return direct and transitive callers of an entity or method using
   statically-extracted call edges; precision varies by language:
   TypeScript ~85% (TypeChecker-resolved), Go ~90% (gopls-assisted),
   Java ~60% (tree-sitter heuristic), Python ~40% (duck-typed, indirect).
   Dynamic dispatch, callbacks, and reflection are not resolved."
```

### 测试要求

1. **Schema 测试**：`Relation` 新字段在 `type='call'` 时存在，其余类型时为 undefined。
2. **Go Phase A**：fixture Go 项目 → call 边出现在 `archJson.relations`，`type='call'`，`sourceMethod/targetMethod` 填充正确。
3. **TypeScript Phase B**：fixture TS 项目 → 直接方法调用生成 call 边；stdlib 调用过滤；无 TypeChecker 路径（parseCode）不产生 call 边。
4. **OutputScopeFilter**：`outputScope='class'` 时 call 边聚合为 dependency，不重复；`outputScope='method'` 时全量保留。
5. **`archguard_find_callers`**：depth=1 直接调用方；depth=2 传递调用方；循环调用不死循环（visited set）。

### 向后兼容

- `RelationType` 扩展为 union 类型，现有 switch/exhaustive check 需补 `'call'` 分支（TypeScript 编译器会报错提示，无静默破坏）。
- `Relation` 新字段均为可选，现有代码对未知字段 JSON 序列化无影响。
- `outputScope='class'`（默认值）时 call 边不暴露，现有 MCP 调用方行为不变。

---

## 不做的事

- **不实现运行时 call graph**：不插桩，不 patch，不依赖运行时 profiler。
- **不解析反射调用**（`Class.forName`、`eval`、`__getattr__`）：静态分析无法可靠解析。
- **不为 C++ 实现 Phase C**：C++ 有模板、虚函数、函数指针，静态解析复杂度极高，性价比低；Go/TS/Java/Python 覆盖主要语言已足够。
- **不在 Phase A 之前合并 Phase B/C**：Go 的数据最成熟（FlowGraph 已生产级），
  先 Phase A 验证 schema 设计，再推进 Phase B/C。

---

## 关联文档

- `proposal-llm-aware-output.md` — `outputScope` 参数定义，本提案的前置
- `src/types/extensions/go-atlas.ts` — `FlowGraph`、`CallEdge` 现有定义
- `src/plugins/golang/atlas/builders/flow-graph-builder.ts` — Go callchain 构建参考实现
- granularity-v2.2 REPORT-v2.md §5 — L3 method 级最优的实验证据
