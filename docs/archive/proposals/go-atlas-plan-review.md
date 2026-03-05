# Code Review: Go Atlas Enhancement Plan

> Reviewer perspective: strict architect
> Based on: actual source code cross-referenced line-by-line against plan stages

---

## Phase A — Fix Cross-Package Qualifier Resolution

### 问题 1：测试 fixture 中 `GoImport.location` 是必填字段

`GoImport` 的类型定义（`types.ts:140-145`）：

```typescript
export interface GoImport {
  path: string;
  alias?: string;
  location: GoSourceLocation;   // ← 非 optional，必须提供
  type?: 'std' | 'internal' | 'external' | 'vendor';
}
```

当前 `makePackage()` 测试工厂函数的 `imports: []` 是空数组。Stage A-1 的测试需要构造有实际 import 的 `GoRawPackage`，必须包含 `location` 字段，否则 TypeScript 编译报错。Plan 的 fixture 描述里没有提到这一点。

修正：Stage A-1 的 fixture 描述需要明确 `location: { file: '...', startLine: 0, endLine: 0 }` 是必填项。

### 问题 2：convert fullPath → module-relative path 的逻辑前提未说清

Plan Stage A-2 写道：

> `fullPath.replace(rawData.moduleName + '/', '')` → e.g. `"pkg/engine"`

`GoImport.path` 存储的是完整 import path（如 `"github.com/org/repo/pkg/engine"`），而 `pkgTypeToNodeId` 的 key 用的是 module-relative path（如 `"pkg/engine"`）。这个转换仅在 import 属于当前模块时成立。对 stdlib 或外部依赖，`replace` 不会生效，字符串保持原样，然后查 map 找不到，直接 fallthrough 到短名 lookup——这个行为是正确的，但 Plan 没有明确说明这是预期的降级路径。实现时需要注意这个 if-branch。

---

## Phase B — Structural Metrics + Concrete Usage

### 问题 3：版本常量升级会静默失效

Plan 说：

> 在 `extensions.ts` 中 bump `GO_ATLAS_EXTENSION_VERSION = '1.1'`

但 `index.ts:185` 是这样写的：

```typescript
return {
  version: '1.0',   // ← 硬编码字符串，不引用 GO_ATLAS_EXTENSION_VERSION 常量
  layers: { ... },
```

**`GO_ATLAS_EXTENSION_VERSION` 常量目前根本没有被 `index.ts` 使用。** 只改 `extensions.ts` 中的常量，实际输出的 Atlas JSON 里 `version` 字段仍然是 `"1.0"`，版本升级会静默失效。

修正：`src/plugins/golang/atlas/index.ts` 必须加入 Phase B 的 files changed 列表，且版本升级方式应改为：

```typescript
import { GO_ATLAS_EXTENSION_VERSION } from '@/types/extensions.js';
// ...
return {
  version: GO_ATLAS_EXTENSION_VERSION,
```

### 问题 4：`methodCount` 代码示例有 O(n²) 错误

Stage B-types 的实现描述写道：

```typescript
methodCount = pkg.structs.flatMap(s => s.methods).filter(m => m.receiverType === struct.name).length
```

`GoRawStruct.methods` 本身已经是该 struct 的 receiver 方法列表，不需要对 `pkg.structs` 做 flatMap 再 filter。这个写法是 O(n²) 的，而且 `m.receiverType` 存储的是 receiver **变量名**（如 `s`、`h`），不是类型名。用 `receiverType === struct.name` 过滤大概率全部 miss。

Plan 后面括号里说 "(or `struct.methods.length` if methods are already scoped to the struct)"——但代码示例仍然是错误的，会误导实现。

修正：直接写 `methodCount = struct.methods.length`，删除 flatMap 示例。

### 问题 5：`fanOut` 统计单位未定义——distinct targets vs edge count

Plan 定义 fanOut 为"node X has edges pointing to"的数量，但：

- 同一 struct 对同一 target 可能同时有 `implements` 和 `uses` 两条边
- 去重后两条边都在 edge list 里（key 不同：`implements:A:B` ≠ `uses:A:B`）
- 按 edge count 算 fanOut=2，按 distinct target 算 fanOut=1

