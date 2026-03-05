# Plan 26: C++ Module-Level Class Diagrams

> Branch: `feat/cpp`
> Status: Draft (v2 — 经架构审查修订)

---

## Context

当前 C++ 分析仅生成两张图：

```
llama.cpp/package.mmd   79 entities,   38 relations
llama.cpp/class.mmd   5698 entities, 1836 relations  ← 不可读
```

TypeScript 分析会为每个顶层目录（模块）生成独立的详细类图（`method/<module>`），
使每张图保持 20–90 个实体的可读范围。C++ 缺少等价机制。

**Gap 对比：**

| 层级 | TypeScript | C++ 现状 | C++ 目标 |
|------|-----------|---------|---------|
| 包依赖图 | `overview/package` | `llama.cpp/package` ✓ | 保持 |
| 全量类图 | `class/all-classes` | `llama.cpp/class` ✓ | 保持（概览用） |
| 模块级类图 | `method/<mod>` | ❌ | `class/<dir>` × N |

**目标输出（以 llama.cpp 为例）：**

```
.archguard/llama.cpp/
  package.mmd              ← 保持（79 实体）
  class.mmd                ← 保持（全量概览，5698 实体）
  class/
    src.mmd                ← NEW: ~763 实体
    common.mmd             ← NEW: ~582 实体
    tools.mmd              ← NEW: ~482 实体
    tests.mmd              ← NEW: ~476 实体
    examples.mmd           ← NEW: ~111 实体
    ggml.mmd               ← NEW: ~3267 实体（已知超限，见"已知限制"节）
```

**`--diagrams class` 语义说明（有意设计）：**

引入 per-module diagrams 后，`--diagrams class` 会同时返回：
- `llama.cpp/class`（全量概览，level=class）
- `llama.cpp/class/src`、`llama.cpp/class/ggml` 等（模块级，level=class）

这是预期行为：`class` 层包含所有粒度的类图。用户若只需全量图，使用 `--diagrams package class` 并配合 config 文件中的 `diagrams` 数组显式列出。

---

## 技术分析

### 现有机制复用情况

| 机制 | TypeScript | C++ 可复用？ |
|------|-----------|------------|
| `deriveSubModuleArchJSON(parent, subPath)` | 按 filePath/id 过滤实体 | **部分** — 需补充 `sourceLocation.file` 检查 |
| `findParentCoverage(sources)` | 查找已缓存的父级解析结果 | **需适配** — C++ 路由分支目前绕过此调用 |
| `MermaidDiagramGenerator.generateClassLevel()` | 渲染 classDiagram | ✅ 直接复用（需 Phase 3 实测验证） |
| `ArchJSONAggregator.aggregate(json, 'class')` | 过滤公有成员 | ✅ 直接复用 |
| `filterByLevels(diagrams, levels)` | `--diagrams class` 过滤 | ✅ 直接复用 |
| `WorkerPool` 并行渲染 | 多图并行 | ✅ 自动生效 |

### 关键差异一：`deriveSubModuleArchJSON` 路径匹配

TypeScript 实体路径来源：`filePath` 字段（相对路径）或 `id` 前缀推断。
C++ 实体路径来源：`sourceLocation.file`（绝对路径）。

`deriveSubModuleArchJSON` 当前未读取 `sourceLocation.file`，需在过滤链末尾追加此 fallback。

### 关键差异二：`processSourceGroup` C++ 路由缺少父缓存推导

这是本方案最关键的架构问题。

`groupDiagramsBySource()` 按 `hashSources(diagram.sources)` 分组。方案产生的 DiagramConfig 会落入不同的 source group：

| Diagram | sources | group |
|---------|---------|-------|
| `llama.cpp/package` | `['/path/llama.cpp']` | **Root group** |
| `llama.cpp/class`   | `['/path/llama.cpp']` | **Root group** |
| `llama.cpp/class/ggml` | `['/path/llama.cpp/ggml']` | **Ggml group** |
| `llama.cpp/class/src`  | `['/path/llama.cpp/src']`  | **Src group** |

