# Plan 06: Package-Level Metrics — `getPackageStats()` + `archguard_get_package_stats`

## Overview

本计划落实 [proposal-package-stats-mcp-tool.md](../proposals/proposal-package-stats-mcp-tool.md) 中的全部变更，分两个阶段实施：

1. **QueryEngine 扩展** — 三条数据路径的 `getPackageStats()`，类型定义，`getSummary().topPackages`
2. **新 MCP 工具** — `archguard_get_package_stats`（排序、过滤、topN）

阶段 1 是阶段 2 的前置依赖（新工具通过 `engine.getPackageStats()` 访问数据）。

实施遵循 TDD：每个阶段先补充失败测试，再修改实现直到测试通过。

前置条件：`proposal-multi-paradigm-mcp-tools.md`（Plan 05）已合并，`QueryEngine.getAtlasLayer()` 已可用。

---

## Test Fixtures

以下 fixture 在两个阶段的测试中共用。

### Fixture A — Go Atlas ArchJSON（含 PackageNode.stats 和 class-level entities）

> **与现有 `goAtlasArchJson` fixture 的区别**：`query-engine.test.ts` 中已有 `goAtlasArchJson`，但其 `entities: []`（无 Go struct 实体）。新 fixture 需要有 entities 才能测试 `aggregateEntityMetrics()` 的 methodCount/fieldCount 推导。在 Stage 1 中**新建独立 fixture 变量**（如 `goAtlasWithEntitiesArchJson`），不修改已有的 `goAtlasArchJson`。

```typescript
// 模拟一个有两个 internal 包 + 一个 tests 包的 Go 项目
const goAtlasArchJson: ArchJSON = {
  version: '1.0',
  language: 'go',
  timestamp: '2026-01-01T00:00:00Z',
  sourceFiles: ['internal/query/engine.go', 'internal/query/index.go', 'cmd/main.go'],
  entities: [
    {
      id: 'internal/query/engine.go.QueryEngine',
      name: 'QueryEngine',
      type: 'struct',
      visibility: 'public',
      members: [
        { name: 'Find',    type: 'method',   visibility: 'public'  },
        { name: 'GetDeps', type: 'method',   visibility: 'public'  },
        { name: 'index',   type: 'field',    visibility: 'private' },
      ],
      sourceLocation: { file: 'internal/query/engine.go', startLine: 10, endLine: 80 },
    },
    {
      id: 'internal/query/index.go.ArchIndex',
      name: 'ArchIndex',
      type: 'interface',
      visibility: 'public',
      members: [
        { name: 'Build', type: 'method', visibility: 'public' },
      ],
      sourceLocation: { file: 'internal/query/index.go', startLine: 5, endLine: 20 },
    },
    {
      id: 'cmd/main.go.Server',
      name: 'Server',
      type: 'struct',
      visibility: 'public',
      members: [
        { name: 'Run',  type: 'method', visibility: 'public'  },
        { name: 'port', type: 'field',  visibility: 'private' },
      ],
      sourceLocation: { file: 'cmd/main.go', startLine: 8, endLine: 50 },
    },
  ],
  relations: [],
  extensions: {
    goAtlas: {
      version: '2.0',
      layers: {
        package: {
          nodes: [
            {
              id: 'github.com/example/app/internal/query',
              name: 'internal/query',
              type: 'internal',
              fileCount: 2,
              stats: { structs: 1, interfaces: 1, functions: 3 },
            },
            {
              id: 'github.com/example/app/cmd',
              name: 'cmd',
              type: 'cmd',
              fileCount: 1,
              stats: { structs: 1, interfaces: 0, functions: 1 },
            },
            {
              id: 'github.com/example/app/internal/query_test',
              name: 'internal/query_test',
              type: 'tests',
              fileCount: 3,
            },
          ],
          edges: [
            {
              from: 'github.com/example/app/cmd',
              to: 'github.com/example/app/internal/query',
              strength: 5,
            },
          ],
          cycles: [],
        },
      },
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          detectedFrameworks: [],
          followIndirectCalls: false,
          goplsEnabled: false,
        },
        completeness: { package: 1.0, capability: 0, goroutine: 0, flow: 0 },
        performance: { fileCount: 3, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
      },
    },
  },
};
```

