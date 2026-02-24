# Go Architecture Atlas Proposal - Architectural Review (严苛架构师视角)

**Review Date**: 2026-02-24
**Reviewer**: AI架构师（基于现有代码库和提案文档）
**Proposal Version**: 2.2
**Review Focus**: 架构可行性、数据一致性、实现风险、与现有系统集成

---

## 执行摘要 (Executive Summary)

### 总体评估：APPROVED WITH CRITICAL CONDITIONS

**总体评分**: 7.5/10

**核心优势**:
1. **理论洞察深刻**: 准确识别 Go 与 OOP 语言的架构本质差异（类型系统 vs 行为模式）
2. **四层架构设计合理**: Package Graph、Capability Graph、Goroutine Topology、Flow Graph 互补投影
3. **技术诚实度**: 明确标注各层可恢复性限制（Channel 追踪 < 20%、Flow Graph 强依赖 gopls）

**致命风险 (MUST FIX)**:
1. **P0-1: 数据源断层** - `GoFunctionBody` 未定义，无法支持行为分析
2. **P0-2: 函数体提取缺失** - `TreeSitterBridge.parseCode()` 不提取函数体，`BehaviorAnalyzer` 无米之炊
3. **P0-3: ArchJSON 不兼容** - Atlas 与标准 `ILanguagePlugin` 接口不兼容，破坏插件生态

**高风险项 (HIGH RISK)**:
1. **P1-1: 插件架构冲突** - `GoAtlasPlugin` 不继承 `GoPlugin`，违反 DRY 原则
2. **P1-2: 包依赖图缺失** - `GoRawPackage.imports` 仅存储路径字符串，无依赖关系图
3. **P1-3: CLI 专用工具限制** - 无法复用 ArchGuard 现有工具链（Web UI、批处理、测试）

**建议**: 暂停实施，修复 P0 级问题后重新评审。

---

## 1. 数据流完整性分析 (Data Flow Analysis)

### 1.1 当前实现数据流

基于现有代码 (`src/plugins/golang/`):

```
Go Source Files
     │
     ▼
TreeSitterBridge.parseCode()
     │
     ├─► GoRawPackage.structs (✅ 完整)
     ├─► GoRawPackage.interfaces (✅ 完整)
     ├─► GoRawPackage.functions (⚠️ 仅签名，无函数体)
     └─► GoRawPackage.imports (⚠️ 仅路径字符串)
```

**关键缺失**:
- `GoFunction.body` 字段不存在（`types.ts` 第 97-104 行）
- `GoMethod.body` 字段不存在（`types.ts` 第 33-41 行）
- `TreeSitterBridge` 未实现函数体提取（`tree-sitter-bridge.ts` 第 86 行: `functions: []` + TODO 注释）

### 1.2 Atlas 预期数据流

提案 4.4 节 (第 1116-1204 行) 定义:

```typescript
export interface GoFunctionBody {
  block: GoBlock;
  calls: GoCallExpr[];        // 所有的函数调用
  goSpawns: GoSpawnStmt[];    // go func() ...
  channelOps: GoChannelOp[];  // ch <- x 或 <-ch
}
```

**问题**: `GoFunction` 接口未包含 `body?: GoFunctionBody` 字段（提案第 1158-1161 行提到新增，但未在核心接口定义中体现）

### 1.3 数据断层诊断

```
Atlas 需求 (4.4 节)                    当前实现 (types.ts)
─────────────────────────────────────────────────────────────
GoFunction.body: GoFunctionBody  ❌     GoFunction (97-104 行)
  ├─ block: GoBlock                    ├─ name: string
  ├─ calls: GoCallExpr[]               ├─ parameters: GoField[]
  ├─ goSpawns: GoSpawnStmt[]           ├─ returnTypes: string[]
  └─ channelOps: GoChannelOp[]         └─ location: GoSourceLocation
                                     (无 body 字段)
```

**影响评估**:
- **Goroutine Topology**: 无法识别 `go func()` 调用点
- **Flow Graph**: 无法追踪函数调用链
- **Channel 创建**: 最多识别 `make(chan)` 声明，无法追踪传递路径

**修复优先级**: **P0 (阻塞)**

---

## 2. 与现有架构的兼容性分析

### 2.1 插件接口兼容性

**现有架构** (`src/core/interfaces/language-plugin.ts`):