每个 per-module group 独立调用 `processSourceGroup`。当前 C++ 分支（lines 447-458）逻辑：

```typescript
if (firstDiagram.language === 'cpp') {
  const rawArchJSON = await this.registerDeferred(
    firstDiagram.sources,           // ← per-module group 传入子目录路径
    this.parseCppProject(firstDiagram) // ← 把子目录当 workspaceRoot 解析
  );
}
```

若 per-module DiagramConfig 带 `language: 'cpp'`：每组各自调用 `parseCppProject('/path/llama.cpp/ggml')`，把子目录当根，**丢失全部跨模块 relations，并触发 N 次全量解析**。

若 per-module DiagramConfig 不带 `language`：跳过 C++ 分支，进入 TypeScript fallback（line 499+），调用 `fileDiscovery.discoverFiles` 查找 `.ts` 文件，找不到后 **throw `No TypeScript files found`**。

**正确设计：C++ 分支内先查父缓存，有父则推导，无父才全量解析。**
Per-module DiagramConfig 保留 `language: 'cpp'`，由修改后的 C++ 分支正确处理。

### 已知限制：`ggml/` 目录 3267 实体

`ggml/` 包含 3267 个实体，超过任何合理的单图阈值。本 Plan 不解决此子目录的进一步拆分，但会：

1. 正常生成 `class/ggml.json`（JSON 格式完整）
2. 生成 `class/ggml.mmd` 和渲染文件（可能因节点过多导致图不可读）
3. 在控制台输出警告：`⚠ class/ggml: 3267 entities exceeds recommended 500, diagram may not be readable`

进一步的子目录递归拆分（`class/ggml/src`、`class/ggml/include` 等）作为独立 future plan 处理。

---

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/cli/utils/cpp-project-structure-detector.ts` | **NEW** | C++ 目录结构检测器 |
| `src/cli/processors/diagram-processor.ts` | **MODIFY** | ① `deriveSubModuleArchJSON` 补充 `sourceLocation.file`；② C++ 分支加入父缓存推导逻辑 |
| `src/cli/commands/analyze.ts` | **MODIFY** | C++ 分支调用新检测器 |
| `src/plugins/cpp/index.ts` | 无需修改 | `supportedLevels: ['package', 'class']` 保持不变 |
| `tests/unit/cli/utils/cpp-project-structure-detector.test.ts` | **NEW** | 单元测试 |
| `tests/unit/cli/processors/diagram-processor.test.ts` | **MODIFY** | 补充 C++ 父缓存推导测试 + `sourceLocation.file` 过滤测试 |

---

## Pre-flight

```bash
npm test
# Expected: 2102 tests, 2 failed (pre-existing timing flakiness only)

npm run type-check
# Expected: 0 errors

node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard
# Baseline: package(79e/38r) + class(5698e/1836r)
```

---

## Phase 1 — `CppProjectStructureDetector`（TDD）

### 新文件：`src/cli/utils/cpp-project-structure-detector.ts`

**公共 API：**

```typescript
/** C++ source file extensions */
export const CPP_EXTENSIONS = ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h', '.h++'];

/**
 * Detect whether a directory contains any C/C++ source files (recursive).
 * Stops at first match to keep I/O minimal.
 */
export async function directoryHasCppFiles(dir: string): Promise<boolean>;

/**
 * List top-level subdirectories of sourceRoot that contain C/C++ source files.
 *
 * @param sourceRoot - Absolute path to C++ project root
 * @returns Sorted array of directory names (e.g. ["common", "ggml", "src", "tests"])
 */
export async function getCppTopLevelModules(sourceRoot: string): Promise<string[]>;