**重要说明**：
- `cmd` 包的 `type: 'cmd'`，不是 `'internal'`。Go Atlas path 需要同时保留 `'internal'` 和 `'cmd'` 类型的节点，过滤掉 `'tests'`、`'external'`、`'vendor'`、`'std'`、`'examples'`、`'testutil'`。
- entity 的 `sourceLocation.file` 使用短路径（不含 workspaceRoot 前缀）。
- `aggregateEntityMetrics('internal/query')` 应匹配 `internal/query/engine.go` 和 `internal/query/index.go`，但不能匹配 `internal/query_test/`（需要 `startsWith('internal/query/')` 而非 `startsWith('internal/query')`）。

---

### Fixture B — TypeScript ArchJSON（含 tsAnalysis.moduleGraph）

```typescript
const tsArchJson: ArchJSON = {
  version: '1.0',
  language: 'typescript',
  timestamp: '2026-01-01T00:00:00Z',
  // sourceFiles must be populated: TypeScript Path B uses archJson.sourceFiles (not fileToIds)
  // to enumerate all files including test files that have no entities.
  sourceFiles: [
    'src/cli/engine.ts',
    'src/cli/loader.ts',
    'src/cli/engine.test.ts',   // ← has no entities; absent from fileToIds; present in sourceFiles
    'src/parser/index.ts',
  ],
  entities: [
    {
      id: 'src/cli/engine.ts.QueryEngine',
      name: 'QueryEngine',
      type: 'class',
      visibility: 'public',
      members: [
        { name: 'find',    type: 'method',   visibility: 'public'  },
        { name: 'index',   type: 'property', visibility: 'private' },
        { name: 'load',    type: 'method',   visibility: 'private' },
      ],
      sourceLocation: { file: 'src/cli/engine.ts', startLine: 5, endLine: 120 },
    },
    {
      id: 'src/cli/loader.ts.EngineLoader',
      name: 'EngineLoader',
      type: 'class',
      visibility: 'public',
      members: [
        { name: 'load', type: 'method', visibility: 'public' },
      ],
      sourceLocation: { file: 'src/cli/loader.ts', startLine: 3, endLine: 40 },
    },
    {
      id: 'src/parser/index.ts.Parser',
      name: 'Parser',
      type: 'interface',
      visibility: 'public',
      members: [
        { name: 'parse', type: 'method', visibility: 'public' },
      ],
      sourceLocation: { file: 'src/parser/index.ts', startLine: 1, endLine: 15 },
    },
  ],
  relations: [],
  extensions: {
    tsAnalysis: {
      version: '1.0',
      moduleGraph: {
        nodes: [
          {
            id: 'src/cli',
            name: 'src/cli',
            type: 'internal',
            fileCount: 3,  // engine.ts + loader.ts + engine.test.ts (all files, not just entity files)
            stats: { classes: 2, interfaces: 0, functions: 0, enums: 0 },
          },
          {
            id: 'src/parser',
            name: 'src/parser',
            type: 'internal',
            fileCount: 1,
            stats: { classes: 0, interfaces: 1, functions: 0, enums: 0 },
          },
        ],
        edges: [
          { from: 'src/cli', to: 'src/parser', strength: 2, importedNames: ['Parser'] },
        ],
        cycles: [],
      },
    },
  },
};
```

**重要说明**：
- `TsModuleNode.id` 与 `TsModuleNode.name` 相同，均为文件目录的相对路径（`path.dirname(relFilePath)`）。
- **`fileToIds` 不含 `src/cli/engine.test.ts`**：该文件在 fixture 中无 entity 定义，因此 `buildArchIndex` 不会将其加入 `fileToIds`。`testFileCount` 的正确来源是 `archJson.sourceFiles`（而非 `fileToIds`），这正是 Path B 实现使用 `this.archJson.sourceFiles` 的原因。
- `TsModuleNode.stats.classes: 2` 指 `QueryEngine` 和 `EngineLoader`，与 `fileToIds` 中 `src/cli` 目录下的实体一致。

---

### Fixture C — OO Fallback ArchJSON（Java，无 extensions）