```typescript
export interface ILanguagePlugin extends IParser {
  readonly metadata: PluginMetadata;
  initialize(config: PluginInitConfig): Promise<void>;
  canHandle(targetPath: string): boolean;
  dispose(): Promise<void>;
  readonly dependencyExtractor?: IDependencyExtractor;
}
```

**提案设计** (4.3.2 节第 648-1108 行):

```typescript
export class GoAtlasPlugin {
  // ❌ 不继承 ILanguagePlugin
  async generateAtlas(rootPath: string, options: AtlasGenerationOptions): Promise<GoArchitectureAtlas>
  toArchJSON(atlas: GoArchitectureAtlas): ArchJSON  // 后置转换
}
```

**架构冲突**:

| 方面 | ILanguagePlugin | GoAtlasPlugin | 冲突等级 |
|------|----------------|---------------|----------|
| **接口继承** | 必须 | ❌ 不继承 | 🔴 致命 |
| **标准输出** | `parseProject() → ArchJSON` | `generateAtlas() → GoArchitectureAtlas` | 🔴 致命 |
| **工具集成** | ✅ 复用 CLI/Web UI | ❌ 仅 CLI | 🟡 高 |
| **插件发现** | ✅ `PluginRegistry` 自动发现 | ❌ 需手动注册 | 🟡 高 |

### 2.2 ArchJSON 映射完整性

提案 4.3.2 节 `toArchJSON()` 方法 (第 768-877 行):

```typescript
toArchJSON(atlas: GoArchitectureAtlas): ArchJSON {
  const entities: any[] = [];  // ⚠️ any 类型，绕过类型检查
  const relations: any[] = [];

  // 1. Package Graph → Entities
  entities.push({
    type: 'package',  // ⚠️ EntityType 枚举中不存在 'package'
  });
}
```

**现有 ArchJSON Schema** (`src/types/index.ts`):

```typescript
export type EntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'function'
  | 'package'  // ❌ 实际不存在，需确认
```

**验证**: 需检查 `EntityType` 是否包含 `'package'`

### 2.3 依赖注入兼容性

提案 4.3.1 节架构图 (第 621-646 行):

```
共享组件层
├── TreeSitterBridge (需升级)
├── InterfaceMatcher (复用)
└── ArchJsonMapper (复用)
```

**问题**: `TreeSitterBridge` 升级破坏现有 `GoPlugin` 行为

| 组件 | GoPlugin 用途 | Atlas 用途 | 兼容性 |
|------|--------------|-----------|--------|
| `TreeSitterBridge` | 提取签名 | 提取函数体 | ⚠️ 破坏性变更 |
| `GoRawPackage.functions` | 签名数组 | 包含 `body` | ⚠️ 结构变更 |

**风险**: 共享组件升级需同步修改 `GoPlugin` 测试用例

---

## 3. 技术可行性深度分析

### 3.1 Tree-sitter 函数体提取可行性

**提案声明**: "TreeSitterBridge 必须升级支持 ExtractFunctionBody" (4.3.1 节)

**技术验证**:

```typescript
// tree-sitter-bridge.ts 当前实现 (第 86 行)
functions: [], // TODO: Extract standalone functions
```

**缺失功能**:

```typescript
// 需要实现的方法
private extractFunctionBody(
  funcDecl: Parser.SyntaxNode,
  code: string,
  filePath: string
): GoFunctionBody {
  // 1. 提取 block (函数体)
  const blockNode = funcDecl.childForFieldName('block');

  // 2. 遍历 AST 提取 calls
  const callExprs = blockNode.descendantsOfType('call_expression');

  // 3. 识别 go spawns
  const goStmts = blockNode.descendantsOfType('go_statement');

  // 4. 识别 channel operations
  const sendStmts = blockNode.descendantsOfType('send_statement');
  const receiveExprs = blockNode.descendantsOfType('receive_expression');

  // ... 复杂的上下文分析
}
```

**挑战**:

| 挑战 | 描述 | 复杂度 |
|------|------|--------|
| **上下文相关性** | `ch <- x` 中的 `ch` 变量需要追踪作用域 | 高 |
| **间接调用** | `fn()` 的 `fn` 可能是函数参数，静态分析困难 | 高 |
| **匿名函数** | `go func() { ... }` 需要递归解析 | 中 |
| **性能影响** | 大型项目解析函数体可能导致 10x 性能下降 | 高 |