/**
 * Detect C++ project structure and return DiagramConfig[].
 *
 * Output:
 *   - 1 package diagram  (full sourceRoot, level: 'package',  language: 'cpp')
 *   - 1 class diagram    (full sourceRoot, level: 'class',    language: 'cpp', global overview)
 *   - N class/<dir>      (per top-level dir, level: 'class',  language: 'cpp')
 *
 * Skips per-dir diagram if the directory contains no C++ source files.
 *
 * NOTE: Only cliOptions.sources[0] is used. Multiple source paths are not supported
 * and will be silently ignored (documented limitation).
 *
 * @param sourceRoot  - Absolute path to C++ project root (= path.resolve(cliOptions.sources[0]))
 * @param moduleName  - Diagram name prefix (= path.basename(sourceRoot))
 * @param options     - Optional format and exclude passthrough
 */
export async function detectCppProjectStructure(
  sourceRoot: string,
  moduleName: string,
  options?: { format?: string; exclude?: string[] }
): Promise<DiagramConfig[]>;
```

**期望输出（llama.cpp 示例），所有 DiagramConfig 均携带 `language: 'cpp'`：**

```typescript
[
  { name: 'llama.cpp/package',        sources: ['/path/llama.cpp'],         level: 'package', language: 'cpp' },
  { name: 'llama.cpp/class',          sources: ['/path/llama.cpp'],         level: 'class',   language: 'cpp' },
  { name: 'llama.cpp/class/common',   sources: ['/path/llama.cpp/common'],  level: 'class',   language: 'cpp' },
  { name: 'llama.cpp/class/examples', sources: ['/path/llama.cpp/examples'],level: 'class',   language: 'cpp' },
  { name: 'llama.cpp/class/ggml',     sources: ['/path/llama.cpp/ggml'],    level: 'class',   language: 'cpp' },
  { name: 'llama.cpp/class/src',      sources: ['/path/llama.cpp/src'],     level: 'class',   language: 'cpp' },
  { name: 'llama.cpp/class/tests',    sources: ['/path/llama.cpp/tests'],   level: 'class',   language: 'cpp' },
  { name: 'llama.cpp/class/tools',    sources: ['/path/llama.cpp/tools'],   level: 'class',   language: 'cpp' },
]
```

**排除目录列表（C++ 特定）：**

```typescript
/** Exact-match exclusion set for common non-source directories */
const CPP_EXCLUDED_DIRS = new Set([
  'build', '.cmake',
  'vendor', 'third_party', 'thirdparty', 'external',
  'node_modules', '.git', 'dist',
  '.cache', '.tmp', 'tmp',
  'docs', 'doc', 'media', 'licenses',
  'scripts', 'ci',
]);

/**
 * cmake-build-* directories use arbitrary suffixes (debug, release, relwithdebinfo, custom…).
 * Use prefix match instead of enumerating variants.
 */
function isCmakeBuildDir(name: string): boolean {
  return name.startsWith('cmake-build-');
}

function isExcluded(name: string): boolean {
  return CPP_EXCLUDED_DIRS.has(name) || name.startsWith('.') || isCmakeBuildDir(name);
}
```

**测试文件：`tests/unit/cli/utils/cpp-project-structure-detector.test.ts`**

覆盖场景：
- `directoryHasCppFiles`: 有 .cpp/.h 文件 → true；只有 .md 文件 → false；空目录 → false
- `getCppTopLevelModules`: 返回有 C++ 文件的目录，跳过 `build/`、`vendor/`、`cmake-build-release/`、`cmake-build-relwithdebinfo/` 等
- `detectCppProjectStructure`:
  - 0 个子模块 → 只返回 `[package, class]`（2 条）
  - N 个子模块 → `[package, class, class/dir1, ..., class/dirN]`
  - 所有 DiagramConfig 均携带 `language: 'cpp'`
  - `format` / `exclude` 参数透传到所有 DiagramConfig

---

## Phase 2 — `diagram-processor.ts` 双项修改 + 集成

### 修改 A：`deriveSubModuleArchJSON` 补充 `sourceLocation.file`

在实体过滤链末尾追加第三条 fallback：

```typescript
// Existing (unchanged):
let fp = ((e as unknown as { filePath?: string }).filePath ?? '').replace(/\\/g, '/');
if (!fp && e.name && e.id.endsWith('.' + e.name)) {
  fp = e.id.slice(0, e.id.length - e.name.length - 1).replace(/\\/g, '/');
}