```typescript
const javaArchJson: ArchJSON = {
  version: '1.0',
  language: 'java',
  timestamp: '2026-01-01T00:00:00Z',
  sourceFiles: [],
  entities: [
    {
      id: 'com/example/service/OrderService.java.OrderService',
      name: 'OrderService',
      type: 'class',
      visibility: 'public',
      members: [
        { name: 'create',  type: 'method',   visibility: 'public'  },
        { name: 'delete',  type: 'method',   visibility: 'public'  },
        { name: 'orderId', type: 'field',    visibility: 'private' },
      ],
      sourceLocation: {
        file: 'com/example/service/OrderService.java',
        startLine: 5,
        endLine: 200,
      },
    },
    {
      id: 'com/example/service/UserService.java.UserService',
      name: 'UserService',
      type: 'class',
      visibility: 'public',
      members: [
        { name: 'find',   type: 'method', visibility: 'public'  },
        { name: 'userId', type: 'field',  visibility: 'private' },
      ],
      sourceLocation: {
        file: 'com/example/service/UserService.java',
        startLine: 3,
        endLine: 150,
      },
    },
    {
      id: 'com/example/service/OrderServiceTest.java.OrderServiceTest',
      name: 'OrderServiceTest',
      type: 'class',
      visibility: 'public',
      members: [
        { name: 'testCreate', type: 'method', visibility: 'public' },
      ],
      sourceLocation: {
        file: 'com/example/service/OrderServiceTest.java',
        startLine: 1,
        endLine: 60,
      },
    },
    {
      id: 'com/example/model/Order.java.Order',
      name: 'Order',
      type: 'class',
      visibility: 'public',
      members: [
        { name: 'id',    type: 'field', visibility: 'private' },
        { name: 'total', type: 'field', visibility: 'private' },
      ],
      sourceLocation: {
        file: 'com/example/model/Order.java',
        startLine: 1,
        endLine: 80,
      },
    },
  ],
  relations: [],
};
```

**重要说明**：
- `depth=2` 时：`com/example/service/OrderService.java` → 取前两个目录部分 → `com/example`。但这会把 `service` 和 `model` 都归入 `com/example`，失去区分度。
- `depth=3` 时：`com/example/service/OrderService.java` → `com/example/service`；`com/example/model/Order.java` → `com/example/model`。这是 Java 项目的正确默认值。
- **设计分歧**：proposal 的默认 `depth=2` 对 TypeScript（`src/cli`）合适，但对 Java（`com/example/service`）需要 `depth=3`。测试应覆盖不同 `depth` 值的场景，并在文档中说明 Java 用户通常需要 `depth=3`。
- `OrderServiceTest.java` 应被 `buildTestPattern()` 识别（`Test\.java$`）。
- `loc` 计算：`com/example/service` 有三个文件，`max(endLine)` 分别为 200、150、60，故 `loc = 200 + 150 + 60 = 410`。

---

## Phases

### Phase 1: QueryEngine 扩展

#### Objectives

- 新增 `PackageStatEntry`、`PackageStatMeta`、`PackageStatsResult` 类型
- 实现三条数据路径的 `getPackageStats(depth?, topN?)`
- 新增私有辅助方法 `aggregateEntityMetrics()` 和 `buildTestPattern()`
- 扩展 `getSummary()` 增加 `topPackages` 字段

#### Stages

---

##### Stage 1 — 补充失败测试（`query-engine.test.ts`）

修改 `tests/unit/cli/query/query-engine.test.ts`，新增以下测试组（实现前全部失败）：

**测试组 A：Go Atlas 路径**

使用 Fixture A 构建 engine：

- `getPackageStats()` 返回长度为 2 的数组（`internal/query` 和 `cmd`，过滤掉 `tests` 节点）
- 第一个 entry（按 `fileCount` DESC 排序）：`{ package: 'internal/query', fileCount: 2 }`
- `internal/query` entry 的 `methodCount: 3`（`QueryEngine.Find` + `QueryEngine.GetDeps` + `ArchIndex.Build`），`fieldCount: 1`（`QueryEngine.index`）
- `internal/query` entry 有 `languageStats: { structs: 1, interfaces: 1, functions: 3 }`
- `internal/query` entry 无 `loc` 字段（`loc === undefined`）
- `cmd` entry 的 `methodCount: 1`（`Server.Run`），`fieldCount: 1`（`Server.port`）
- `meta.dataPath === 'go-atlas'`，`meta.locAvailable === false`
- `getPackageStats(2, 1)` 返回长度为 1 的数组

