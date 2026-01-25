# ArchGuard 高级 CLI 功能增强建议 (RLM 分析)

**文档版本**: 1.0
**创建日期**: 2026-01-25
**分析方法**: RLM (Refactoring Lifecycle Management)
**改进范围**: 多源分析、STDIN 支持、输出管理、批量处理
**优先级**: 🟡 中-高 (P1) - 增强灵活性和高级使用场景
**关联文档**: 05-config-and-cli-improvements.md

---

## 执行摘要

本文档基于 RLM 方法提出 ArchGuard CLI 的高级功能增强建议，旨在支持更复杂的使用场景和工作流集成。主要改进包括:

1. **多源路径支持** - 同时分析多个目录或模块
2. **STDIN 文件列表** - 支持管道和脚本集成
3. **输出文件名自定义** - 灵活的输出命名策略
4. **批量输出模式** - 为多个模块生成独立架构图

这些功能将使 ArchGuard 能够更好地服务于：
- Monorepo 项目（多包分析）
- 微服务架构（分模块生成图）
- CI/CD 集成（自动化工作流）
- Git 工具链集成（增量分析）

---

## 1. RLM PROPOSAL - 现状分析与问题识别

### 1.1 当前限制

**限制 1: 单一源目录**
```bash
# 当前只能指定一个源目录
archguard analyze -s ./src

# 无法直接分析多个模块
# 需要多次调用命令
archguard analyze -s ./frontend
archguard analyze -s ./backend
archguard analyze -s ./shared
```

**问题**:
- ❌ Monorepo 项目需要手动多次调用
- ❌ 无法一次性生成包含多个模块的全局视图
- ❌ 脚本复杂度增加

---

**限制 2: 文件发现依赖 globby**
```bash
# 必须通过目录模式指定文件
archguard analyze -s ./src

# 无法传入精确的文件列表
# 以下场景无法实现：
git ls-files '*.ts' | archguard analyze  # 不支持
find ./src -mtime -7 | archguard analyze  # 不支持
```

**问题**:
- ❌ 无法与 Git 工具链集成（只分析变更文件）
- ❌ 无法使用自定义文件过滤逻辑
- ❌ 无法处理非标准项目结构

---

**限制 3: 输出文件名固定**
```bash
# PlantUML 格式固定输出到 archguard/architecture.{puml,png}
archguard analyze

# 即使使用 -o 也只对 JSON 格式生效
archguard analyze -f json -o custom.json  # ✅ 有效
archguard analyze -o custom.puml          # ❌ 无效，仍输出到默认位置
```

**问题**:
- ❌ 无法为不同模块生成独立命名的图
- ❌ 多次调用会覆盖之前的输出
- ❌ 缺乏灵活的文件组织能力

---

**限制 4: 缺少批量处理模式**
```bash
# 想要为每个 package 生成独立的架构图
# 当前需要编写复杂脚本
for pkg in packages/*; do
  archguard analyze -s "$pkg/src" -o "archguard/$(basename $pkg)"
done
```

**问题**:
- ❌ 用户需要编写额外脚本
- ❌ 缺少自动化的多模块分析能力
- ❌ 难以生成模块索引和导航

---

### 1.2 使用场景分析

#### 场景 1: Monorepo 项目全局分析
```
项目结构:
packages/
  ├── frontend/src/
  ├── backend/src/
  ├── shared/src/
  └── api/src/

需求: 生成包含所有 packages 的全局架构图
当前方案: 无法实现或需要复杂脚本
```

#### 场景 2: Git 增量分析
```bash
# 只分析最近修改的文件
git diff --name-only HEAD~10 | grep '\.ts$' | archguard analyze --stdin

需求: 减少 CI 中的分析时间
当前方案: 不支持
```

#### 场景 3: 微服务架构多模块图
```
服务结构:
services/
  ├── auth-service/
  ├── user-service/
  ├── order-service/
  └── payment-service/

需求: 为每个服务生成独立的架构图 + 总览图
当前方案: 需要手动调用 4-5 次命令
```

#### 场景 4: CI/CD 自动化
```yaml
# GitHub Actions 工作流
- name: Analyze changed modules
  run: |
    changed_files=$(git diff --name-only origin/main...HEAD)
    echo "$changed_files" | archguard analyze --stdin --name "pr-${{ github.pr_number }}"

需求: 在 PR 中自动生成架构差异图
当前方案: 不支持
```

---

## 2. RLM PLANNING - 解决方案设计

### 2.1 多源路径支持

#### 建议 1: 支持 source 数组

**配置 Schema 更新**:
```typescript
// src/types/config.ts
export interface ArchGuardConfig {
  // 改为联合类型：string | string[]
  source: string | string[];

  // ... 其他配置保持不变
}
```