这两种语义结果不同，且当前去重逻辑只去重完全相同的三元组，**不**去重 (source, target) 对。Plan 没有明确说明选哪种，实现者会做不同的选择。

修正：在 B-types 的验收标准里加一条：`fanOut = distinct target node count`（而非边数），并在测试用例中增加一个 struct 同时 implements 和 uses 同一 target 的场景来固化此语义。

### 问题 6：`concreteUsageRisks` 的跨包判断逻辑脆弱

Stage B-types 的实现说：

```typescript
edge.source.split('.')[0] !== edge.target.split('.')[0]  // 判断跨包
```

node ID 格式是 `"pkg/hub.Server"`（fullName + "." + typeName）。由于 Go 包路径不含 `.`，`split('.')[0]` 确实能得到 `"pkg/hub"`。这在当前代码中是成立的，但这个约定没有文档化，且依赖"Go 包路径不含点"这个隐含前提。

更健壮的写法：`node.package` 字段直接存储了 `pkg.fullName`，可以用 `edge.source` 查找对应 node 的 `package` 字段做比较，而不是字符串分割。`CapabilityGraph.nodes` 在 `build()` 方法里可以直接访问。

---

## Phase C — Goroutine Lifecycle

### 问题 7：`SpawnRelation.to` 不存储 spawn 目标函数名（核心架构错误）

Plan Stage C-1 的检测逻辑描述：

> "Extract function name from the spawn's SpawnRelation.to node (strip the package-prefixed spawner prefix to recover the method/function name component)"

`SpawnRelation.to` 的格式是 `"${pkg.fullName}.${parentName}.spawn-${lineNum}"`，例如：

```
"pkg/hub.Server.Start.spawn-88"
```

这个 ID 编码的是**创建 goroutine 的位置**（spawner + line），**不是 spawn 目标函数的名字**。`spawn-88` 只是行号，无法从中反推被 spawn 的函数名（`handleConn`）。`SpawnRelation` 接口本身也没有目标函数名字段：

```typescript
interface SpawnRelation {
  from: string;    // spawner function id
  to: string;      // spawned goroutine node id (spawn-N format, NOT target fn name)
  spawnType: 'go-func' | 'go-stmt';
}
```

**目标函数名只存在于原始 `GoSpawnStmt.call.functionName` 中**，在 `goroutine-topology-builder.ts` 构建 topology 时可访问，但构建完成后就丢失了。

这意味着 `buildLifecycle()` 不能以 `SpawnRelation[]` 为输入做事后 pass，**必须在 `build()` 方法内部、访问原始 `goSpawns` 数据时同步进行**。Plan 的设计需要调整：

```typescript
// 调整后的 buildLifecycle 签名：
private buildLifecycle(rawData: GoRawData): GoroutineLifecycleSummary[]
// 内部直接遍历 pkg → functions/methods → goSpawns → call.functionName
// 然后在 rawData 中查找该函数并检查其参数和 body
```

同时，lifecycle entry 的 `nodeId` 需要与 `GoroutineNode.id`（即 `spawn-N` 格式）对应，而函数查找用 `spawn.call.functionName`。这两个是不同的字符串，需要在构建过程中同时跟踪。

### 问题 8：`ctx.Done()` 检测用了错误的字段名

Plan Stage C-1 描述：

> "calls: look for `functionName === "Done"` with `receiverType` matching a context variable"

对于 `ctx.Done()`，tree-sitter-bridge 的 `extractCallExpr()` 解析 selector_expression：

- `operand = "ctx"` → `packageName = "ctx"`
- `field = "Done"` → `functionName = "Done"`
- `receiverType` 字段**不会被设置**（它用于带有类型断言的 receiver，不是普通变量方法调用）

所以判断条件应该是：`call.functionName === "Done" && call.packageName` 匹配某个 context 变量名，而不是 `receiverType`。