**测试组 B：TypeScript 路径**

使用 Fixture B 构建 engine：

- `getPackageStats()` 返回长度为 2 的数组（`src/cli` 和 `src/parser`）
- `src/cli` entry：`fileCount: 3`（来自 `TsModuleNode.fileCount`，含 test 文件）
- `src/cli` entry：`testFileCount: 1`（`engine.test.ts` 匹配 `testPattern`）
  - **此断言之所以通过**：实现使用 `archJson.sourceFiles` 而非 `fileToIds` 构建 `moduleFiles`，因此 `engine.test.ts`（无 entity，不在 `fileToIds` 中）仍被正确识别
- `src/cli` entry：`entityCount: 2`，`methodCount: 3`（`find` + `load` + `EngineLoader.load`），`fieldCount: 1`（`index`）
- `src/cli` entry 有 `languageStats: { classes: 2, interfaces: 0, functions: 0, enums: 0 }`
- `src/cli` entry 无 `loc` 字段（`loc === undefined`）
- `meta.dataPath === 'ts-module-graph'`，`meta.locAvailable === false`

**测试组 C：OO Fallback 路径（Java）**

使用 Fixture C 构建 engine：

- `getPackageStats(3)` 返回长度为 2 的数组（`com/example/service` 和 `com/example/model`）
- `com/example/service` entry：`fileCount: 3`，`testFileCount: 1`，`entityCount: 3`，`methodCount: 5`，`fieldCount: 2`，`loc: 410`
- `com/example/model` entry：`fileCount: 1`，`testFileCount: 0`，`entityCount: 1`，`fieldCount: 2`，`loc: 80`
- `meta.dataPath === 'oo-derived'`，`meta.locAvailable === true`，`meta.locBasis === 'maxEndLine'`
- `getPackageStats(3, 1)` 返回长度为 1 的数组（loc 最大的先返回）
- `getPackageStats(2)` 将 `service` 和 `model` 合并为 `com/example`（depth=2 的行为；结果为 1 个 entry）

**测试组 D：`getSummary().topPackages`**

- Go Atlas engine：`getSummary().topPackages` 长度 ≤ 10，第一个 entry 为 `fileCount` 最大的包，无 `loc` 字段
- TypeScript engine：`getSummary().topPackages` 长度 ≤ 10，有 `fileCount` 和 `languageStats`
- Java engine（depth=3，entry 超过 10 个时才测试 topN=10 截断；用更大的 fixture 或验证 ≤ 10）

Acceptance criteria：所有新测试在 Stage 2 实现前失败（type error 或 runtime error 均可）。

Dependencies：无。

---

##### Stage 2 — 实现类型定义和新增 import

在 `src/cli/query/query-engine.ts` 中：

**1. 新增 imports**（在现有 imports 之后，注意导入路径）：

```typescript
import path from 'path';
// TsModuleGraph is NOT re-exported from @/types/index.js — import directly from extensions
import type { GoAtlasLayers, TsModuleGraph } from '@/types/extensions.js';
```

`path` 用于 TypeScript 路径的 `path.isAbsolute` / `path.relative` 规范化。`TsModuleGraph` 仅作类型引用；实际值来自 `this.archJson.extensions?.tsAnalysis?.moduleGraph`。

**2. 新增类型定义**（在 `EntitySummary` 定义附近，class 定义之前）：

```typescript
export interface PackageStatEntry {
  package: string;
  fileCount: number;
  testFileCount?: number;
  entityCount: number;
  methodCount: number;
  fieldCount: number;
  loc?: number;
  languageStats?: {
    structs?: number;
    interfaces?: number;
    functions?: number;
    enums?: number;
    classes?: number;
  };
}

export interface PackageStatMeta {
  dataPath: 'go-atlas' | 'ts-module-graph' | 'oo-derived';
  locAvailable: boolean;
  locBasis?: 'maxEndLine';
}

export interface PackageStatsResult {
  meta: PackageStatMeta;
  packages: PackageStatEntry[];
}
```

**注意**：`mcp-server.ts` 的 import 更新在 Phase 2 Stage 2 中处理，不在此阶段修改。

Acceptance criteria：`npm run type-check` 无报错；不影响现有测试。

Dependencies：Stage 1 就位。

---

##### Stage 3 — 实现 `aggregateEntityMetrics()` 和 `buildTestPattern()`

