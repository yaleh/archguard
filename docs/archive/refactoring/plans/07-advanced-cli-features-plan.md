# ArchGuard 高级 CLI 功能增强 - 实施计划 (RLM PLANNING)

**文档版本**: 1.0
**创建日期**: 2026-01-25
**RLM 阶段**: PLANNING
**关联 Proposal**: [07-advanced-cli-features.md](../proposals/07-advanced-cli-features.md)
**项目代号**: CLI-ADVANCED-v1.2
**目标版本**: ArchGuard v1.2.0
**预估工期**: 7-10 个工作日

---

## 执行摘要

本文档是 RLM PLANNING 阶段的详细实施计划，将 Proposal 07 中的建议转化为可执行的开发任务。包含 4 个核心功能的技术设计、实施步骤、验收标准和风险管理。

**核心功能**:
1. 多源路径支持 (P0) - 2 天
2. 输出文件名自定义 (P0) - 2 天
3. STDIN 文件列表支持 (P1) - 3 天
4. 批量输出模式 (P1) - 3 天

**关键决策**:
- 多源默认合并模式，提供 `--separate` 选项
- 批量模式采用索引模式（index.md + modules/）
- STDIN 格式：纯文本文件列表（一行一个）

---

## 1. 技术架构设计

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    CLI Layer (analyze.ts)                    │
├─────────────────────────────────────────────────────────────┤
│  Options:                                                    │
│  - source: string | string[]  (多源支持)                    │
│  - stdin: boolean              (STDIN 模式)                 │
│  - name: string                (输出文件名)                 │
│  - batch: boolean              (批量模式)                   │
│  - separate: boolean           (分离模式)                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
    ┌─────────────┴──────────────┬────────────────────────────┐
    │                            │                            │
    ▼                            ▼                            ▼
┌─────────┐              ┌──────────────┐          ┌──────────────┐
│  File   │              │   Output     │          │   Batch      │
│Discovery│              │ Path Resolver│          │  Processor   │
└─────────┘              └──────────────┘          └──────────────┘
    │                            │                            │
    ├─ globby (默认)             ├─ resolve(name)             ├─ inferModuleName()
    ├─ STDIN reader              ├─ ensureDir()              ├─ analyzeBatch()
    └─ 路径规范化                └─ 优先级处理               └─ generateIndex()
                                                                │
                                                                ▼
                                                        ┌──────────────┐
                                                        │    Index     │
                                                        │  Generator   │
                                                        └──────────────┘
```

---

### 1.2 核心模块设计

#### 模块 1: FileDiscoveryService

**职责**: 统一的文件发现服务

```typescript
// src/cli/utils/file-discovery-service.ts

export interface FileDiscoveryOptions {
  sources?: string[];        // 源目录列表
  stdin?: boolean;           // STDIN 模式
  baseDir?: string;          // 基础目录（STDIN 相对路径）
  exclude?: string[];        // 排除模式
  skipMissing?: boolean;     // 跳过不存在的文件
}

export class FileDiscoveryService {
  /**
   * 发现文件（统一入口）
   */
  async discoverFiles(options: FileDiscoveryOptions): Promise<string[]> {
    if (options.stdin) {
      return this.discoverFromStdin(options);
    } else {
      return this.discoverFromGlob(options);
    }
  }

  /**
   * 从 STDIN 读取文件列表
   */
  private async discoverFromStdin(options: FileDiscoveryOptions): Promise<string[]> {
    const lines = await this.readStdin();
    const files = this.parseFileList(lines, options.baseDir);
    const validated = this.validateFiles(files, options.skipMissing);
    return this.applyExcludes(validated, options.exclude);
  }

  /**
   * 从 glob 模式发现文件
   */
  private async discoverFromGlob(options: FileDiscoveryOptions): Promise<string[]> {
    const sources = options.sources || ['./src'];

    const allFiles = await Promise.all(
      sources.map(source =>
        globby([
          `${path.resolve(source)}/**/*.ts`,
          `!**/*.test.ts`,
          `!**/*.spec.ts`,
          ...this.buildExcludePatterns(options.exclude)
        ])
      )
    );

    // 合并并去重
    const merged = [...new Set(allFiles.flat())];
    return merged.sort();
  }