更可靠的检测：在函数参数列表中找到类型含 `context.Context` 的参数（获得变量名，如 `ctx`），然后在 body 的 calls 中查找 `{ functionName: "Done", packageName: ctx_varname }`。

### 问题 9：C-1 实现描述中 `buildLifecycle` 的参数 `nodes` 无用

Plan 的方法签名描述：

```typescript
private buildLifecycle(rawData, nodes, edges)
```

如问题 7 所述，lifecycle 检测需要 `rawData` 来查找函数定义，`nodes` 和 `edges` 在这里没有用处（nodes 存的是 goroutine spawn 位置，不是函数体）。`edges`（`SpawnRelation[]`）也无法提供目标函数名（问题 7）。

修正：方法签名应为 `buildLifecycle(rawData: GoRawData): GoroutineLifecycleSummary[]`。

---

## 横向问题

### 问题 10：`atlas-renderer.test.ts` 不在 files changed 列表中

`tests/plugins/golang/atlas/atlas-renderer.test.ts` 测试 `AtlasRenderer.render()` 的输出。Phase B 改变了 capability 图的节点标签格式和边样式，Phase C 改变了 goroutine 图的节点标签。如果 `atlas-renderer.test.ts` 中有对渲染输出做 snapshot 或字符串匹配的测试，它们会在 Phase B/C 之后失败。Plan 的文件列表完全没有提到这个文件。

检查方式：阅读 `atlas-renderer.test.ts`，确认现有测试对输出内容的断言是否会被新格式破坏。如有，需要加入 files changed 列表并更新断言。

### 问题 11：`completeness` 分数没有更新计划

`index.ts:200-204` 中 completeness 分数是硬编码的：

```typescript
completeness: {
  package: 1.0,
  capability: 0.85,
  goroutine: options.functionBodyStrategy === 'full' ? 0.7 : 0.5,
  flow: 0.6,
},
```

Phase B 丰富了 capability 层的数据（指标 + 类型信息），Phase C 新增了 goroutine 生命周期。这两个 phase 都没有计划更新这些分数。如果 completeness 分数有语义（消费方可能依赖这个判断数据质量），应该在各自 phase 的 acceptance criteria 中明确是否需要更新，以及更新为什么值。即使决定不更新，也应该明确说"completeness 分数维持原值，理由是..."。

---

## 修订要点摘要

| 问题 | Phase | 严重程度 | 修正动作 |
|------|-------|---------|---------|
| 1. `GoImport.location` 非 optional，fixture 必须提供 | A | 低（编译会报错，早发现） | 在 A-1 描述中补充 fixture 字段要求 |
| 2. stdlib/外部 import 的 fallthrough 路径未描述 | A | 低 | 补充说明 fallthrough 是预期行为 |
| 3. **`GO_ATLAS_EXTENSION_VERSION` 常量未被 `index.ts` 使用，版本升级静默失效** | B | 高 | `index.ts` 加入 files changed；改为引用常量 |
| 4. **`methodCount` 代码示例用了 `receiverType` 过滤，既 O(n²) 又语义错误** | B | 高 | 删除 flatMap 示例，改为 `struct.methods.length` |
| 5. `fanOut` 未定义 distinct target vs edge count | B | 中 | 在验收标准和测试用例中固化"distinct target"语义 |
| 6. 跨包判断用 `split('.')` 而非 `node.package` 字段 | B | 低 | 用 `node.package` 做比较 |
| 7. **`SpawnRelation.to` 不存储目标函数名，lifecycle pass 无法在事后做** | C | 高 | 重设计为在 `build()` 内遍历原始 `goSpawns` |
| 8. **`ctx.Done()` 检测用 `receiverType`，应为 `packageName`** | C | 高 | 修正字段名及检测逻辑 |
| 9. `buildLifecycle` 参数 `nodes` 和 `edges` 无用 | C | 中 | 简化签名为只接受 `rawData` |
| 10. `atlas-renderer.test.ts` 不在 files changed 但会受影响 | B + C | 中 | 加入列表，检查并更新现有断言 |
| 11. completeness 分数无更新计划 | B + C | 低 | 在验收标准中明确是否更新及理由 |