**实现策略**:
```typescript
// src/cli/config-loader.ts
const configSchema = z.object({
  source: z.union([
    z.string(),           // 单个路径
    z.array(z.string())   // 多个路径
  ]).default('./src'),
  // ...
});

// src/cli/commands/analyze.ts
async function analyzeCommandHandler(options: AnalyzeOptions) {
  // 规范化为数组
  const sources = Array.isArray(config.source)
    ? config.source
    : [config.source];

  // 收集所有文件
  const allFiles = await Promise.all(
    sources.map(src =>
      globby([
        `${path.resolve(src)}/**/*.ts`,
        `!**/*.test.ts`,
        ...excludePatterns
      ])
    )
  );

  const files = allFiles.flat();
  progress.succeed(`Found ${files.length} files from ${sources.length} source(s)`);

  // 统一处理
  const archJSON = await parser.parseFiles(files);
  // ...
}
```

**CLI 使用方式**:

**方式 A: 配置文件**
```json
{
  "source": ["./packages/frontend/src", "./packages/backend/src", "./shared"],
  "format": "plantuml"
}
```

**方式 B: 命令行重复参数**
```bash
archguard analyze -s ./frontend -s ./backend -s ./shared
```

**方式 C: 逗号分隔（可选实现）**
```bash
archguard analyze -s "./frontend,./backend,./shared"
```

**命令行参数定义**:
```typescript
.option('-s, --source <paths...>', 'Source directories (can specify multiple)', ['./src'])
```

**优先级**: 🔴 高 (P0)
**复杂度**: ⭐⭐ (简单)
**用户价值**: ⭐⭐⭐⭐⭐

---

### 2.2 STDIN 文件列表支持

#### 建议 2: 添加 --stdin 模式

**功能说明**:
从标准输入读取文件列表（每行一个文件路径），跳过 glob 文件发现阶段。

**实现设计**:
```typescript
// src/cli/commands/analyze.ts
.option('--stdin', 'Read file list from stdin (one file per line)')
.option('--base-dir <path>', 'Base directory for resolving relative paths in stdin', process.cwd())
.option('--skip-missing', 'Skip files that do not exist (useful with stdin)')
.action(analyzeCommandHandler);

async function analyzeCommandHandler(options: AnalyzeOptions) {
  let files: string[];

  if (options.stdin) {
    // 从 stdin 读取文件列表
    files = await readFilesFromStdin(options);
    progress.succeed(`Read ${files.length} files from stdin`);
  } else {
    // 现有的 globby 逻辑
    const sources = Array.isArray(config.source) ? config.source : [config.source];
    files = await discoverFiles(sources, config.exclude);
    progress.succeed(`Found ${files.length} TypeScript files`);
  }

  // 统一处理
  const archJSON = await parser.parseFiles(files);
  // ...
}

// 辅助函数
async function readFilesFromStdin(options: {
  baseDir?: string;
  skipMissing?: boolean;
  exclude?: string[];
}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      const lines = data.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));  // 支持注释行

      const files = lines.map(file => {
        // 解析相对路径
        return path.isAbsolute(file)
          ? file
          : path.join(options.baseDir || process.cwd(), file);
      });

      // 过滤存在的文件
      const existingFiles = files.filter(file => {
        const exists = fs.existsSync(file);
        if (!exists && !options.skipMissing) {
          console.warn(`Warning: File not found: ${file}`);
        }
        return exists;
      });

      // 应用 exclude 模式
      const filtered = options.exclude?.length
        ? micromatch.not(existingFiles, options.exclude)
        : existingFiles;

      resolve(filtered);
    });

    process.stdin.on('error', reject);
  });
}
```

**使用示例**:

**示例 1: Git 集成 - 只分析变更文件**
```bash
# 分析最近 10 个 commit 修改的 TypeScript 文件
git diff --name-only HEAD~10 | grep '\.ts$' | archguard analyze --stdin --name git-changes

# 分析与 main 分支的差异
git diff --name-only origin/main...HEAD | grep '\.ts$' | archguard analyze --stdin
```

**示例 2: Find 集成 - 按条件过滤**
```bash
# 只分析最近 7 天修改的文件
find ./src -name '*.ts' -type f -mtime -7 | archguard analyze --stdin --name recent

# 只分析大于 1KB 的文件
find ./src -name '*.ts' -type f -size +1k | archguard analyze --stdin
```

**示例 3: 自定义脚本**
```bash
# 从文件读取列表
cat important-files.txt | archguard analyze --stdin

# 组合使用
{
  ls src/core/**/*.ts
  ls src/utils/**/*.ts
} | archguard analyze --stdin --name core-utils
```

**示例 4: 处理相对路径**
```bash
# 文件列表包含相对路径
echo -e "src/a.ts\nsrc/b.ts" | archguard analyze --stdin --base-dir /project/root
```

**STDIN 格式规范**:
```
# 文件列表格式（一行一个文件）
src/components/Header.ts
src/components/Footer.ts
src/services/api.ts