  /**
   * 从 stdin 读取数据
   */
  private async readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }

  /**
   * 解析文件列表
   */
  private parseFileList(content: string, baseDir?: string): string[] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))  // 过滤空行和注释
      .map(file => {
        // 处理相对路径
        if (path.isAbsolute(file)) {
          return file;
        }
        return path.join(baseDir || process.cwd(), file);
      });
  }

  /**
   * 验证文件存在性
   */
  private validateFiles(files: string[], skipMissing: boolean): string[] {
    return files.filter(file => {
      const exists = fs.existsSync(file);
      if (!exists && !skipMissing) {
        console.warn(`Warning: File not found: ${file}`);
      }
      return exists;
    });
  }

  /**
   * 应用排除模式
   */
  private applyExcludes(files: string[], excludes?: string[]): string[] {
    if (!excludes || excludes.length === 0) {
      return files;
    }
    return micromatch.not(files, excludes);
  }
}
```

---

#### 模块 2: OutputPathResolver

**职责**: 输出路径解析和管理

```typescript
// src/cli/utils/output-path-resolver.ts

export interface OutputPathOptions {
  name?: string;           // 输出文件名（不带扩展名）
  output?: string;         // 完整输出路径（向后兼容）
}

export interface ResolvedPaths {
  dir: string;             // 输出目录
  name: string;            // 文件名（不带扩展名）
  paths: {
    puml: string;
    png: string;
    svg: string;
    json: string;
  };
}

export class OutputPathResolver {
  constructor(private config: ArchGuardConfig) {}

  /**
   * 解析输出路径
   * 优先级: options.output > options.name > config.output > 默认
   */
  resolve(options: OutputPathOptions): ResolvedPaths {
    let baseDir: string;
    let fileName: string;

    // 1. 完整路径模式（向后兼容）
    if (options.output) {
      const parsed = path.parse(options.output);
      baseDir = parsed.dir || this.config.outputDir || './archguard';
      fileName = parsed.name;
    }
    // 2. 文件名模式（新功能）
    else if (options.name) {
      const parts = options.name.split('/');
      fileName = parts.pop()!;
      const subDir = parts.length > 0 ? parts.join('/') : '';
      baseDir = path.join(
        this.config.outputDir || './archguard',
        subDir
      );
    }
    // 3. 配置文件指定
    else if (this.config.output) {
      const parsed = path.parse(this.config.output);
      baseDir = parsed.dir || this.config.outputDir || './archguard';
      fileName = parsed.name;
    }
    // 4. 默认值
    else {
      baseDir = this.config.outputDir || './archguard';
      fileName = 'architecture';
    }

    // 规范化路径
    baseDir = path.resolve(baseDir);

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

  /**
   * 确保输出目录存在
   */
  async ensureDirectory(dir?: string): Promise<void> {
    const targetDir = dir || this.config.outputDir || './archguard';
    await fs.ensureDir(path.resolve(targetDir));
  }
}
```

---

#### 模块 3: BatchProcessor

**职责**: 批量分析和索引生成

```typescript
// src/cli/utils/batch-processor.ts

export interface BatchProcessorOptions {
  sources: string[];
  config: ArchGuardConfig;
  parser: ParallelParser;
  generator: PlantUMLGenerator;
  progress: ProgressReporter;
  generateIndex?: boolean;
}

export interface BatchResult {
  module: string;
  source: string;
  entities: number;
  relations: number;
  outputPath: string;
  success: boolean;
  error?: Error;
}

export class BatchProcessor {
  constructor(private options: BatchProcessorOptions) {}

  /**
   * 执行批量分析
   */
  async processBatch(): Promise<BatchResult[]> {
    const results: BatchResult[] = [];

    for (const source of this.options.sources) {
      const moduleName = this.inferModuleName(source);
      this.options.progress.start(`Analyzing ${moduleName}...`);

      try {
        const result = await this.processModule(source, moduleName);
        results.push(result);

        this.options.progress.succeed(
          `Generated ${moduleName}: ${result.outputPath}`
        );
      } catch (error) {
        results.push({
          module: moduleName,
          source,
          entities: 0,
          relations: 0,
          outputPath: '',
          success: false,
          error: error as Error
        });

        this.options.progress.fail(
          `Failed to analyze ${moduleName}: ${(error as Error).message}`
        );
      }
    }

    // 生成索引
    if (this.options.generateIndex !== false) {
      await this.generateIndex(results);
    }

    return results;
  }

  /**
   * 处理单个模块
   */
  private async processModule(
    source: string,
    moduleName: string
  ): Promise<BatchResult> {
    // 发现文件
    const files = await globby([
      `${path.resolve(source)}/**/*.ts`,
      `!**/*.test.ts`,
      `!**/*.spec.ts`,
      ...this.buildExcludePatterns()
    ]);

    if (files.length === 0) {
      throw new Error(`No TypeScript files found in ${source}`);
    }

    // 解析
    const archJSON = await this.options.parser.parseFiles(files);

    // 生成输出
    const pathResolver = new OutputPathResolver(this.options.config);
    const paths = pathResolver.resolve({ name: `modules/${moduleName}` });

    await this.options.generator.generateAndRender(archJSON, paths);

    return {
      module: moduleName,
      source,
      entities: archJSON.entities.length,
      relations: archJSON.relations.length,
      outputPath: paths.paths.png,
      success: true
    };
  }