在 `QueryEngine` 类中新增两个私有方法：

```typescript
/**
 * Aggregate method/field/entity counts for all entities whose source file
 * starts with the given package prefix (prefix + '/' separator enforced).
 */
private aggregateEntityMetrics(
  packagePrefix: string
): { entityCount: number; methodCount: number; fieldCount: number } {
  let entityCount = 0, methodCount = 0, fieldCount = 0;
  const sep = packagePrefix.endsWith('/') ? packagePrefix : packagePrefix + '/';
  for (const [file, ids] of Object.entries(this.index.fileToIds)) {
    if (file !== packagePrefix && !file.startsWith(sep)) continue;
    for (const id of ids) {
      const entity = this.entityMap.get(id);
      if (!entity) continue;
      entityCount++;
      const members = entity.members ?? [];
      methodCount += members.filter(
        m => m.type === 'method' || m.type === 'constructor'
      ).length;
      fieldCount += members.filter(
        m => m.type === 'property' || m.type === 'field'
      ).length;
    }
  }
  return { entityCount, methodCount, fieldCount };
}

private buildTestPattern(): RegExp {
  switch (this.archJson.language) {
    case 'typescript': return /\.(test|spec)\.(ts|tsx|js|jsx)$/;
    case 'java':       return /Test\.java$|Tests\.java$|TestCase\.java$|([\\/]test[\\/])/;
    case 'python':     return /(^|[\\/])test_[^\\/]+\.py$|_test\.py$/;
    case 'cpp':        return /\.(test|spec)\.(cpp|cc|cxx)$|([\\/]|^)test[_\-]/i;
    default:           return /\.(test|spec)\./;
  }
}
```

**注意 `aggregateEntityMetrics` 的路径匹配**：`file !== packagePrefix && !file.startsWith(sep)` 这个条件处理了两种情况：
- `file === 'internal/query'`（包本身作为文件路径，极少见但须兼容）
- `file.startsWith('internal/query/')` 匹配子文件
- 不匹配 `'internal/query_test/'`（因为 `_test` 不等于 `/`）

Acceptance criteria：私有方法存在，不影响现有测试；`npm run type-check` 通过。

Dependencies：Stage 2 完成。

---

##### Stage 4 — 实现 `getPackageStats()`

在 `QueryEngine` 类中新增公开方法（置于 `getAtlasLayer` 之后）：