# 支持注释（以 # 开头的行会被忽略）
# Core components
src/core/App.ts

# Utilities
src/utils/helpers.ts
```

**优先级**: 🟡 中 (P1)
**复杂度**: ⭐⭐⭐ (中等)
**用户价值**: ⭐⭐⭐⭐

---

### 2.3 输出文件名自定义

#### 建议 3: 扩展 -o/--output 语义

**问题**: 当前 `-o` 参数只在 `format=json` 时生效，PlantUML 格式固定输出到 `archguard/architecture.*`

**解决方案**: 统一 `-o` 参数语义，支持所有格式的输出文件名自定义。

**新增 --name 参数**（推荐）:
```bash
# 使用 --name 指定输出文件名（不带扩展名）
archguard analyze --name frontend
# 输出: archguard/frontend.puml, archguard/frontend.png

archguard analyze --name backend/api
# 输出: archguard/backend/api.puml, archguard/backend/api.png
```

**扩展 -o 参数语义**（向后兼容）:
```bash
# JSON 格式（现有行为，保持不变）
archguard analyze -f json -o ./output.json

# PlantUML 格式（新行为）
archguard analyze -o ./diagrams/my-project
# 输出: ./diagrams/my-project.puml, ./diagrams/my-project.png

# 智能推断
archguard analyze -o frontend
# 输出: archguard/frontend.puml, archguard/frontend.png
```

**实现设计**:
```typescript
// src/cli/utils/output-path-resolver.ts
export class OutputPathResolver {
  constructor(private config: ArchGuardConfig) {}

  /**
   * 解析输出路径
   * @param options.name - 输出文件名（不带扩展名），支持路径分隔符
   * @param options.output - 完整输出路径（向后兼容）
   */
  resolve(options: { name?: string; output?: string }): ResolvedPaths {
    let baseDir: string;
    let fileName: string;

    // 优先级: options.output > options.name > config.output > 默认
    if (options.output) {
      // 完整路径模式
      const parsed = path.parse(options.output);
      baseDir = parsed.dir || this.config.outputDir || './archguard';
      fileName = parsed.name;
    } else if (options.name) {
      // 仅文件名模式，支持子目录
      const parts = options.name.split('/');
      fileName = parts.pop()!;
      const subDir = parts.length > 0 ? parts.join('/') : '';
      baseDir = path.join(this.config.outputDir || './archguard', subDir);
    } else if (this.config.output) {
      // 配置文件指定
      const parsed = path.parse(this.config.output);
      baseDir = parsed.dir || this.config.outputDir || './archguard';
      fileName = parsed.name;
    } else {
      // 默认值
      baseDir = this.config.outputDir || './archguard';
      fileName = 'architecture';
    }

    // 确保目录存在
    fs.ensureDirSync(baseDir);

    return {
      dir: baseDir,
      name: fileName,
      paths: {
        puml: path.join(baseDir, `${fileName}.puml`),
        png: path.join(baseDir, `${fileName}.png`),
        svg: path.join(baseDir, `${fileName}.svg`),
        json: path.join(baseDir, `${fileName}.json`),
      }
    };
  }
}
```

**CLI 参数定义**:
```typescript
.option('-o, --output <path>', 'Output file path (without extension for PlantUML)')
.option('--name <name>', 'Output file name (supports subdirectories, e.g., "frontend/api")')
```

**使用示例**:
```bash
# 基本使用
archguard analyze --name user-service
# 输出: archguard/user-service.{puml,png}

# 带子目录
archguard analyze --name services/auth
# 输出: archguard/services/auth.{puml,png}

# 指定完整路径
archguard analyze -o ./docs/architecture/frontend
# 输出: ./docs/architecture/frontend.{puml,png}

# 结合配置文件
# archguard.config.json: { "outputDir": "./diagrams" }
archguard analyze --name api-gateway
# 输出: ./diagrams/api-gateway.{puml,png}
```

**优先级**: 🔴 高 (P0)
**复杂度**: ⭐⭐ (简单)
**用户价值**: ⭐⭐⭐⭐⭐

---

### 2.4 批量输出模式

#### 建议 4: 添加 --batch 模式

**功能说明**:
当 `source` 为数组且启用 `--batch` 时，为每个源目录生成独立的架构图，而不是合并到一个图中。

**实现设计**:
```typescript
// src/cli/commands/analyze.ts
.option('--batch', 'Generate separate diagrams for each source directory')
.option('--batch-index', 'Generate an index file linking all batch outputs', true)
.action(analyzeCommandHandler);