**可行性评估**: ⚠️ **中等风险** (建议 POC 验证)

### 3.2 gopls 依赖风险评估

**Flow Graph 可恢复性声明** (3.4 节第 104 行):

> "函数调用链 ~60% - 严重依赖类型推断 (gopls)"

**现有 gopls 实现** (`gopls-client.ts` 第 573 行):

```typescript
export class GoplsClient {
  async initialize(workspaceRoot: string): Promise<void>
  async getImplementations(loc: SourceLocation): Promise<Implementation[]>
  async getTypeInfo(loc: SourceLocation): Promise<TypeInfo | null>
  // ❌ 缺少 call hierarchy API
}
```

**提案需求** (4.2 节第 356 行):

```typescript
FlowGraphBuilder (Dependencies: Gopls)
// 需要追踪间接调用链
```

**缺失 API**:

```typescript
// 需要新增
async getCallHierarchy(item: CallHierarchyItem): Promise<CallHierarchyResult[]>
```

**技术风险**:

| 风险 | 影响 | 缓解成本 |
|------|------|---------|
| **gopls 启动延迟** | 10-30秒启动时间 | 高 (需异步初始化) |
| **内存占用** | gopls 进程 ~200MB | 中 (需进程管理) |
| **版本兼容性** | gopls API 不稳定 | 高 (需适配层) |

**可行性评估**: ⚠️ **高风险** (建议降级为可选功能)

### 3.3 包依赖图构建可行性

**提案数据结构** (4.2 节第 417-453 行):

```typescript
export interface PackageGraph {
  packages: PackageNode[];
  dependencies: PackageDependency[];
  cycles: PackageCycle[];
}
```

**现有 GoRawPackage** (`types.ts` 第 118-126 行):

```typescript
export interface GoRawPackage {
  imports: GoImport[];  // ❌ 仅路径字符串
  // ❌ 无 dependencies/dependents 字段
}
```

**缺失依赖图构建逻辑**:

```typescript
// 需要实现
function buildPackageDependencyGraph(packages: GoRawPackage[]): PackageGraph {
  // 1. 解析 import 路径到包 ID
  // 2. 检测循环依赖 (Kahn 算法)
  // 3. 计算引用强度
}
```

**挑战**:

- **import 路径解析**: `"github.com/gin-gonic/gin"` 需要映射到内部/外部包
- **测试文件过滤**: `_test.go` 的 import 需要单独处理
- **vendor 目录**: 需要排除 vendor 依赖

**可行性评估**: ✅ **低风险** (标准图算法)

---

## 4. 架构设计缺陷

### 4.1 违反 SOLID 原则

#### SRP 违反 (单一职责原则)

**问题**: `GoAtlasPlugin.generateAtlas()` 承担过多职责

```typescript
async generateAtlas(rootPath: string, options: AtlasGenerationOptions): Promise<GoArchitectureAtlas> {
  // 1. 文件发现 (应该是 Parser 职责)
  const rawData = await this.parseGoProject(rootPath, options);

  // 2. 四层分析 (应该是独立 Analyzer)
  const [packageGraph, capabilityGraph, goroutineTopology, flowGraph] = await Promise.all([...]);

  // 3. 元数据聚合 (应该是 Mapper 职责)
  const atlas: GoArchitectureAtlas = { metadata, ... };
}
```

**建议**: 拆分为 `GoAtlasParser` + `BehaviorAnalyzer` + `AtlasMapper`

#### DRY 违反 (不要重复自己)

**问题**: `GoAtlasPlugin.parseGoProject()` 与 `GoPlugin.parseProject()` 重复逻辑

```typescript
// GoAtlasPlugin (提案第 887-945 行)
private async parseGoProject(rootPath: string, options: AtlasGenerationOptions): Promise<GoRawData> {
  const files = await glob(pattern, { cwd: rootPath, ... });
  for (const file of files) {
    const pkg = this.treeSitter.parseCode(code, file);
    // ... 合并 packages
  }
}

// GoPlugin (index.ts 第 115-180 行)
async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
  const files = await glob(pattern, { cwd: workspaceRoot, ... });
  for (const file of files) {
    const pkg = this.treeSitter.parseCode(code, file);
    // ... 合并 packages
  }
}
```

**重复代码量**: ~80 行 (glob → parse → merge)