// ADD: fallback for C++ entities (sourceLocation.file is absolute path)
if (!fp && e.sourceLocation?.file) {
  fp = e.sourceLocation.file.replace(/\\/g, '/');
}
```

对 TypeScript 实体无影响（它们已有 `filePath` 或 id 编码路径，新分支是 last-resort fallback）。

### 修改 B：`processSourceGroup` C++ 分支加入父缓存推导

将现有的 C++ 路由从"直接解析"改为"先查父缓存，有父则推导，无父才解析"，与 TypeScript fallback 路径的 `findParentCoverage` 逻辑保持对称：

```typescript
// BEFORE (problematic — no parent-cache lookup):
if (firstDiagram.language === 'cpp') {
  const rawArchJSON = await this.registerDeferred(
    firstDiagram.sources,
    this.parseCppProject(firstDiagram)
  );
  const results = await pMap(diagrams, ...);
  return results;
}

// AFTER:
if (firstDiagram.language === 'cpp') {
  const { deferred, normParentPath } = this.findParentCoverage(firstDiagram.sources);

  let rawArchJSON: ArchJSON;
  if (deferred) {
    // Root parse in-progress: await then derive sub-module view
    const parentArchJSON = await deferred;
    rawArchJSON = deriveSubModuleArchJSON(parentArchJSON, firstDiagram.sources[0], normParentPath ?? undefined);
  } else if (normParentPath) {
    // Root parse already complete: derive immediately from cache
    const parentCacheKey = this.archJsonPathIndex.get(normParentPath)!;
    const parentArchJSON = this.archJsonCache.get(parentCacheKey)!;
    rawArchJSON = deriveSubModuleArchJSON(parentArchJSON, firstDiagram.sources[0], normParentPath);
  } else {
    // No parent found: this is the root parse — parse in full and cache
    rawArchJSON = await this.registerDeferred(
      firstDiagram.sources,
      this.parseCppProject(firstDiagram)
    );
  }

  const results = await pMap(
    diagrams,
    async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
    { concurrency: this.globalConfig.concurrency || os.cpus().length }
  );
  return results;
}
```

**此修改使 C++ 路由与 TypeScript 的 "parse once, derive N sub-module views" 模式完全对称。**
Root group（`package` + `class`）触发全量解析并注册 deferred；per-module groups（`class/ggml` 等）并发进入相同分支，通过 `findParentCoverage` 找到 root deferred，await 后推导各自的子图。

**补充测试**（扩展 `tests/unit/cli/processors/diagram-processor.test.ts`）：

```typescript
// Test A: deriveSubModuleArchJSON uses sourceLocation.file for C++ entities
it('filters C++ entities by sourceLocation.file', () => {
  const parent: ArchJSON = {
    entities: [
      { id: 'ggml.ggml_tensor', name: 'ggml_tensor', sourceLocation: { file: '/proj/ggml/ggml.h', startLine: 1, endLine: 10 }, ... },
      { id: 'src.llama_model',  name: 'llama_model',  sourceLocation: { file: '/proj/src/llama.cpp', startLine: 1, endLine: 50 }, ... },
    ],
    relations: [],
    ...
  };
  const derived = deriveSubModuleArchJSON(parent, '/proj/ggml');
  expect(derived.entities).toHaveLength(1);
  expect(derived.entities[0].name).toBe('ggml_tensor');
});

// Test B: C++ processSourceGroup uses parent cache for sub-module groups
it('C++ per-module group derives from root cache without re-parsing', async () => {
  // Setup: root parse already cached
  // Assert: parseCppProject called once (for root), not for sub-module groups
});
```

### 修改：`src/cli/commands/analyze.ts`

```typescript
// BEFORE:
if (language === 'cpp') {
  const sourcePath = path.resolve(cliOptions.sources[0]);
  const moduleName = path.basename(sourcePath);
  const diagrams: DiagramConfig[] = [
    { name: `${moduleName}/package`, sources: cliOptions.sources, level: 'package', language, ... },
    { name: `${moduleName}/class`,   sources: cliOptions.sources, level: 'class',   language, ... },
  ];
  return filterByLevels(diagrams, cliOptions.diagrams);
}