async function analyzeCommandHandler(options: AnalyzeOptions) {
  const sources = Array.isArray(config.source) ? config.source : [config.source];

  if (options.batch && sources.length > 1) {
    // 批量模式：为每个源生成独立的图
    await runBatchMode(sources, config, options);
  } else {
    // 标准模式：合并所有源到一个图
    await runStandardMode(sources, config, options);
  }
}

async function runBatchMode(
  sources: string[],
  config: ArchGuardConfig,
  options: AnalyzeOptions
) {
  const results: BatchResult[] = [];
  const pathResolver = new OutputPathResolver(config);

  for (const source of sources) {
    const moduleName = inferModuleName(source);
    progress.start(`Analyzing ${moduleName}...`);

    // 发现文件
    const files = await globby([`${source}/**/*.ts`, ...excludePatterns]);

    if (files.length === 0) {
      progress.warn(`No files found in ${source}`);
      continue;
    }

    // 解析
    const archJSON = await parser.parseFiles(files);

    // 生成输出
    const paths = pathResolver.resolve({ name: `modules/${moduleName}` });
    await generator.generateAndRender(archJSON, paths);

    progress.succeed(`Generated ${moduleName}: ${paths.paths.png}`);

    results.push({
      module: moduleName,
      source,
      entities: archJSON.entities.length,
      relations: archJSON.relations.length,
      outputPath: paths.paths.png,
    });
  }

  // 生成索引文件
  if (options.batchIndex) {
    await generateBatchIndex(results, config);
  }

  progress.succeed(`Batch processing complete: ${results.length} modules`);
}

function inferModuleName(sourcePath: string): string {
  // 从路径推断模块名
  // "./packages/frontend/src" -> "frontend"
  // "./services/auth-service" -> "auth-service"
  const parts = sourcePath.split('/').filter(p => p && p !== '.' && p !== 'src');
  return parts[parts.length - 1] || 'module';
}

async function generateBatchIndex(results: BatchResult[], config: ArchGuardConfig) {
  const indexContent = `# Architecture Diagrams Index

Generated: ${new Date().toISOString()}

## Modules

${results.map(r => `### ${r.module}

- **Source**: \`${r.source}\`
- **Entities**: ${r.entities}
- **Relations**: ${r.relations}
- **Diagram**: [View](${path.relative(config.outputDir || '.', r.outputPath)})

![${r.module}](${path.relative(config.outputDir || '.', r.outputPath)})

---
`).join('\n')}

## Summary

- Total Modules: ${results.length}
- Total Entities: ${results.reduce((sum, r) => sum + r.entities, 0)}
- Total Relations: ${results.reduce((sum, r) => sum + r.relations, 0)}
`;

  const indexPath = path.join(config.outputDir || './archguard', 'index.md');
  await fs.writeFile(indexPath, indexContent);
  console.log(`\nℹ Generated index: ${indexPath}`);
}
```

**使用示例**:

**示例 1: Monorepo 批量分析**
```bash
# 配置文件
{
  "source": [
    "./packages/frontend/src",
    "./packages/backend/src",
    "./packages/shared/src"
  ]
}

# 批量模式
archguard analyze --batch

# 输出:
# archguard/modules/frontend.{puml,png}
# archguard/modules/backend.{puml,png}
# archguard/modules/shared.{puml,png}
# archguard/index.md
```

**示例 2: 微服务架构**
```bash
archguard analyze \
  -s ./services/auth \
  -s ./services/user \
  -s ./services/order \
  -s ./services/payment \
  --batch \
  --output-dir ./docs/architecture

# 输出:
# docs/architecture/modules/auth.{puml,png}
# docs/architecture/modules/user.{puml,png}
# docs/architecture/modules/order.{puml,png}
# docs/architecture/modules/payment.{puml,png}
# docs/architecture/index.md
```

**生成的索引文件示例**:
```markdown
# Architecture Diagrams Index

Generated: 2026-01-25T10:30:00.000Z

## Modules

### frontend

- **Source**: `./packages/frontend/src`
- **Entities**: 28
- **Relations**: 45
- **Diagram**: [View](modules/frontend.png)

![frontend](modules/frontend.png)

---

### backend

- **Source**: `./packages/backend/src`
- **Entities**: 42
- **Relations**: 67
- **Diagram**: [View](modules/backend.png)

![backend](modules/backend.png)

---

## Summary

- Total Modules: 2
- Total Entities: 70
- Total Relations: 112
```

**优先级**: 🟡 中 (P1)
**复杂度**: ⭐⭐⭐⭐ (较高)
**用户价值**: ⭐⭐⭐⭐

---

## 3. RLM EXECUTION - 实施计划

### 3.1 开发阶段

#### Phase 1: 多源支持 (1-2 天)

