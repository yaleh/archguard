# Proposal: Call Graph Extraction — 方法级调用边

**状态**: 草案（架构审查已完成，见底部"审查意见"节）  
**日期**: 2026-06-12  
**审查日期**: 2026-06-13  
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

---

## 架构审查意见（2026-06-13）

> 以下为对照实际代码的逐项审查，发现 5 处错误、3 处遗漏、2 处设计风险。  
> **标注说明**：🔴 错误/冲突  🟡 遗漏/不完整  🔵 风险/待决策

---

### 🔴 问题 1：Phase A — FlowGraph 访问路径错误

**方案原文**（§Phase A）：
> 当前 Go plugin 在 `index.ts:392` 将 FlowGraph 附加到 `extensions.goAtlas.layers.flow`，
> 需在同一位置将 call 边也写入 `archJson.relations`。

**实际代码**（`src/plugins/golang/index.ts:369-392`）：

```typescript
// baseArchJSON 在 line 369 构建，此时 atlas 尚未建立
const baseArchJSON: ArchJSON = { ..., relations };

// atlas 在 line 380 异步构建（需 Promise.all 四个 builder）
const atlas = await this.buildAtlasFromRawData(...);

// 最终在 line 392 合并
return { ...baseArchJSON, extensions: { goAtlas: atlas } };
```

**问题**：`mapRelations()` 在 line 358 调用，返回 `relations`，写入 `baseArchJSON`。
此时 `FlowGraph` 尚不存在——它由 line 380 的 `buildAtlasFromRawData()` 异步生成，
是在 `mapRelations()` 调用之后才完成的。方案描述的"在同一位置写入"在结构上不可行。

**正确修正路径**：需在 `buildAtlasFromRawData()` 返回后，
把 `flowGraph.callChains` 内的调用边追加到 `baseArchJSON.relations`。
具体修改点在 `index.ts:392` 附近：

```typescript
const atlas = await this.buildAtlasFromRawData(workspaceRoot, rawData, options);
const callRelations = this.mapper.mapCallRelations(atlas.layers.flow);  // 新增
return {
  ...baseArchJSON,
  relations: [...baseArchJSON.relations, ...callRelations],
  extensions: { goAtlas: atlas },
};
```

`mapCallRelations()` 应作为 `ArchJsonMapper` 的新方法（不是在 `mapRelations()` 内部调用），
因为它依赖 atlas 数据，而 `mapRelations()` 只依赖 `GoRawPackage[]`。

---

### 🔴 问题 2：Phase A — FlowGraph.CallEdge 结构与方案描述不符

**方案原文**（§Phase A 代码片段）：
```typescript
for (const chain of flowGraph.callChains) {
  for (const edge of chain.calls) {
    const [sourceClass, sourceMethod] = edge.from.split('.');
    const [targetClass, targetMethod] = edge.to.split('.');
```

**实际 CallEdge 类型**（`src/types/extensions/go-atlas.ts:248-253`）：
```typescript
export interface CallEdge {
  from: string;   // e.g. "main.handler" (entry handler name)
  to:   string;   // e.g. "svc.store.Save" or "fmt.Println"
  type: 'direct' | 'interface' | 'indirect';
  confidence: number;
}
```

**实际 `from` 值**（`flow-graph-builder.ts:366-369`）：
```typescript
calls.push({
  from: entry.handler,  // = EntryPoint.handler，格式如 "main.main" 或 "api.handleUser"
  to: call.packageName ? `${call.packageName}.${call.functionName}` : call.functionName,
```

因此 `edge.from` 是 handler 全名，**不是** `Class.Method` 格式。
`edge.to` 也可能是 `svc.store.Save`（多级路径），单次 `.split('.')` 会将 `svc` 当 class、
`store` 当 method 并丢失 `Save`。

**正确解析逻辑**应为：
```typescript
// from: 最后一个 '.' 之前是包/接收者，之后是函数名
const fromParts = edge.from.split('.');
const sourceMethod = fromParts.at(-1) ?? edge.from;
const sourceClass  = fromParts.slice(0, -1).join('.');  // 可能是空串

// to: 同理
const toParts = edge.to.split('.');
const targetMethod = toParts.at(-1) ?? edge.to;
const targetClass  = toParts.slice(0, -1).join('.');
```

另外，`FlowGraph.callChains` 是从**入口点**出发的调用链，仅覆盖可达路径，
不是全项目调用图。这对方案的"谁调用了 X"查询是有限制的——无法从任意非入口函数出发反查。
此限制应在精度声明中明示。

---

### 🔴 问题 3：Phase B — RelationExtractor 不持有 TypeChecker