// AFTER:
if (language === 'cpp') {
  const sourcePath = path.resolve(cliOptions.sources[0]);
  // NOTE: only sources[0] is used; multiple --sources not supported for C++ (documented limitation)
  const moduleName = path.basename(sourcePath);
  const diagrams = await detectCppProjectStructure(sourcePath, moduleName, {
    format: cliOptions.format,
    exclude: cliOptions.exclude,
  });
  return filterByLevels(diagrams, cliOptions.diagrams);
}
```

---

## Phase 3 — Build + Validate

```bash
npm run build

# 完整分析（生成所有图层）
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard

# 只生成 class 层（全量 + 模块级，验证 --diagrams 语义）
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard --diagrams class

# 只生成 package 层
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard --diagrams package
```

### 验收标准

| 检查项 | 预期 |
|--------|------|
| 生成图数量 | ≥ 8（package + class + ≥6 个目录级 class） |
| `parseCppProject` 调用次数 | **1 次**（验证无重复解析，通过 debug log 或 spy 确认） |
| `class/src.mmd` | 包含 llama_model、llama_context 等核心类 |
| `class/common.mmd` | 包含 common 目录下的类 |
| 模块内 relations 正确 | 不含跨模块边（源实体与目标实体均在同一模块内） |
| `--diagrams class` 过滤 | 返回 `llama.cpp/class` + 所有 `llama.cpp/class/*`，跳过 `llama.cpp/package` |
| `--diagrams package` 过滤 | 只返回 `llama.cpp/package` |
| Mermaid 渲染无报错 | src/common/tools/tests/examples 正常生成 .svg/.png |
| `class/ggml` 警告 | 控制台输出 "3267 entities exceeds recommended 500" 警告 |
| `npm test` | 2102 tests，0 new failures |

**Phase 3 额外验证：`HeuristicGrouper` 对深层路径的处理**

`extractPackageName` 在遇到含 `/src/` 段的深层 C++ 绝对路径时（如 `/proj/ggml/src/ggml-cpu.cpp`），会将 `src` 识别为 srcIndex，导致取 `parts[srcIndex+1]` = 文件名而非目录名，产生错误的 namespace 分组。需实测 `class/ggml.mmd` 的 namespace 分布，若出现文件名格式的 namespace 标签，记录为 issue，在 `HeuristicGrouper` 中单独修复（超出本 Plan 范围）。

---

## 执行策略

- Phase 1（detector）和 Phase 2-A（`deriveSubModuleArchJSON`）可**并行开发**（文件独立）
- Phase 2-B（`processSourceGroup` 修改）依赖 Phase 1 API 稳定（需要知道 DiagramConfig 结构）
- Phase 2（`analyze.ts` 集成）依赖 Phase 1 和 Phase 2-B 均完成后接入
- 每步骤独立通过 `npm test` 后再推进
- Phase 3 为最终集成验证，不修改生产代码

---

## 风险与注意事项

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| `processSourceGroup` 修改引入并发竞争 | 高 | `findParentCoverage` 已有 deferred 机制处理并发，与 TypeScript 路径完全对称，逻辑可复用，需补充并发场景测试 |
| `ggml/` 3267 实体图不可读 | 中 | 本 Plan 范围内仅输出警告；子目录递归拆分作为 future plan |
| `HeuristicGrouper` 对深层 C++ 路径 namespace 错误 | 中 | Phase 3 实测记录，单独修复 |
| `cmake-build-*` 变体遗漏 | 低 | 改用前缀匹配（`name.startsWith('cmake-build-')`） |
| `cliOptions.sources[1...]` 静默忽略 | 低 | 文档记录为已知限制，C++ 当前不支持多 source roots |