  /**
   * 推断模块名
   */
  private inferModuleName(sourcePath: string): string {
    // "./packages/frontend/src" -> "frontend"
    // "./services/auth-service" -> "auth-service"
    const parts = sourcePath
      .split('/')
      .filter(p => p && p !== '.' && p !== 'src' && p !== 'dist');

    return parts[parts.length - 1] || 'module';
  }

  /**
   * 生成索引页面
   */
  private async generateIndex(results: BatchResult[]): Promise<void> {
    const indexGenerator = new IndexGenerator(this.options.config);
    await indexGenerator.generate(results);
  }

  private buildExcludePatterns(): string[] {
    return (this.options.config.exclude || []).map(p => `!${p}`);
  }
}
```

---

#### 模块 4: IndexGenerator

**职责**: 生成批量分析的索引页面

```typescript
// src/cli/utils/index-generator.ts

export class IndexGenerator {
  constructor(private config: ArchGuardConfig) {}

  /**
   * 生成索引 Markdown
   */
  async generate(results: BatchResult[]): Promise<void> {
    const outputDir = this.config.outputDir || './archguard';
    const indexPath = path.join(outputDir, 'index.md');

    const content = this.buildIndexContent(results);
    await fs.writeFile(indexPath, content);

    console.log(`\nℹ Generated index: ${indexPath}`);
  }

  /**
   * 构建索引内容
   */
  private buildIndexContent(results: BatchResult[]): string {
    const timestamp = new Date().toISOString();
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const totalEntities = successful.reduce((sum, r) => sum + r.entities, 0);
    const totalRelations = successful.reduce((sum, r) => sum + r.relations, 0);

    let content = `# Architecture Diagrams Index

**Generated**: ${timestamp}
**Total Modules**: ${results.length} (${successful.length} successful, ${failed.length} failed)

---

## Modules

`;

    // 成功的模块
    for (const result of successful) {
      const relativePath = path.relative(
        this.config.outputDir || './archguard',
        result.outputPath
      );

      content += `### ${result.module}

- **Source**: \`${result.source}\`
- **Entities**: ${result.entities}
- **Relations**: ${result.relations}
- **Complexity**: ${this.calculateComplexity(result)}
- **Diagram**: [View PNG](${relativePath})

![${result.module}](${relativePath})

---

`;
    }

    // 失败的模块
    if (failed.length > 0) {
      content += `## Failed Modules

`;
      for (const result of failed) {
        content += `### ${result.module}

- **Source**: \`${result.source}\`
- **Error**: ${result.error?.message || 'Unknown error'}

---

`;
      }
    }

    // 统计摘要
    content += `## Summary Statistics

- **Total Modules**: ${results.length}
- **Successful**: ${successful.length}
- **Failed**: ${failed.length}
- **Total Entities**: ${totalEntities}
- **Total Relations**: ${totalRelations}
- **Average Entities per Module**: ${(totalEntities / successful.length).toFixed(1)}
- **Average Relations per Module**: ${(totalRelations / successful.length).toFixed(1)}

---

## Insights

${this.generateInsights(successful)}

---

*Generated by ArchGuard v${require('../../../package.json').version}*
`;

    return content;
  }

  /**
   * 计算复杂度评级
   */
  private calculateComplexity(result: BatchResult): string {
    const score = result.entities + result.relations * 0.5;

    if (score < 20) return 'Low';
    if (score < 50) return 'Medium';
    if (score < 100) return 'High';
    return 'Very High';
  }

  /**
   * 生成洞察
   */
  private generateInsights(results: BatchResult[]): string {
    const insights: string[] = [];

    // 最复杂的模块
    const mostComplex = results.reduce((max, r) =>
      (r.entities + r.relations) > (max.entities + max.relations) ? r : max
    );
    insights.push(`- **Most Complex Module**: ${mostComplex.module} (${mostComplex.entities} entities, ${mostComplex.relations} relations)`);

    // 最简单的模块
    const leastComplex = results.reduce((min, r) =>
      (r.entities + r.relations) < (min.entities + min.relations) ? r : min
    );
    insights.push(`- **Least Complex Module**: ${leastComplex.module} (${leastComplex.entities} entities, ${leastComplex.relations} relations)`);

    // 平均复杂度
    const avgEntities = results.reduce((sum, r) => sum + r.entities, 0) / results.length;
    insights.push(`- **Average Complexity**: ${avgEntities.toFixed(1)} entities per module`);

    // 建议
    if (mostComplex.entities > 50) {
      insights.push(`- **Recommendation**: Consider refactoring ${mostComplex.module} - high complexity detected`);
    }

    return insights.join('\n');
  }
}
```

---

## 2. 配置 Schema 更新

### 2.1 TypeScript 类型定义更新

```typescript
// src/types/config.ts

export interface ArchGuardConfig {
  // 多源支持：string | string[]
  source: string | string[];