**任务**:
1. 更新 `ArchGuardConfig` 类型定义
2. 修改 config schema 支持 `source: string | string[]`
3. 更新 analyze 命令的文件发现逻辑
4. 编写单元测试和集成测试

**验收标准**:
- [ ] 支持配置文件中的 source 数组
- [ ] 支持命令行 `-s` 重复参数
- [ ] 所有文件正确合并和去重
- [ ] 测试覆盖率 > 80%

**影响文件**:
- `src/types/config.ts`
- `src/cli/config-loader.ts`
- `src/cli/commands/analyze.ts`
- `tests/unit/config-loader.test.ts`

---

#### Phase 2: 输出文件名自定义 (1-2 天)

**任务**:
1. 创建 `OutputPathResolver` 工具类
2. 添加 `--name` 命令行参数
3. 更新 PlantUMLGenerator 使用新的路径解析器
4. 编写测试用例

**验收标准**:
- [ ] `--name` 参数正确解析文件名和子目录
- [ ] `-o` 参数向后兼容
- [ ] 输出目录自动创建
- [ ] 路径优先级正确（CLI > config > default）

**影响文件**:
- `src/cli/utils/output-path-resolver.ts` (新增)
- `src/cli/commands/analyze.ts`
- `src/ai/plantuml-generator.ts`
- `tests/unit/output-path-resolver.test.ts`

---

#### Phase 3: STDIN 支持 (2-3 天)

**任务**:
1. 实现 `readFilesFromStdin()` 函数
2. 添加 `--stdin`, `--base-dir`, `--skip-missing` 参数
3. 集成到 analyze 命令
4. 编写单元测试和集成测试

**验收标准**:
- [ ] 正确读取 stdin 文件列表
- [ ] 支持相对路径和绝对路径
- [ ] 正确应用 exclude 过滤
- [ ] 错误处理完善
- [ ] 与 Git/Find 集成测试通过

**影响文件**:
- `src/cli/commands/analyze.ts`
- `src/cli/utils/stdin-reader.ts` (新增)
- `tests/integration/stdin-input.test.ts`

---

#### Phase 4: 批量模式 (2-3 天)

**任务**:
1. 实现 `runBatchMode()` 函数
2. 实现 `inferModuleName()` 工具函数
3. 实现索引文件生成逻辑
4. 添加 `--batch` 和 `--batch-index` 参数
5. 编写端到端测试

**验收标准**:
- [ ] 为每个源生成独立的图
- [ ] 模块名推断准确
- [ ] 索引文件格式正确
- [ ] 支持禁用索引生成
- [ ] E2E 测试覆盖 monorepo 场景

**影响文件**:
- `src/cli/commands/analyze.ts`
- `src/cli/utils/batch-processor.ts` (新增)
- `src/cli/utils/index-generator.ts` (新增)
- `tests/e2e/batch-mode.test.ts`

---

#### Phase 5: 文档和示例 (1 天)

**任务**:
1. 更新 CLAUDE.md
2. 更新 README.md
3. 创建使用示例文档
4. 更新 CLI 帮助文档

**验收标准**:
- [ ] 所有新功能有文档说明
- [ ] 提供实际使用示例
- [ ] CLI --help 输出完整

**影响文件**:
- `CLAUDE.md`
- `README.md`
- `docs/examples/advanced-cli.md` (新增)

---

### 3.2 时间线

```
Week 1:
  Day 1-2: Phase 1 (多源支持)
  Day 3-4: Phase 2 (输出自定义)
  Day 5:   Phase 3 启动 (STDIN 支持)

Week 2:
  Day 1-2: Phase 3 完成 (STDIN 支持)
  Day 3-4: Phase 4 (批量模式)
  Day 5:   Phase 5 (文档)
```

**总工期**: 7-10 个工作日

---

## 4. RLM VALIDATION - 验证策略

### 4.1 单元测试

**多源支持测试**:
```typescript
describe('Multi-source support', () => {
  it('should accept string array in config', async () => {
    const config = {
      source: ['./src', './lib', './core']
    };
    const loader = new ConfigLoader();
    const result = await loader.load(config);
    expect(result.source).toEqual(['./src', './lib', './core']);
  });

  it('should collect files from all sources', async () => {
    const sources = ['./fixtures/project-a', './fixtures/project-b'];
    const files = await discoverFiles(sources, []);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.includes('project-a'))).toBe(true);
    expect(files.some(f => f.includes('project-b'))).toBe(true);
  });
});
```