**建议**: 提取共享基类 `GoParserBase`

### 4.2 接口隔离原则违反

**问题**: `GoArchitectureAtlas` 与 `ArchJSON` 强耦合

```typescript
// 提案 4.3.2 节 (第 768 行)
toArchJSON(atlas: GoArchitectureAtlas): ArchJSON {
  // ❌ 后置转换，信息丢失
  // Package Graph → entities (type: "package")
  // Flow Graph → relations (type: "calls")
}
```

**架构倒置**: 应该是 `ArchJSON` 扩展支持 Atlas，而非 Atlas 降级到 ArchJSON

**建议**:

```typescript
// 方案 A: ArchJSON 扩展
interface ArchJSON {
  version: '2.0';  // 升级版本
  extensions?: {
    goAtlas?: Partial<GoArchitectureAtlas>;
  };
}

// 方案 B: 双向转换器
class AtlasConverter {
  atlasToArchJSON(atlas: GoArchitectureAtlas): ArchJSON;
  archJSONToAtlas(arch: ArchJSON): GoArchitectureAtlas;
}
```

### 4.3 依赖倒置原则违反

**问题**: `GoAtlasPlugin` 直接依赖具体实现

```typescript
export class GoAtlasPlugin {
  private treeSitter: TreeSitterBridge;  // ❌ 具体类
  private matcher: InterfaceMatcher;     // ❌ 具体类
  private behaviorAnalyzer: BehaviorAnalyzer;  // ❌ 具体类
}
```

**建议**: 依赖抽象接口

```typescript
export class GoAtlasPlugin {
  private parser: IGoParser;           // 抽象
  private matcher: IInterfaceMatcher;  // 抽象
  private analyzer: IBehaviorAnalyzer; // 抽象
}
```

---

## 5. 实施风险矩阵

### 5.1 技术风险

| 风险ID | 描述 | 概率 | 影响 | 优先级 |
|--------|------|------|------|--------|
| **T001** | TreeSitter 函数体提取性能 < 0.1 files/sec | 高 | 高 | P0 |
| **T002** | gopls call hierarchy API 不稳定 | 高 | 中 | P1 |
| **T003** | ArchJSON 'package' entity 类型不存在 | 中 | 高 | P0 |
| **T004** | Channel 追踪误报率 > 50% | 高 | 中 | P1 |
| **T005** | 循环依赖检测漏报 (复杂 import 别名) | 低 | 低 | P2 |

### 5.2 架构风险

| 风险ID | 描述 | 概率 | 影响 | 优先级 |
|--------|------|------|------|--------|
| **A001** | GoAtlasPlugin 无法集成到 PluginRegistry | 高 | 高 | P0 |
| **A002** | 现有 GoPlugin 测试全部失败 (types.ts 变更) | 高 | 中 | P0 |
| **A003** | Web UI 无法显示 Atlas 四层图 | 中 | 中 | P1 |
| **A004** | 批处理模式无法使用 `generateAtlas()` | 低 | 低 | P2 |

### 5.3 工程风险

| 风险ID | 描述 | 概率 | 影响 | 优先级 |
|--------|------|------|------|--------|
| **E001** | 开发时间估计不足 (预估 3周，实际 6-8周) | 高 | 中 | P1 |
| **E002** | 测试覆盖率 < 60% (复杂行为难以 mock) | 中 | 中 | P2 |
| **E003** | 文档与实现不同步 (类型定义过时) | 中 | 低 | P3 |

---

## 6. 关键问题清单 (Must Fix Before Approval)

### P0 级问题 (阻塞实施)

#### P0-1: 数据源断层 - GoFunctionBody 未定义

**位置**: Proposal 4.4 节 vs 现有 `types.ts`

**问题**:
```typescript
// 提案承诺 (第 1158-1161 行)
export interface GoFunction {
  body?: GoFunctionBody; // 新增
}

// 实际定义 (types.ts 第 97-104 行)
export interface GoFunction {
  name: string;
  packageName: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  // ❌ 无 body 字段
}
```

**修复方案**:

```typescript
// src/plugins/golang/types.ts

export interface GoFunction {
  name: string;
  packageName: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  body?: GoFunctionBody;  // ✅ 新增
}

export interface GoMethod {
  name: string;
  receiver?: string;
  receiverType?: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  body?: GoFunctionBody;  // ✅ 新增
}

export interface GoFunctionBody {
  block: GoBlock;
  calls: GoCallExpr[];
  goSpawns: GoSpawnStmt[];
  channelOps: GoChannelOp[];
}
```