```typescript
getPackageStats(depth: number = 2, topN?: number): PackageStatsResult {
  const clampedDepth = Math.max(1, Math.min(5, depth));

  // ── Path A: Go Atlas ──────────────────────────────────────────────────────
  const pg = this.getAtlasLayer('package');
  if (pg) {
    const sourceNodes = pg.nodes.filter(
      n => n.type === 'internal' || n.type === 'cmd'
    );
    const packages: PackageStatEntry[] = sourceNodes.map(node => {
      const { entityCount, methodCount, fieldCount } =
        this.aggregateEntityMetrics(node.name);
      return {
        package:   node.name,
        fileCount: node.fileCount,
        entityCount,
        methodCount,
        fieldCount,
        languageStats: node.stats
          ? {
              structs:    node.stats.structs,
              interfaces: node.stats.interfaces,
              functions:  node.stats.functions,
            }
          : undefined,
      };
    });
    const sorted = packages.sort((a, b) => b.fileCount - a.fileCount);
    return {
      meta: { dataPath: 'go-atlas', locAvailable: false },
      packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
    };
  }

  // ── Path B: TypeScript (tsAnalysis.moduleGraph) ───────────────────────────
  const mg = this.archJson.extensions?.tsAnalysis?.moduleGraph;
  if (mg) {
    const testPattern = this.buildTestPattern();
    const ws = this.archJson.workspaceRoot;

    // MUST use sourceFiles, NOT fileToIds:
    // fileToIds only contains files with at least one entity. Test files with no entities
    // (e.g. engine.test.ts with only describe/it calls) are absent from fileToIds and
    // would be silently dropped, causing testFileCount to undercount.
    // archJson.sourceFiles lists every file the parser scanned, including test-only files.
    const moduleFiles = new Map<string, string[]>();
    for (let file of this.archJson.sourceFiles) {
      // Normalize absolute paths (e.g. C++ or some TS configurations)
      if (ws && path.isAbsolute(file)) file = path.relative(ws, file);
      const lastSlash = file.lastIndexOf('/');
      const moduleId = lastSlash >= 0 ? file.substring(0, lastSlash) : '';
      moduleFiles.set(moduleId, [...(moduleFiles.get(moduleId) ?? []), file]);
    }
    const packages: PackageStatEntry[] = mg.nodes
      .filter(n => n.type === 'internal')
      .map(node => {
        const files = moduleFiles.get(node.id) ?? [];
        const testFileCount = files.filter(f => testPattern.test(f)).length;
        const { entityCount, methodCount, fieldCount } =
          this.aggregateEntityMetrics(node.id);
        return {
          package:      node.name,
          fileCount:    node.fileCount,
          testFileCount,
          entityCount,
          methodCount,
          fieldCount,
          languageStats: {
            classes:    node.stats.classes,
            interfaces: node.stats.interfaces,
            functions:  node.stats.functions,
            enums:      node.stats.enums,
          },
        };
      });
    const sorted = packages.sort((a, b) => b.fileCount - a.fileCount);
    return {
      meta: { dataPath: 'ts-module-graph', locAvailable: false },
      packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
    };
  }

  // ── Path C: OO Fallback (Java / Python / C++) ─────────────────────────────
  const testPattern = this.buildTestPattern();
  const packageFiles = new Map<string, string[]>();
  for (const file of Object.keys(this.index.fileToIds)) {
    const parts = file.split('/');
    const pkg =
      parts.length <= clampedDepth
        ? parts.slice(0, -1).join('/') || '.'
        : parts.slice(0, clampedDepth).join('/');
    packageFiles.set(pkg, [...(packageFiles.get(pkg) ?? []), file]);
  }
  const packages: PackageStatEntry[] = [];
  for (const [pkg, files] of packageFiles) {
    let entityCount = 0, methodCount = 0, fieldCount = 0, loc = 0;
    let testFileCount = 0;
    for (const file of files) {
      const ids = this.index.fileToIds[file] ?? [];
      let maxLine = 0;
      for (const id of ids) {
        const entity = this.entityMap.get(id);
        if (!entity) continue;
        entityCount++;
        const members = entity.members ?? [];
        methodCount += members.filter(
          m => m.type === 'method' || m.type === 'constructor'
        ).length;
        fieldCount += members.filter(
          m => m.type === 'property' || m.type === 'field'
        ).length;
        maxLine = Math.max(maxLine, entity.sourceLocation.endLine);
      }
      loc += maxLine;
      if (testPattern.test(file)) testFileCount++;
    }
    packages.push({ package: pkg, fileCount: files.length, testFileCount, entityCount, methodCount, fieldCount, loc });
  }
  const sorted = packages.sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0));
  return {
    meta: { dataPath: 'oo-derived', locAvailable: true, locBasis: 'maxEndLine' },
    packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
  };
}
```

Acceptance criteria：
- 测试组 A、B、C 全部通过
- `npm run type-check` 无报错
- 现有 QueryEngine 测试全部通过

Dependencies：Stage 3 完成。

---

##### Stage 5 — 扩展 `getSummary()` 增加 `topPackages`

修改 `src/cli/query/query-engine.ts` 中的 `getSummary()` 方法：

1. 在方法末尾（return 之前）调用：
   ```typescript
   const topPackagesResult = this.getPackageStats(2, 10);
   const topPackages = topPackagesResult.packages;
   ```

2. 在 return 对象中追加 `topPackages` 字段：
   ```typescript
   return {
     entityCount,
     relationCount,
     language,
     kind,
     topDependedOn,
     topDependedOnNote,
     capabilities,
     topPackages,  // PackageStatEntry[], max 10
   };
   ```

3. 同步更新 `getSummary()` 的内联返回类型注解，追加 `topPackages: PackageStatEntry[]`。

Acceptance criteria：
- 测试组 D 全部通过
- 现有 `getSummary()` 测试通过（`topPackages` 字段不影响已有断言）
- `npm run type-check` 无报错

Dependencies：Stage 4 完成。

#### Test strategy

```bash
npx vitest run tests/unit/cli/query/query-engine.test.ts
npm run type-check
```

---

### Phase 2: 新 MCP 工具 `archguard_get_package_stats`