**输出路径解析测试**:
```typescript
describe('OutputPathResolver', () => {
  it('should resolve name with subdirectory', () => {
    const resolver = new OutputPathResolver({ outputDir: './archguard' });
    const result = resolver.resolve({ name: 'services/auth' });
    expect(result.dir).toMatch(/archguard[/\\]services$/);
    expect(result.name).toBe('auth');
    expect(result.paths.png).toMatch(/auth\.png$/);
  });

  it('should prioritize CLI options', () => {
    const resolver = new OutputPathResolver({
      outputDir: './archguard',
      output: './config-output.puml'
    });
    const result = resolver.resolve({ output: './cli-output' });
    expect(result.name).toBe('cli-output');
  });
});
```

**STDIN 读取测试**:
```typescript
describe('STDIN file reading', () => {
  it('should parse file list from stdin', async () => {
    const mockStdin = new MockReadable([
      'src/a.ts\n',
      'src/b.ts\n',
      '# comment\n',
      'src/c.ts\n'
    ]);

    const files = await readFilesFromStdin({
      stdin: mockStdin,
      baseDir: '/project'
    });

    expect(files).toEqual([
      '/project/src/a.ts',
      '/project/src/b.ts',
      '/project/src/c.ts'
    ]);
  });

  it('should handle absolute and relative paths', async () => {
    const mockStdin = new MockReadable([
      '/absolute/path/a.ts\n',
      'relative/b.ts\n'
    ]);

    const files = await readFilesFromStdin({
      stdin: mockStdin,
      baseDir: '/project'
    });

    expect(files).toContain('/absolute/path/a.ts');
    expect(files).toContain('/project/relative/b.ts');
  });
});
```

---

### 4.2 集成测试

**Git 集成测试**:
```typescript
describe('Git integration', () => {
  it('should analyze files from git diff', async () => {
    const { stdout } = await execa('git', ['diff', '--name-only', 'HEAD~5']);
    const tsFiles = stdout.split('\n').filter(f => f.endsWith('.ts'));

    const tmpFile = path.join(os.tmpdir(), 'file-list.txt');
    await fs.writeFile(tmpFile, tsFiles.join('\n'));

    const result = await execa('node', [
      'dist/cli/index.js',
      'analyze',
      '--stdin',
      '--format', 'json',
      '-o', './test-output.json'
    ], {
      stdin: fs.createReadStream(tmpFile)
    });

    expect(result.exitCode).toBe(0);
    const output = await fs.readJSON('./test-output.json');
    expect(output.entities.length).toBeGreaterThan(0);
  });
});
```

**批量模式测试**:
```typescript
describe('Batch mode', () => {
  it('should generate separate diagrams for each source', async () => {
    await execa('node', [
      'dist/cli/index.js',
      'analyze',
      '-s', './fixtures/module-a',
      '-s', './fixtures/module-b',
      '--batch',
      '--output-dir', './test-output'
    ]);

    expect(fs.existsSync('./test-output/modules/module-a.png')).toBe(true);
    expect(fs.existsSync('./test-output/modules/module-b.png')).toBe(true);
    expect(fs.existsSync('./test-output/index.md')).toBe(true);
  });
});
```

---

### 4.3 端到端测试

**Monorepo 场景测试**:
```bash
# 准备测试 monorepo
mkdir -p test-monorepo/packages/{frontend,backend,shared}/src
# ... 创建测试文件

# 测试批量模式
archguard analyze \
  -s ./test-monorepo/packages/frontend/src \
  -s ./test-monorepo/packages/backend/src \
  -s ./test-monorepo/packages/shared/src \
  --batch \
  --output-dir ./test-output

# 验证输出
ls -la test-output/modules/
cat test-output/index.md
```

---

### 4.4 质量门控

**必须满足**:
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ 所有集成测试通过
- ✅ E2E 测试覆盖主要场景
- ✅ 向后兼容性测试通过
- ✅ 性能无明显退化
- ✅ 文档完整性检查通过

---

## 5. RLM INTEGRATION - 集成策略

### 5.1 向后兼容性保证

**兼容性检查清单**:
1. ✅ 单一 source 字符串仍然有效
2. ✅ 现有配置文件无需修改
3. ✅ 默认行为保持不变
4. ✅ 新参数都是可选的
5. ✅ 错误消息清晰

**兼容性示例**:
```bash
# 现有用法（完全兼容）
archguard analyze
archguard analyze -s ./src
archguard analyze -o ./output.json -f json

# 新用法（渐进式采用）
archguard analyze -s ./src -s ./lib  # 新功能
archguard analyze --stdin            # 新功能
archguard analyze --name my-project  # 新功能
```

---

### 5.2 发布策略

**版本规划**:
- **v1.2.0**: 多源支持 + 输出自定义（核心功能）
- **v1.3.0**: STDIN 支持（集成增强）
- **v1.4.0**: 批量模式（高级功能）

**v1.2.0 发布检查清单**:
- [ ] 所有测试通过
- [ ] CHANGELOG.md 更新
- [ ] README.md 更新
- [ ] 发布说明准备
- [ ] 示例代码验证
- [ ] 文档网站更新