**方案原文**（§Phase B）：
> `ts-morph 的 parseProject() 已持有 TypeChecker，可以通过
> node.getCallExpressions() 遍历方法体 CallExpression`

**实际 BaseExtractor**（`src/parser/base-extractor.ts`）：
```typescript
export abstract class BaseExtractor {
  protected readonly project: Project;
  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,   // ← 内存文件系统
      compilerOptions: { target: 99 },
    });
  }
}
```

`RelationExtractor` 继承自 `BaseExtractor`，使用 `useInMemoryFileSystem: true` 创建的
`Project`，**不加载任何 tsconfig.json，不解析 node_modules**。
在此 `Project` 上调用 `checker.getTypeAtLocation()` 只能得到 `any` 类型（无法解析外部符号），
跨文件引用也无法追踪（每次 `extract()` 调用只有单个文件）。

**修正路径**：Phase B 的 `extractCallEdges()` 不应加入 `RelationExtractor`，
而必须通过 `TypeScriptParser.parseProject()` 路径——后者创建的是带真实文件系统的 `Project`
（见 `src/parser/typescript-parser.ts`），TypeChecker 才可用。
建议新建独立类 `CallEdgeExtractor`，在 `parseProject()` 流程内接收完整的 `Project` 对象。

---

### 🔴 问题 4：RelationType 扩展的 switch 语句向后兼容

**方案原文**（§向后兼容）：
> `现有 switch/exhaustive check 需补 'call' 分支（TypeScript 编译器会报错提示，无静默破坏）`

**实际情况**：两处 switch 均使用 `default` 兜底，不会触发 TS 编译错误：

```typescript
// src/mermaid/generator.ts:591-609
switch (relation.type) {
  case 'inheritance': ...
  case 'implementation': ...
  case 'composition': ...
  case 'aggregation': ...
  case 'dependency':
  default:              // ← 'call' 边会走 default，渲染为 source --> target
    return `${source} --> ${target}`;
}

// src/mermaid/generator-formatting.ts:152-164 同上
```

**后果**：`'call'` 类型的 Relation 会被 Mermaid 渲染器**静默处理为 dependency 箭头**，
图中会出现大量额外箭头（尤其在 TypeScript 大项目），造成类图污染。
**必须**在 generator.ts 和 generator-formatting.ts 中显式过滤掉 `type='call'` 的边，
或在 `generateRelationLine()` 中为 `'call'` 返回空字符串/跳过。

另外，`src/types/metric-vector.ts:14` 和 `src/types/index.ts:235` 使用
`Partial<Record<RelationType, number>>`，`'call'` 加入 union 后会自动出现在统计分解里，
这是正确行为，无需额外处理。

---

### 🔴 问题 5：`inferenceSource` 类型约束冲突

**方案原文**（Phase A 代码片段）：
```typescript
inferenceSource: 'gopls',
```

**实际 `Relation` 接口**（`src/types/index.ts:213`）：
```typescript
inferenceSource?: 'explicit' | 'inferred' | 'gopls';
```

这里 `'gopls'` 是合法值，无类型冲突。
但方案 §OutputScope 聚合逻辑中提到：
```
inferenceSource: 'call-aggregated'
```
**`'call-aggregated'` 不在 union 中**，会触发 TypeScript 编译错误。
需将 `inferenceSource` 类型扩展为：
```typescript
inferenceSource?: 'explicit' | 'inferred' | 'gopls' | 'call-aggregated';
```
或改用 `metadata` 字段记录聚合来源。

---

### 🟡 遗漏 1：`outputScope='class'` 时 call 边聚合在哪里实现

**方案**（§决策 3）说在 `OutputScopeFilter` 中实现。  
**实际代码**：`src/core/query/output-scope-filter.ts` 只处理 `Entity` 字段裁减（`narrowEntity`），
**完全不接触 `relations`**。当前 relations 的过滤/聚合发生在 `applyOutputOptions()` 内，
通过 `edge-list-serializer.ts` 的 `serialize()` 处理——而 `serialize()` 也只是透传 `relations`，
不做 call 边聚合。

**明确实现点**：call 边的聚合过滤需在 `query-engine.ts:applyOutputOptions()` 中，
在 `narrowEntities()` 调用之后、`serialize()` 之前，增加 `filterRelationsForScope()` 步骤：