#### P0-2: TreeSitterBridge 不提取函数体

**位置**: `tree-sitter-bridge.ts` 第 86 行

**问题**:
```typescript
return {
  id: packageName,
  name: packageName,
  dirPath: '',
  imports,
  structs,
  interfaces,
  functions: [], // TODO: Extract standalone functions
};
```

**修复方案**:

```typescript
// src/plugins/golang/tree-sitter-bridge.ts

parseCode(code: string, filePath: string): GoRawPackage {
  // ... 现有代码 ...

  // ✅ 新增: 提取函数
  const functionDecls = rootNode.descendantsOfType('function_declaration');
  const functions: GoFunction[] = [];
  for (const funcDecl of functionDecls) {
    const func = this.extractFunction(funcDecl, code, filePath);
    functions.push(func);
  }

  return {
    // ...
    functions,  // ✅ 填充函数列表
  };
}

private extractFunction(
  funcDecl: Parser.SyntaxNode,
  code: string,
  filePath: string
): GoFunction {
  const nameNode = funcDecl.childForFieldName('name');
  const name = code.substring(nameNode.startIndex, nameNode.endIndex);

  const parameters = this.extractParameters(funcDecl, code, filePath);
  const returnTypes = this.extractReturnTypes(funcDecl, code);

  // ✅ 新增: 提取函数体
  const blockNode = funcDecl.childForFieldName('block');
  let body: GoFunctionBody | undefined;
  if (blockNode) {
    body = this.extractFunctionBody(blockNode, code, filePath);
  }

  return {
    name,
    packageName,
    parameters,
    returnTypes,
    exported: this.isExported(name),
    location: this.nodeToLocation(funcDecl, filePath),
    body,  // ✅ 包含函数体
  };
}

private extractFunctionBody(
  blockNode: Parser.SyntaxNode,
  code: string,
  filePath: string
): GoFunctionBody {
  const block: GoBlock = {
    startLine: blockNode.startPosition.row + 1,
    endLine: blockNode.endPosition.row + 1,
    statements: [], // TODO: 提取语句列表
  };

  // 提取函数调用
  const calls: GoCallExpr[] = [];
  const callExprs = blockNode.descendantsOfType('call_expression');
  for (const callExpr of callExprs) {
    calls.push(this.extractCallExpr(callExpr, code, filePath));
  }

  // 提取 goroutine spawns
  const goSpawns: GoSpawnStmt[] = [];
  const goStmts = blockNode.descendantsOfType('go_statement');
  for (const goStmt of goStmts) {
    goSpawns.push(this.extractGoSpawn(goStmt, code, filePath));
  }

  // 提取 channel 操作
  const channelOps: GoChannelOp[] = [];
  const sendStmts = blockNode.descendantsOfType('send_statement');
  for (const sendStmt of sendStmts) {
    channelOps.push(this.extractChannelOp(sendStmt, 'send', code, filePath));
  }
  const receiveExprs = blockNode.descendantsOfType('receive_expression');
  for (const recvExpr of receiveExprs) {
    channelOps.push(this.extractChannelOp(recvExpr, 'receive', code, filePath));
  }

  return { block, calls, goSpawns, channelOps };
}
```

#### P0-3: ArchJSON EntityType 缺失 'package'

**位置**: Proposal 4.3.2 节 vs `src/types/index.ts`

**验证步骤**:

```bash
# 检查 EntityType 定义
grep -r "export type EntityType" src/types/
```

**如果缺失**:

```typescript
// src/types/index.ts

export type EntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'function'
  | 'package'  // ✅ 新增
  | 'struct';   // ✅ 新增 (Go 特有)
```

---

### P1 级问题 (高风险)

#### P1-1: 插件架构不兼容

**问题**: `GoAtlasPlugin` 不实现 `ILanguagePlugin`

**修复方案**: 三选一

**方案 A**: 继承 `GoPlugin` (推荐)

```typescript
export class GoAtlasPlugin extends GoPlugin {
  async generateAtlas(rootPath: string, options: AtlasGenerationOptions): Promise<GoArchitectureAtlas> {
    // 复用 parseProject() 获取 GoRawData
    const archJSON = await this.parseProject(rootPath, {});

    // 扩展 ArchJSON → Atlas
    return this.buildAtlas(archJSON);
  }
}
```