---

## 6. RLM MONITORING - 持续改进

### 6.1 监控指标

**功能采用率**:
- 多源分析使用率
- STDIN 模式使用率
- 批量模式使用率
- 自定义输出名使用率

**性能指标**:
- 多源分析时间（相比多次调用）
- STDIN 读取开销
- 批量模式总耗时

**质量指标**:
- 相关 Issues 数量 < 3 个/月
- 文档反馈评分 > 4/5
- 功能请求满意度 > 85%

---

### 6.2 用户反馈渠道

**反馈收集**:
- GitHub Issues 标签: `enhancement`, `advanced-cli`
- 用户调研: 季度问卷
- 使用统计: 匿名遥测（可选）

**持续优化**:
- 根据反馈优化默认行为
- 扩展批量模式的智能检测
- 改进错误提示和文档

---

## 7. 使用示例和最佳实践

### 7.1 Monorepo 项目

**场景**: Lerna/Nx monorepo 结构

**配置文件**:
```json
{
  "source": [
    "./packages/*/src"
  ],
  "format": "plantuml",
  "outputDir": "./docs/architecture",
  "exclude": ["**/*.test.ts", "**/*.spec.ts"]
}
```

**使用命令**:
```bash
# 生成全局架构图（所有包合并）
archguard analyze

# 生成每个包的独立架构图
archguard analyze --batch
```

---

### 7.2 微服务架构

**场景**: 多个独立服务仓库

**Shell 脚本**:
```bash
#!/bin/bash
# analyze-services.sh

SERVICES=(
  "./services/auth-service"
  "./services/user-service"
  "./services/order-service"
  "./services/payment-service"
)

# 批量分析
archguard analyze \
  "${SERVICES[@]/#/-s }" \
  --batch \
  --output-dir ./architecture-docs \
  --verbose
```

---

### 7.3 CI/CD 集成

**GitHub Actions 工作流**:
```yaml
name: Architecture Analysis

on:
  pull_request:
    paths:
      - 'src/**/*.ts'
      - 'packages/**/*.ts'

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # 获取完整历史

      - name: Install ArchGuard
        run: npm install -g archguard

      - name: Analyze changed files
        run: |
          # 获取变更文件
          git diff --name-only origin/main...HEAD | \
            grep '\.ts$' | \
            archguard analyze \
              --stdin \
              --name "pr-${{ github.event.pull_request.number }}" \
              --output-dir ./architecture-diff

      - name: Upload diagrams
        uses: actions/upload-artifact@v3
        with:
          name: architecture-diagrams
          path: ./architecture-diff/**/*.png

      - name: Comment PR
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '📊 Architecture analysis complete! View diagrams in artifacts.'
            })
```

---

### 7.4 Git Hook 集成

**Pre-commit hook**:
```bash
#!/bin/bash
# .git/hooks/pre-commit

# 只分析暂存的 TypeScript 文件
git diff --cached --name-only --diff-filter=ACM | \
  grep '\.ts$' | \
  archguard analyze \
    --stdin \
    --format json \
    -o .archguard-staged.json \
    --skip-missing

# 验证架构复杂度
complexity=$(jq '.entities | length' .archguard-staged.json)
if [ $complexity -gt 100 ]; then
  echo "⚠️  Warning: High complexity detected ($complexity entities)"
  echo "Consider refactoring before committing."
  read -p "Continue? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi
```

---

## 8. 性能考虑

### 8.1 多源性能优化

**问题**: 多个源目录可能导致大量文件

**优化策略**:
1. **并行文件发现**:
   ```typescript
   const allFiles = await Promise.all(
     sources.map(src => globby([...]))
   );
   ```

2. **文件去重**:
   ```typescript
   const uniqueFiles = [...new Set(allFiles.flat())];
   ```

3. **增量缓存**:
   - 为每个源维护独立的缓存键
   - 只重新分析变更的源

---

### 8.2 STDIN 性能优化

**问题**: 大量文件列表可能占用内存

**优化策略**:
1. **流式读取**（当前实现已采用）
2. **批量处理**:
   ```typescript
   // 分批读取，避免一次性加载
   const BATCH_SIZE = 100;
   for (let i = 0; i < files.length; i += BATCH_SIZE) {
     const batch = files.slice(i, i + BATCH_SIZE);
     await processBatch(batch);
   }
   ```

---

### 8.3 批量模式性能优化

**问题**: 多个模块串行生成耗时长

**优化策略**:
1. **并行生成**（可选）:
   ```typescript
   const results = await Promise.all(
     sources.map(src => analyzeModule(src))
   );
   ```

2. **共享缓存**:
   - 多个模块可能共享依赖
   - 使用全局缓存避免重复解析