```typescript
private filterRelationsForScope(relations: Relation[], scope: OutputScope): Relation[] {
  if (scope === 'package') {
    return relations.filter(r => r.type !== 'call');
  }
  if (scope === 'class') {
    // 聚合 call 边：同 source+target 的 call 边合并为 dependency（若不已存在）
    const callEdges = relations.filter(r => r.type === 'call');
    const nonCallEdges = relations.filter(r => r.type !== 'call');
    const existingDeps = new Set(
      nonCallEdges
        .filter(r => r.type === 'dependency')
        .map(r => `${r.source}:${r.target}`)
    );
    const aggregated: Relation[] = [];
    const seen = new Set<string>();
    for (const edge of callEdges) {
      const key = `${edge.source}:${edge.target}`;
      if (!existingDeps.has(key) && !seen.has(key)) {
        seen.add(key);
        aggregated.push({ ...edge, type: 'dependency', inferenceSource: 'call-aggregated' });
      }
    }
    return [...nonCallEdges, ...aggregated];
  }
  return relations; // 'method': 全量保留
}
```

方案中声称在 `OutputScopeFilter` 做这件事是不准确的，该文件职责是 Entity 字段裁剪，
**不应**混入 Relation 处理逻辑。

---

### 🟡 遗漏 2：`archguard_find_callers` MCP 工具注册模式

**方案**（§决策 4）：
> 新增专用工具 `archguard_find_callers`

**实际 MCP 注册方式**（`src/cli/mcp/mcp-server.ts`）：
所有工具通过模块函数注册，例如 `registerAnalyzeTool(server, ...)` 和
`registerTestAnalysisTools(server, ...)`，每个工具集有独立文件。
建议在 `src/cli/mcp/tools/call-graph-tools.ts` 中实现 `registerCallGraphTools(server, defaultRoot)`，
然后在 `mcp-server.ts:createMcpServer()` 中调用，与现有模式一致。

方案中未给出工具参数的 Zod schema 定义，而这是 MCP 工具注册的强制要求（所有参数必须用 `z.string()`
等声明）。至少应明确：
- `entityName: z.string()` — 必填，支持 `ClassName` 或 `ClassName.methodName` 两种格式
- `depth: z.number().int().min(1).max(5).default(1)` — 传递深度
- `projectRoot: z.string().optional()` — 与其他工具一致

---

### 🟡 遗漏 3：FlowGraph 仅覆盖入口可达路径，call graph 的完整性存在根本限制

**方案**在"不做的事"中未明示此限制。

`FlowGraphBuilder.buildCallChains()` 的工作方式：
以 `EntryPoint.handler` 为起点，遍历该 handler 函数体的 `body.calls`，
**仅追踪入口可达的一层调用**（无递归追踪）。

这意味着：
1. `archguard_find_callers("UserService.save")` 只能找到**直接从 HTTP handler 调用 `save`** 的路径，
   无法找到 `save` 被 `BatchProcessor.run()` 调用的情况（如果 `BatchProcessor` 不是入口点）。
2 Go 的 call graph 覆盖率远低于方案暗示的 ~90%。

**建议**：在精度声明中将 Go 的适用范围限定为"从已检测入口点出发的可达路径"，
并在 `archguard_find_callers` 的工具描述中明确此限制。

---

### 🔵 风险 1：大项目 call 边数量爆炸

方案 §决策 3 提到 "TypeScript 大项目可能有数万条" call 边，并通过 `outputScope` 过滤解决。
但 `archJson.relations` 是序列化到磁盘（`.archguard/query/*.json`）的，
数万条 call 边即使在 `outputScope='class'` 时不暴露给 MCP 调用方，仍会：
- 增加磁盘上 ArchJSON 文件体积
- 增加 `QueryEngine` 加载时间（全量反序列化）
- 增加 `filterRelationsForScope()` 运行时开销

**建议**：Phase B 实施前评估 ArchGuard 自身（约 200 个 class）产生的 call 边数量；
若超过 5000 条，考虑将 call 边分离存储（独立 call-graph.json）而非混入 `relations`。

---

### 🔵 风险 2：`CallEdge.type: 'indirect'` 与 `Relation.callType: 'indirect'` 映射语义不一致

`FlowGraphBuilder` 的 `classifyCallType()` 只返回 `'direct' | 'interface'`，
`'indirect'` 在 `CallEdge` 类型定义中存在但实际构建逻辑从不产生（代码仅有两个返回分支）。

方案引入的 `Relation.callType: 'direct' | 'interface' | 'indirect'` 中，
`'indirect'` 预留给 Phase C Python（duck typing），但 `CallEdge.type` 映射时直接用
`edge.type` 赋值会引入一个永不出现的值（对 Go）。
建议在 Phase A mapper 中只映射 `'direct'` 和 `'interface'`，Python 的 `'indirect'` 单独处理。