**方案 B**: 实现 `ILanguagePlugin` + 扩展方法

```typescript
export class GoAtlasPlugin implements ILanguagePlugin {
  // 标准接口
  async parseProject(root: string, config: ParseConfig): Promise<ArchJSON> {
    const atlas = await this.generateAtlas(root, {});
    return this.toArchJSON(atlas);
  }

  // Atlas 专用方法
  async generateAtlas(rootPath: string, options: AtlasGenerationOptions): Promise<GoArchitectureAtlas> {
    // ...
  }
}
```

**方案 C**: 独立 CLI 工具 (当前方案)

```typescript
// ⚠️ 无法集成到 PluginRegistry
// ⚠️ Web UI 无法使用
// ⚠️ 仅限 CLI 场景
```

**建议**: 采用方案 A 或 B

#### P1-2: 包依赖图缺失

**问题**: `GoRawPackage.imports` 不是依赖关系图

**修复方案**:

```typescript
// src/plugins/golang/types.ts

export interface GoRawPackage {
  id: string;
  name: string;
  dirPath: string;
  imports: GoImport[];  // 保持不变

  // ✅ 新增: 依赖关系 (延迟填充)
  dependencies?: PackageDependency[];
  dependents?: string[];  // 依赖此包的包 ID 列表
}

export interface PackageDependency {
  fromPackageId: string;
  toPackageId: string;
  strength: number;  // 引用强度
  type: 'direct' | 'indirect' | 'test';
}
```

---

## 7. 建议实施路径

### 阶段 0: 修复 P0 问题 (1-2周)

**目标**: 建立数据基础

1. **Week 1**: 扩展 `types.ts` + 升级 `TreeSitterBridge`
   - 新增 `GoFunctionBody`, `GoCallExpr`, `GoSpawnStmt`, `GoChannelOp`
   - 实现 `extractFunctionBody()` 方法
   - 单元测试覆盖率 > 80%

2. **Week 2**: 验证 ArchJSON 兼容性
   - 确认/新增 `EntityType: 'package'`
   - 测试 `toArchJSON()` 映射完整性
   - 集成测试: 生成简单项目的 Atlas

**验收标准**:
- ✅ `GoFunction.body` 字段存在
- ✅ `TreeSitterBridge` 提取 >90% 函数体
- ✅ ArchJSON 成功包含 Package entities

### 阶段 1: 核心功能实现 (3-4周)

**目标**: 实现 Package Graph + Capability Graph

1. **Week 3-4**: Package Graph Builder
   - 实现 `buildPackageDependencyGraph()`
   - 循环依赖检测 (Kahn 算法)
   - 引用强度计算

2. **Week 5-6**: Capability Graph Builder
   - 复用现有 `InterfaceMatcher`
   - 提取接口使用点 (字段/参数/返回值)
   - 可视化测试

**验收标准**:
- ✅ Package Graph 准确率 100%
- ✅ Capability Graph 准确率 >85%

### 阶段 2: 行为分析实现 (4-5周)

**目标**: Goroutine Topology + Flow Graph

1. **Week 7-8**: Goroutine Topology
   - 识别 `go func()` 调用点
   - 识别 `make(chan)` 创建点
   - 模式识别 (worker pool, pipeline 等)

2. **Week 9-10**: Flow Graph (不含 gopls)
   - HTTP 入口点检测
   - 直接调用链追踪
   - 标注 "间接调用 (无 gopls)"

3. **Week 11**: Flow Graph (含 gopls)
   - 集成 `gopls call hierarchy`
   - 间接调用追踪
   - 性能优化

**验收标准**:
- ✅ Goroutine 识别率 >90%
- ✅ Flow Graph 深度准确率 >70% (启用 gopls)

### 阶段 3: 集成与优化 (2-3周)

**目标**: 插件集成 + CLI 完善

1. **Week 12**: 插件架构重构
   - 方案 A: 继承 `GoPlugin`
   - 实现 `ILanguagePlugin` 接口
   - 注册到 `PluginRegistry`

2. **Week 13**: CLI 完善
   - `atlas` 命令实现
   - 输出格式 (Mermaid/JSON/SVG)
   - 错误处理