---

## 9. 风险评估

### 9.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 多源路径冲突 | 中 | 中 | 添加路径前缀，去重逻辑 |
| STDIN 内存溢出 | 低 | 高 | 流式处理，批量读取 |
| 批量模式超时 | 中 | 中 | 并行生成，进度报告 |
| 文件名冲突 | 低 | 低 | 路径验证，警告提示 |

---

### 9.2 用户采用风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 学习曲线增加 | 中 | 中 | 丰富文档，示例代码 |
| 配置复杂度 | 低 | 低 | 智能默认值，向导工具 |
| 兼容性问题 | 低 | 高 | 严格的兼容性测试 |

---

## 10. 预期收益

### 10.1 定量收益

| 维度 | 改进前 | 改进后 | 提升 |
|------|--------|--------|------|
| **Monorepo 分析** | 手动多次调用 | 单次命令 | ✨ 10x |
| **Git 集成** | 不支持 | 完全支持 | ✨ ∞ |
| **输出灵活性** | 固定文件名 | 完全自定义 | ✨ 100% |
| **批量处理** | 需编写脚本 | 内置支持 | ✨ 5x |
| **CI/CD 集成** | 复杂 | 简单 | ✨ 3x |

---

### 10.2 定性收益

**用户体验**:
- ✅ 支持复杂项目结构
- ✅ 与开发工具链无缝集成
- ✅ 灵活的输出管理
- ✅ 降低自动化门槛

**工具生态**:
- ✅ 更好的 CI/CD 集成
- ✅ Git 工具链互操作
- ✅ 脚本友好性提升
- ✅ 社区贡献潜力

---

## 11. 成功度量

### 11.1 定量指标

- ✅ 多源功能测试覆盖率 ≥ 85%
- ✅ STDIN 模式性能开销 < 5%
- ✅ 批量模式并行加速 > 2x
- ✅ 向后兼容性 = 100%
- ✅ 文档完整性 = 100%

---

### 11.2 定性指标

- ✅ GitHub Stars 增长 > 20%
- ✅ 用户满意度 > 4.5/5
- ✅ CI/CD 集成案例 ≥ 3 个
- ✅ 社区贡献 PR ≥ 2 个

---

## 12. 相关文档

- [05-config-and-cli-improvements.md](./05-config-and-cli-improvements.md) - 基础 CLI 配置增强
- [02-claude-code-integration-strategy.md](./02-claude-code-integration-strategy.md) - Claude Code 集成
- [00-implementation-roadmap.md](./00-implementation-roadmap.md) - 总体路线图

---

## 13. 附录

### 13.1 完整配置示例

**Monorepo 配置**:
```json
{
  "source": [
    "./packages/frontend/src",
    "./packages/backend/src",
    "./packages/shared/src"
  ],
  "format": "plantuml",
  "outputDir": "./docs/architecture",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ],
  "concurrency": 8,
  "verbose": true
}
```

**微服务配置**:
```json
{
  "source": [
    "./services/auth-service",
    "./services/user-service",
    "./services/order-service",
    "./services/payment-service"
  ],
  "format": "plantuml",
  "outputDir": "./architecture-docs"
}
```

---

### 13.2 Shell 脚本示例

**Git 增量分析脚本**:
```bash
#!/bin/bash
# analyze-git-diff.sh

# 获取与 main 分支的差异
CHANGED_FILES=$(git diff --name-only origin/main...HEAD | grep '\.ts$')

if [ -z "$CHANGED_FILES" ]; then
  echo "No TypeScript files changed"
  exit 0
fi

# 分析变更文件
echo "$CHANGED_FILES" | archguard analyze \
  --stdin \
  --name "diff-$(git rev-parse --short HEAD)" \
  --output-dir ./architecture-diff \
  --skip-missing \
  --verbose

echo "✅ Analysis complete: ./architecture-diff/"
```

**批量分析脚本**:
```bash
#!/bin/bash
# batch-analyze.sh

# 发现所有 package
PACKAGES=$(find packages -type d -name "src" -maxdepth 2)

# 转换为命令行参数
SOURCE_ARGS=""
for pkg in $PACKAGES; do
  SOURCE_ARGS="$SOURCE_ARGS -s $pkg"
done

# 批量分析
archguard analyze $SOURCE_ARGS \
  --batch \
  --batch-index \
  --output-dir ./docs/architecture \
  --verbose

echo "✅ Generated diagrams for $(echo "$PACKAGES" | wc -l) packages"
```

---

**文档作者**: Claude Code (AI Assistant)
**最后更新**: 2026-01-25
**文档状态**: ✅ 完成
**适用版本**: ArchGuard v1.2.0+
**下一步**: 提交 PR 进行技术评审和社区讨论