#### Objectives

- 在 `mcp-server.ts` 中注册 `archguard_get_package_stats`
- 支持 `sortBy`、`minFileCount`、`minLoc`、`topN` 参数
- 正确透传 `meta` 对象，并在结果为空时返回标准错误信息

#### Stages

---

##### Stage 1 — 补充失败测试（`mcp-server.test.ts`）

修改 `tests/unit/cli/mcp/mcp-server.test.ts`：

**tools.size 更新**：将现有的 `expect(tools.size).toBe(9)` 更新为 `expect(tools.size).toBe(10)`。同步更新 describe 标签从 `'registers all 9 tools'` 改为 `'registers all 10 tools'`，并在 `tools.has(...)` 列表中追加：
```typescript
expect(tools.has('archguard_get_package_stats')).toBe(true);
```
这是对现有测试的唯一必要修改。

**新增测试组 `archguard_get_package_stats`**（mock engine.getPackageStats）：

- 默认调用（无参数）：返回 JSON 包含 `meta.dataPath` 和 `packages` 数组
- `sortBy: 'fileCount'`：packages 按 `fileCount` DESC 排序
- `sortBy: 'entityCount'`：packages 按 `entityCount` DESC 排序
- `topN: 2`：packages 长度 ≤ 2
- `minFileCount: 3`：过滤掉 `fileCount < 3` 的 entry
- `minLoc: 500` 且 `meta.locAvailable: true`：过滤掉 `loc < 500` 的 entry
- `minLoc: 500` 且 `meta.locAvailable: false`（Go/TS）：minLoc 被忽略，不过滤任何 entry
- engine.getPackageStats 返回空 packages：响应文本为 `"No package statistics available for this scope."`
- 无 query 数据：返回标准 "No query data found" 错误（来自 `withEngineErrorContext`）

**Mock 方式**：使用现有 `mcp-server.test.ts` 中 `loadEngine` 的 mock 模式，在返回的 engine mock 上添加 `getPackageStats: vi.fn()` 方法，返回各场景下的 `PackageStatsResult`。

Acceptance criteria：所有新测试在 Stage 2 前失败。

Dependencies：Phase 1 全部完成。

---

##### Stage 2 — 实现工具

修改 `src/cli/mcp/mcp-server.ts`：

1. 更新 `mcp-server.ts` 顶部 import，追加新类型（`mcp-server.ts` 目前只 import `QueryEngine, EntitySummary`）：

```typescript
import type { QueryEngine, EntitySummary, PackageStatEntry, PackageStatsResult } from '../query/query-engine.js';
```

2. 更新 `registerTools()` 的 JSDoc 注释中的工具数量（9 → 10）。

3. 在 `registerTools()` 末尾（`archguard_get_atlas_layer` 之后）新增：

```typescript
server.tool(
  'archguard_get_package_stats',
  'Get per-package volume metrics (file count, entity count, approximate line count) ' +
    'sorted and filtered by threshold.',
  {
    projectRoot: projectRootParam,
    scope: scopeParam,
    depth: z.coerce
      .number()
      .min(1)
      .max(5)
      .default(2)
      .describe(
        'Directory depth for package grouping. Applies to Java, Python, and C++ only; ' +
          'ignored for Go (module-defined packages) and TypeScript (directory-based modules).'
      ),
    sortBy: z
      .enum(['loc', 'fileCount', 'entityCount', 'methodCount'])
      .default('loc')
      .describe(
        'Primary sort key, descending. Falls back to fileCount when loc is unavailable ' +
          '(Go Atlas and TypeScript projects).'
      ),
    minFileCount: z.coerce
      .number()
      .optional()
      .describe('Exclude packages with fewer than this many files.'),
    minLoc: z.coerce
      .number()
      .optional()
      .describe(
        'Exclude packages with loc below this threshold. ' +
          'Has no effect on Go or TypeScript (loc unavailable for these languages).'
      ),
    topN: z.coerce
      .number()
      .min(1)
      .max(200)
      .optional()
      .describe('Limit output to the top N packages after sorting and filtering.'),
  },
  async ({ projectRoot, scope, depth, sortBy, minFileCount, minLoc, topN }) => {
    const root = resolveRoot(projectRoot, defaultRoot);
    return withEngineErrorContext(root, async () => {
      const engine = await loadEngine(path.join(root, '.archguard'), scope);
      const result = engine.getPackageStats(depth);

      let packages = result.packages;

      // Apply filters
      if (minFileCount !== undefined) {
        packages = packages.filter(p => p.fileCount >= minFileCount);
      }
      if (minLoc !== undefined && result.meta.locAvailable) {
        packages = packages.filter(p => (p.loc ?? 0) >= minLoc);
      }

      // Re-sort by requested key (getPackageStats default sort may differ)
      packages = packages.sort((a, b) => {
        const val = (p: PackageStatEntry): number =>
          sortBy === 'fileCount'
            ? p.fileCount
            : sortBy === 'entityCount'
              ? p.entityCount
              : sortBy === 'methodCount'
                ? p.methodCount
                : (p.loc ?? p.fileCount); // 'loc' with fileCount fallback for extension paths
        return val(b) - val(a);
      });

      if (topN !== undefined) packages = packages.slice(0, topN);

      if (packages.length === 0) {
        return textResponse('No package statistics available for this scope.');
      }

      return textResponse(JSON.stringify({ meta: result.meta, packages }, null, 2));
    });
  }
);
```