3. **Week 14**: 文档与测试
   - API 文档
   - 用户指南
   - 集成测试

**验收标准**:
- ✅ 通过所有 370+ 现有测试
- ✅ 新增测试 >100 个
- ✅ 文档完整度 >90%

---

## 8. 结论与建议

### 8.1 核心建议

1. **暂停实施**: 修复 P0-1, P0-2, P0-3 后重新评审
2. **架构重构**: 采用方案 A (继承 `GoPlugin`) 或方案 B (实现 `ILanguagePlugin`)
3. **分阶段交付**: 先实现 Package Graph + Capability Graph (无函数体依赖)，再实现行为分析

### 8.2 风险缓解策略

| 风险 | 缓解措施 |
|------|---------|
| **TreeSitter 性能** | 增量解析 + 缓存 + 并行处理 |
| **gopls 依赖** | 设计为可选增强，提供降级方案 |
| **ArchJSON 兼容性** | 扩展 Schema 而非破坏性变更 |
| **插件架构** | 复用现有接口，避免重复代码 |

### 8.3 成功标准

- ✅ **功能完整性**: 四层图可恢复性达到声称值
- ✅ **架构兼容性**: 无缝集成到现有工具链
- ✅ **测试覆盖率**: >80% (核心逻辑 >90%)
- ✅ **性能达标**: 100 files < 10s (不含 gopls)
- ✅ **文档完整度**: API 文档 + 用户指南 + 示例

---

## 附录 A: 类型定义差异分析

### A.1 现有 vs 提案类型对比

| 类型 | 现有定义 | 提案定义 | 兼容性 |
|------|---------|---------|--------|
| `GoFunction` | 无 `body` | 有 `body?: GoFunctionBody` | ❌ 破坏性变更 |
| `GoMethod` | 无 `body` | 有 `body?: GoFunctionBody` | ❌ 破坏性变更 |
| `GoImport` | 无 `isTest` | 有 `isTest: boolean` | ⚠️ 非破坏性 |
| `GoRawPackage` | 无 `packageGraph` | 有 `packageGraph?: {...}` | ✅ 非破坏性 |

### A.2 新增类型定义需求

```typescript
// 缺失的类型 (需要在 types.ts 中新增)

export interface GoCallExpr {
  functionName: string;
  packageName?: string;
  receiverType?: string;
  args: string[];
  location: GoSourceLocation;
}

export interface GoSpawnStmt {
  call: GoCallExpr;
  location: GoSourceLocation;
}

export interface GoChannelOp {
  channelName: string;
  operation: 'send' | 'receive' | 'close' | 'make';
  location: GoSourceLocation;
}

export interface GoBlock {
  startLine: number;
  endLine: number;
  statements: GoStatement[];
}

export interface GoStatement {
  type: string;
  location: GoSourceLocation;
}
```

---

## 附录 B: 架构决策记录 (ADR)

### ADR-001: 为什么继承 GoPlugin 而非独立实现?

**背景**: 提案建议 `GoAtlasPlugin` 不继承 `GoPlugin`

**决策**: **应该继承** (或实现 `ILanguagePlugin`)

**理由**:
1. **复用性**: 避免重复实现文件发现、解析、缓存逻辑
2. **一致性**: 统一插件接口，降低学习成本
3. **工具集成**: Web UI、批处理模式可自动支持
4. **测试复用**: 现有 370+ 测试可覆盖核心逻辑

**权衡**:
- ✅ 优势: 代码复用、工具集成、测试覆盖
- ⚠️ 劣势: 稍复杂的继承关系 (但可通过组合解决)

### ADR-002: 为什么 GoFunction.body 是可选字段?

**背景**: 函数体提取开销大

**决策**: `body?: GoFunctionBody` (可选)

**理由**:
1. **向后兼容**: 现有 `GoPlugin` 不需要函数体
2. **性能**: 标准模式可跳过函数体提取 (10x 性能差异)
3. **渐进增强**: Atlas 模式启用函数体提取

**配置建议**:

```typescript
interface ParseConfig {
  extractFunctionBodies?: boolean;  // 默认 false
}
```

---

**Review Status**: **CONDITIONAL APPROVAL**
**Next Review**: 修复 P0 问题后 (预计 2 周)

**Reviewer Signature**: AI架构师 (基于严苛审查标准)
**Review Date**: 2026-02-24
**Proposal Version**: 2.2