  // 输出配置
  output?: string;          // 完整输出路径（向后兼容）
  outputDir?: string;       // 输出目录（默认 ./archguard）

  format: 'plantuml' | 'json' | 'svg';
  exclude?: string[];

  cli?: CLIConfig;
  cache?: CacheConfig;
  concurrency?: number;
  verbose?: boolean;
}

export interface AnalyzeOptions {
  source?: string | string[];
  output?: string;
  name?: string;            // 新增：输出文件名
  format?: 'plantuml' | 'json' | 'svg';
  exclude?: string[];
  cache?: boolean;
  concurrency?: number;
  verbose?: boolean;

  // 新增选项
  stdin?: boolean;          // STDIN 模式
  baseDir?: string;         // STDIN 基础目录
  skipMissing?: boolean;    // 跳过不存在的文件
  batch?: boolean;          // 批量模式
  batchIndex?: boolean;     // 生成批量索引（默认 true）
  separate?: boolean;       // 分离模式（为每个源生成独立图）
}
```

### 2.2 Zod Schema 更新

```typescript
// src/cli/config-loader.ts

const configSchema = z.object({
  // 多源支持
  source: z.union([
    z.string(),
    z.array(z.string())
  ]).default('./src'),

  // 输出配置
  output: z.string().optional(),
  outputDir: z.string().default('./archguard'),

  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
  exclude: z.array(z.string()).default([
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/node_modules/**'
  ]),

  cli: z.object({
    command: z.string().default('claude'),
    args: z.array(z.string()).default([]),
    timeout: z.number().default(60000)
  }).default({
    command: 'claude',
    args: [],
    timeout: 60000
  }),

  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(86400)
  }).default({
    enabled: true,
    ttl: 86400
  }),

  concurrency: z.number().optional(),
  verbose: z.boolean().optional()
});
```

---

## 3. CLI 命令参数更新

### 3.1 analyze 命令扩展

```typescript
// src/cli/commands/analyze.ts

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze TypeScript project and generate architecture diagrams')

    // 现有参数
    .option('-s, --source <paths...>', 'Source directories (can specify multiple)', ['./src'])
    .option('-o, --output <path>', 'Output file path (without extension for PlantUML)')
    .option('-f, --format <type>', 'Output format (plantuml|json|svg)', 'plantuml')
    .option('-e, --exclude <patterns...>', 'Exclude patterns')
    .option('--no-cache', 'Disable cache')
    .option('-c, --concurrency <num>', 'Parallel parsing concurrency', parseFloat)
    .option('-v, --verbose', 'Verbose output', false)
    .option('--cli-command <command>', 'Claude CLI command to use', 'claude')
    .option('--cli-args <args>', 'Additional CLI arguments (space-separated)')
    .option('--output-dir <dir>', 'Output directory for diagrams', './archguard')

    // 新增参数
    .option('--name <name>', 'Output file name (supports subdirectories, e.g., "frontend/api")')
    .option('--stdin', 'Read file list from stdin (one file per line)')
    .option('--base-dir <path>', 'Base directory for resolving relative paths in stdin', process.cwd())
    .option('--skip-missing', 'Skip files that do not exist (useful with stdin)')
    .option('--batch', 'Generate separate diagrams for each source directory')
    .option('--no-batch-index', 'Do not generate index file in batch mode')
    .option('--separate', 'Generate separate diagrams instead of merging (with batch mode)')

    .action(analyzeCommandHandler);
}
```

---

## 4. 实施步骤详细分解

### Phase 1: 多源路径支持 (2 天)

#### 任务 1.1: 更新类型定义 (2 小时)
- [ ] 更新 `src/types/config.ts` 中的 `source` 类型为 `string | string[]`
- [ ] 更新 `AnalyzeOptions` 接口
- [ ] 更新 Zod schema 支持 union 类型
- [ ] 编写类型测试用例

**验收标准**:
- TypeScript 编译通过
- Schema 验证通过 `source: string` 和 `source: string[]`

---

#### 任务 1.2: 创建 FileDiscoveryService (4 小时)
- [ ] 创建 `src/cli/utils/file-discovery-service.ts`
- [ ] 实现 `discoverFromGlob()` 方法
- [ ] 实现文件合并和去重逻辑
- [ ] 编写单元测试

**验收标准**:
- 支持单个源：`source: './src'`
- 支持多个源：`source: ['./src', './lib']`
- 文件正确去重
- 测试覆盖率 > 85%

**测试用例**:
```typescript
describe('FileDiscoveryService - Multi-source', () => {
  it('should discover files from single source', async () => {
    const service = new FileDiscoveryService();
    const files = await service.discoverFiles({
      sources: ['./fixtures/project-a']
    });
    expect(files.length).toBeGreaterThan(0);
  });

  it('should discover files from multiple sources', async () => {
    const service = new FileDiscoveryService();
    const files = await service.discoverFiles({
      sources: ['./fixtures/project-a', './fixtures/project-b']
    });
    expect(files.some(f => f.includes('project-a'))).toBe(true);
    expect(files.some(f => f.includes('project-b'))).toBe(true);
  });

  it('should deduplicate files from overlapping sources', async () => {
    const service = new FileDiscoveryService();
    const files = await service.discoverFiles({
      sources: ['./fixtures/project-a', './fixtures/project-a/src']
    });
    const uniqueFiles = [...new Set(files)];
    expect(files.length).toBe(uniqueFiles.length);
  });
});
```

---

#### 任务 1.3: 集成到 analyze 命令 (4 小时)
- [ ] 更新 `analyze.ts` 使用 FileDiscoveryService
- [ ] 支持 `-s` 重复参数
- [ ] 更新配置加载逻辑
- [ ] 编写集成测试

**验收标准**:
- CLI 参数解析正确：`-s ./a -s ./b`
- 配置文件支持数组：`{ "source": ["./a", "./b"] }`
- 集成测试通过

---

#### 任务 1.4: 文档和示例 (2 小时)
- [ ] 更新 CLAUDE.md
- [ ] 更新 README.md
- [ ] 创建使用示例
- [ ] 更新 CLI --help 输出

---

### Phase 2: 输出文件名自定义 (2 天)

#### 任务 2.1: 创建 OutputPathResolver (4 小时)
- [ ] 创建 `src/cli/utils/output-path-resolver.ts`
- [ ] 实现路径解析逻辑
- [ ] 支持子目录（`frontend/api`）
- [ ] 实现目录自动创建
- [ ] 编写单元测试

**验收标准**:
- 路径优先级正确：CLI > config > default
- 支持子目录创建
- 测试覆盖率 > 90%

**测试用例**:
```typescript
describe('OutputPathResolver', () => {
  it('should use default output name', () => {
    const resolver = new OutputPathResolver({ outputDir: './archguard' });
    const result = resolver.resolve({});
    expect(result.name).toBe('architecture');
    expect(result.dir).toMatch(/archguard$/);
  });

  it('should use custom name', () => {
    const resolver = new OutputPathResolver({ outputDir: './archguard' });
    const result = resolver.resolve({ name: 'my-project' });
    expect(result.name).toBe('my-project');
    expect(result.paths.png).toMatch(/my-project\.png$/);
  });

  it('should support subdirectories in name', () => {
    const resolver = new OutputPathResolver({ outputDir: './archguard' });
    const result = resolver.resolve({ name: 'services/auth' });
    expect(result.name).toBe('auth');
    expect(result.dir).toMatch(/archguard[/\\]services$/);
  });

  it('should prioritize CLI option over config', () => {
    const resolver = new OutputPathResolver({
      outputDir: './archguard',
      output: './config-output.puml'
    });
    const result = resolver.resolve({ output: './cli-output' });
    expect(result.name).toBe('cli-output');
  });
});
```

---

#### 任务 2.2: 集成到生成器 (3 小时)
- [ ] 更新 PlantUMLGenerator 使用 OutputPathResolver
- [ ] 更新 analyze 命令传递 name 参数
- [ ] 添加 `--name` CLI 参数
- [ ] 编写集成测试

---

#### 任务 2.3: 文档更新 (1 小时)
- [ ] 更新使用文档
- [ ] 添加示例
- [ ] 更新 --help 输出

---

### Phase 3: STDIN 文件列表支持 (3 天)

#### 任务 3.1: 实现 STDIN 读取器 (4 小时)
- [ ] 在 FileDiscoveryService 中实现 `discoverFromStdin()`
- [ ] 实现 `readStdin()` 方法
- [ ] 实现路径解析（相对/绝对）
- [ ] 实现文件验证
- [ ] 编写单元测试

**测试用例**:
```typescript
describe('FileDiscoveryService - STDIN', () => {
  it('should parse file list from stdin', async () => {
    const mockStdin = createMockReadable([
      'src/a.ts\n',
      'src/b.ts\n',
      '# comment\n',
      'src/c.ts\n'
    ]);

    const service = new FileDiscoveryService();
    const files = await service.discoverFromStdin({
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
    const mockStdin = createMockReadable([
      '/absolute/a.ts\n',
      'relative/b.ts\n'
    ]);

    const service = new FileDiscoveryService();
    const files = await service.discoverFromStdin({
      stdin: mockStdin,
      baseDir: '/project'
    });

    expect(files).toContain('/absolute/a.ts');
    expect(files).toContain('/project/relative/b.ts');
  });

  it('should skip missing files when skipMissing is true', async () => {
    const mockStdin = createMockReadable([
      'existing.ts\n',
      'missing.ts\n'
    ]);

    // Mock fs.existsSync
    jest.spyOn(fs, 'existsSync').mockImplementation((file) =>
      file.toString().includes('existing')
    );

    const service = new FileDiscoveryService();
    const files = await service.discoverFromStdin({
      stdin: mockStdin,
      skipMissing: true
    });

    expect(files).toEqual([expect.stringContaining('existing.ts')]);
  });
});
```

---

#### 任务 3.2: CLI 集成 (3 小时)
- [ ] 添加 `--stdin`, `--base-dir`, `--skip-missing` 参数
- [ ] 更新 analyze 命令处理 STDIN 模式
- [ ] 添加模式互斥逻辑（stdin vs sources）
- [ ] 编写 E2E 测试

---

#### 任务 3.3: Git 集成测试 (2 小时)
- [ ] 编写 Git 集成测试脚本
- [ ] 测试 `git diff | archguard`
- [ ] 测试 `git ls-files | archguard`
- [ ] 验证增量分析场景

---

#### 任务 3.4: 文档和示例 (1 小时)
- [ ] 编写 STDIN 使用指南
- [ ] 创建 Git 集成示例
- [ ] 创建 CI/CD 集成示例

---

### Phase 4: 批量输出模式 (3 天)

#### 任务 4.1: 创建 BatchProcessor (6 小时)
- [ ] 创建 `src/cli/utils/batch-processor.ts`
- [ ] 实现 `processBatch()` 方法
- [ ] 实现 `processModule()` 方法
- [ ] 实现 `inferModuleName()` 方法
- [ ] 编写单元测试

**测试用例**:
```typescript
describe('BatchProcessor', () => {
  it('should infer module name from path', () => {
    const processor = new BatchProcessor({...});

    expect(processor.inferModuleName('./packages/frontend/src')).toBe('frontend');
    expect(processor.inferModuleName('./services/auth-service')).toBe('auth-service');
    expect(processor.inferModuleName('./src')).toBe('src');
  });

  it('should process multiple modules', async () => {
    const processor = new BatchProcessor({
      sources: ['./fixtures/module-a', './fixtures/module-b'],
      ...
    });

    const results = await processor.processBatch();

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it('should handle module processing errors gracefully', async () => {
    const processor = new BatchProcessor({
      sources: ['./fixtures/valid', './fixtures/invalid'],
      ...
    });

    const results = await processor.processBatch();

    expect(results).toHaveLength(2);
    expect(results.some(r => r.success)).toBe(true);
    expect(results.some(r => !r.success)).toBe(true);
  });
});
```

---

#### 任务 4.2: 创建 IndexGenerator (4 小时)
- [ ] 创建 `src/cli/utils/index-generator.ts`
- [ ] 实现 Markdown 生成逻辑
- [ ] 实现复杂度计算
- [ ] 实现洞察生成
- [ ] 编写单元测试

---

#### 任务 4.3: CLI 集成 (2 小时)
- [ ] 添加 `--batch` 和 `--batch-index` 参数
- [ ] 更新 analyze 命令逻辑
- [ ] 添加批量模式进度报告
- [ ] 编写 E2E 测试

---

#### 任务 4.4: 文档和示例 (2 小时)
- [ ] 编写批量模式使用指南
- [ ] 创建 Monorepo 示例
- [ ] 创建微服务示例
- [ ] 更新 CLAUDE.md

---

## 5. 依赖关系图

```
Phase 1 (多源支持)
│
├─ 完成后可并行进行 Phase 2 和 Phase 3
│
Phase 2 (输出自定义) ─┐
                     ├─ Phase 4 依赖 Phase 2
Phase 3 (STDIN 支持) ─┘
│
└─> Phase 4 (批量模式)
    └─> 需要 Phase 2 的 OutputPathResolver
```

**关键依赖**:
- Phase 4 依赖 Phase 2 的 OutputPathResolver
- Phase 1-3 可以部分并行开发
- 建议顺序: Phase 1 → Phase 2 & Phase 3 (并行) → Phase 4

---

## 6. 测试策略

### 6.1 单元测试覆盖率目标

| 模块 | 目标覆盖率 | 关键测试点 |
|------|-----------|-----------|
| FileDiscoveryService | ≥ 85% | 多源合并、STDIN 解析、路径验证 |
| OutputPathResolver | ≥ 90% | 优先级、子目录、路径规范化 |
| BatchProcessor | ≥ 80% | 模块处理、错误处理、并发 |
| IndexGenerator | ≥ 85% | Markdown 生成、洞察算法 |

---

### 6.2 集成测试场景

| 场景 | 描述 | 预期结果 |
|------|------|---------|
| 多源分析 | `-s ./a -s ./b` | 合并两个目录的文件，生成单个图 |
| STDIN 模式 | `echo "file.ts" \| archguard --stdin` | 分析指定文件 |
| 批量模式 | `-s ./a -s ./b --batch` | 生成两个独立的图 + 索引 |
| Git 集成 | `git ls-files \| archguard --stdin` | 只分析版本控制中的文件 |
| 输出自定义 | `--name frontend/api` | 输出到 archguard/frontend/api.png |

---

### 6.3 E2E 测试清单

- [ ] Monorepo 项目批量分析
- [ ] 微服务架构分析
- [ ] Git 增量分析
- [ ] CI/CD 集成场景
- [ ] 大型项目性能测试 (500+ 文件)

---

## 7. 质量门控

### 7.1 代码质量

- [ ] TypeScript 编译无错误
- [ ] ESLint 检查通过（0 errors, < 5 warnings）
- [ ] Prettier 格式检查通过
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 集成测试全部通过
- [ ] E2E 测试覆盖主要场景

---

### 7.2 功能验收

**Phase 1 验收**:
- [ ] 支持 `source: string[]` 配置
- [ ] 支持 `-s` 重复参数
- [ ] 文件正确合并和去重
- [ ] 向后兼容单一 source

**Phase 2 验收**:
- [ ] `--name` 参数正常工作
- [ ] 支持子目录（`--name frontend/api`）
- [ ] 输出目录自动创建
- [ ] 路径优先级正确

**Phase 3 验收**:
- [ ] STDIN 模式正常工作
- [ ] 支持相对和绝对路径
- [ ] `--skip-missing` 正常工作
- [ ] Git 集成测试通过

**Phase 4 验收**:
- [ ] 批量模式生成多个图
- [ ] 索引页面格式正确
- [ ] 模块名推断准确
- [ ] 错误处理完善

---

### 7.3 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 多源开销 | < 10% vs 单源 | 对比相同文件数 |
| STDIN 读取 | < 100ms (1000 files) | Benchmark |
| 批量模式 | 线性扩展 (O(n)) | 多模块性能测试 |
| 内存使用 | < 500MB (1000 files) | Memory profiling |

---

## 8. 风险管理

### 8.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 | 责任人 |
|------|------|------|----------|--------|
| 多源路径冲突 | 中 | 中 | 添加路径前缀识别，完善去重逻辑 | Dev |
| STDIN 内存溢出 | 低 | 高 | 流式处理，批量读取 | Dev |
| 批量模式超时 | 中 | 中 | 添加并行选项，优化生成逻辑 | Dev |
| 向后兼容性破坏 | 低 | 高 | 严格的兼容性测试，渐进式迁移 | QA |

---

### 8.2 进度风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 任务估算偏差 | 中 | 中 | 20% buffer，每日 standup |
| 依赖阻塞 | 低 | 中 | 并行开发 Phase 2 & 3 |
| 测试发现重大 bug | 中 | 高 | 提前集成测试，持续 QA |

---

### 8.3 用户采用风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 学习曲线增加 | 中 | 中 | 丰富文档，提供示例，默认值友好 |
| 配置复杂度 | 低 | 低 | 渐进式采用，向后兼容 |
| 迁移成本 | 低 | 低 | 100% 向后兼容，无需迁移 |

---

## 9. 资源需求

### 9.1 人力资源

| 角色 | 投入 | 职责 |
|------|------|------|
| 开发工程师 | 100% | 核心功能开发 |
| QA 工程师 | 30% | 测试用例编写和执行 |
| 技术负责人 | 20% | Code Review，架构决策 |

---

### 9.2 时间资源

| Phase | 开发 | 测试 | Review | 总计 |
|-------|------|------|--------|------|
| Phase 1 | 1.5 天 | 0.3 天 | 0.2 天 | 2 天 |
| Phase 2 | 1.5 天 | 0.3 天 | 0.2 天 | 2 天 |
| Phase 3 | 2 天 | 0.5 天 | 0.5 天 | 3 天 |
| Phase 4 | 2 天 | 0.5 天 | 0.5 天 | 3 天 |
| **总计** | **7 天** | **1.6 天** | **1.4 天** | **10 天** |

**Buffer**: 20% (2 天)
**总预估**: 12 个工作日

---

## 10. 发布计划

### 10.1 版本规划

**v1.2.0-alpha.1** (Phase 1 完成后)
- 多源路径支持
- 内部测试版

**v1.2.0-beta.1** (Phase 1-2 完成后)
- 多源支持 + 输出自定义
- 社区 Beta 测试

**v1.2.0-rc.1** (Phase 1-3 完成后)
- 多源 + 输出 + STDIN 支持
- Release Candidate

**v1.2.0** (全部完成)
- 完整功能发布
- 包含批量模式

---

### 10.2 发布检查清单

**代码质量**:
- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] E2E 测试通过
- [ ] Code Review 完成
- [ ] 安全审计通过

**文档**:
- [ ] CHANGELOG.md 更新
- [ ] README.md 更新
- [ ] CLAUDE.md 更新
- [ ] API 文档更新
- [ ] 迁移指南准备

**性能**:
- [ ] 性能基准测试通过
- [ ] 内存泄漏检查通过
- [ ] 大规模项目测试通过

**兼容性**:
- [ ] 向后兼容性测试通过
- [ ] 跨平台测试 (Linux, macOS, Windows)
- [ ] Node.js 版本兼容性测试

---

## 11. 里程碑

| 里程碑 | 目标日期 | 交付物 | 状态 |
|--------|---------|--------|------|
| M1: Phase 1 完成 | Day 2 | 多源支持 + 测试 | ⏳ Pending |
| M2: Phase 2 完成 | Day 4 | 输出自定义 + 测试 | ⏳ Pending |
| M3: Phase 3 完成 | Day 7 | STDIN 支持 + 测试 | ⏳ Pending |
| M4: Phase 4 完成 | Day 10 | 批量模式 + 测试 | ⏳ Pending |
| M5: Beta 发布 | Day 11 | v1.2.0-beta.1 | ⏳ Pending |
| M6: 正式发布 | Day 12 | v1.2.0 | ⏳ Pending |

---

## 12. 沟通计划

### 12.1 每日 Standup

**时间**: 每天 10:00 AM
**时长**: 15 分钟
**参与**: 开发、QA、技术负责人

**议程**:
1. 昨天完成了什么？
2. 今天计划做什么？
3. 有什么阻碍？

---

### 12.2 每周 Review

**时间**: 每周五 3:00 PM
**时长**: 1 小时
**参与**: 全体团队

**议程**:
1. 本周进度回顾
2. 下周计划
3. 风险和问题讨论
4. 决策和行动项

---

### 12.3 里程碑 Demo

**时间**: 每个 Phase 完成后
**时长**: 30 分钟
**参与**: 团队 + 利益相关方

**内容**:
1. 功能演示
2. 测试结果展示
3. 下一步计划

---

## 13. 成功度量

### 13.1 定量指标

- ✅ 测试覆盖率 ≥ 80%
- ✅ 所有质量门控通过
- ✅ 性能指标达标
- ✅ 向后兼容性 = 100%
- ✅ 按时交付率 ≥ 90%

---

### 13.2 定性指标

- ✅ 代码可读性和可维护性良好
- ✅ 文档完整准确
- ✅ 用户体验提升明显
- ✅ 团队成员满意度高

---

## 附录 A: 文件清单

### 新增文件

```
src/cli/utils/
├── file-discovery-service.ts        # 文件发现服务
├── output-path-resolver.ts          # 输出路径解析
├── batch-processor.ts               # 批量处理器
└── index-generator.ts               # 索引生成器

tests/unit/cli/utils/
├── file-discovery-service.test.ts
├── output-path-resolver.test.ts
├── batch-processor.test.ts
└── index-generator.test.ts

tests/integration/
├── multi-source.test.ts             # 多源集成测试
├── stdin-input.test.ts              # STDIN 集成测试
└── batch-mode.test.ts               # 批量模式测试

tests/e2e/
├── monorepo-analysis.test.ts        # Monorepo E2E
├── microservices-analysis.test.ts   # 微服务 E2E
└── git-integration.test.ts          # Git 集成 E2E
```

### 修改文件

```
src/types/config.ts                  # 类型定义更新
src/cli/config-loader.ts             # Schema 更新
src/cli/commands/analyze.ts          # 命令更新
CLAUDE.md                            # 文档更新
README.md                            # 文档更新
```

---

## 附录 B: 参考资料

- [Proposal 07: Advanced CLI Features](../proposals/07-advanced-cli-features.md)
- [RLM 方法论文档](../proposals/README.md#rlm-方法论说明)
- [ArchGuard 架构文档](../../architecture.md)
- [Testing Strategy](../proposals/00-implementation-roadmap.md#测试策略)

---

**文档作者**: Claude Code (AI Assistant)
**最后更新**: 2026-01-25
**文档状态**: ✅ 完成
**下一步**: 提交 PR 进行评审，启动 Sprint 规划