3. 在 `mcp-server.ts` 顶部 import 中追加 `PackageStatEntry`（如未在 Phase 1 Stage 2 中添加）。

Acceptance criteria：
- 所有新工具测试通过
- 现有 10 个工具（含新增）的 `tools.size` 断言通过
- `npm run type-check` 无报错
- 现有工具测试不受影响

Dependencies：Stage 1 就位；Phase 1 全部完成。

#### Test strategy

```bash
npx vitest run tests/unit/cli/mcp/mcp-server.test.ts
npm run type-check
npm test  # 全量回归
```

---

## Dependencies

```
Phase 1 Stage 1 (tests)
  └─► Phase 1 Stage 2 (types)
        └─► Phase 1 Stage 3 (private helpers)
              └─► Phase 1 Stage 4 (getPackageStats)
                    └─► Phase 1 Stage 5 (getSummary.topPackages)
                          └─► Phase 2 Stage 1 (MCP tests)
                                └─► Phase 2 Stage 2 (MCP impl)
```

各阶段严格顺序执行；无可并行分支（依赖链线性）。

---

## Files Changed

| 文件 | 阶段 |
|---|---|
| `tests/unit/cli/query/query-engine.test.ts` | Phase 1 Stage 1 |
| `src/cli/query/query-engine.ts` | Phase 1 Stage 2–5 |
| `tests/unit/cli/mcp/mcp-server.test.ts` | Phase 2 Stage 1 |
| `src/cli/mcp/mcp-server.ts` | Phase 2 Stage 2 |

---

## Acceptance Criteria（全局）

1. `archguard_summary` 对所有语言返回 `topPackages` 字段（数组，长度 ≤ 10）。
2. `topPackages` 对 Go Atlas 项目按 `fileCount` DESC 排序，无 `loc` 字段。
3. `topPackages` 对 TypeScript 项目包含 `languageStats.{classes,interfaces,functions,enums}`。
4. `topPackages` 对 Java/Python/C++ 项目包含 `loc` 字段。
5. `archguard_get_package_stats` 对 Go Atlas 项目返回 `meta.dataPath === 'go-atlas'`，包含 `methodCount` 和 `languageStats`，无 `loc`。
6. `archguard_get_package_stats` 对 TypeScript 项目返回 `meta.dataPath === 'ts-module-graph'`，包含 `testFileCount` 和 `languageStats`，无 `loc`。
7. `archguard_get_package_stats` 对 Java 项目返回 `meta.dataPath === 'oo-derived'`，包含 `loc`、`testFileCount`。
8. `sortBy: 'fileCount'` + `topN: 3` 返回恰好 3 条按 `fileCount` DESC 排列的记录。
9. `minLoc: 500` 对 Go 项目无效（`meta.locAvailable: false`，不过滤任何 entry）。
10. `minLoc: 500` 对 Java 项目过滤掉 `loc < 500` 的 entry。
11. packages 为空时返回 `"No package statistics available for this scope."`。
12. 所有现有测试通过（`tools.size` 断言作为 Phase 2 的一部分从 `9` 更新为 `10`）。
13. `npm run type-check` 通过。
