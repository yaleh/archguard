# Phase 3: CLI 开发与系统优化 (TDD)

**计划名称**: ArchGuard CLI & 系统优化实施计划
**阶段**: Phase 3 - CLI Development & Optimization
**方法论**: RLM (Refactoring Lifecycle Management) + TDD
**预计时间**: 2-3 天
**依赖**: Phase 1 (代码指纹) + Phase 2 (AI 生成) 完成
**创建日期**: 2026-01-25

---

## 📋 目录

1. [RLM PROPOSAL - 阶段提案](#1-rlm-proposal---阶段提案)
2. [RLM PLANNING - 计划阶段](#2-rlm-planning---计划阶段)
3. [RLM EXECUTION - 执行阶段](#3-rlm-execution---执行阶段)
4. [RLM VALIDATION - 验证阶段](#4-rlm-validation---验证阶段)
5. [RLM INTEGRATION - 集成阶段](#5-rlm-integration---集成阶段)
6. [RLM MONITORING - 监控阶段](#6-rlm-monitoring---监控阶段)

---

## 1. RLM PROPOSAL - 阶段提案

### 1.1 问题陈述

**当前状态**:
- ✅ Phase 1: 代码指纹提取功能已实现
- ✅ Phase 2: Claude AI 集成已完成
- ❌ 缺少用户友好的命令行界面
- ❌ 没有性能优化和缓存机制
- ❌ 错误提示不够清晰
- ❌ 缺少进度反馈

**目标用户痛点**:
1. **CLI 体验差**: 需要编程方式调用，不适合日常使用
2. **性能问题**: 重复解析相同文件浪费时间
3. **反馈不足**: 长时间运行时用户不知道进度
4. **错误不友好**: 技术性错误信息难以理解

### 1.2 提案目标

**核心目标**: 提供专业、高效、用户友好的命令行工具

**具体目标**:
1. **CLI 命令** (Priority: High)
   - 实现 `archguard analyze` 命令
   - 支持多种输出格式 (PlantUML, JSON, SVG)
   - 提供配置文件支持

2. **性能优化** (Priority: High)
   - 文件解析结果缓存
   - 增量更新机制
   - 并行处理支持

3. **用户体验** (Priority: Medium)
   - 实时进度显示
   - 美观的输出格式
   - 清晰的错误提示

4. **高级特性** (Priority: Low)
   - 交互式配置向导
   - 插件系统基础
   - 多项目批处理

### 1.3 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| CLI 可用性 | 100% | 功能测试 |
| 完整流程时间 | < 10s | 性能测试 (ArchGuard 项目) |
| 缓存命中率 | > 80% | 缓存统计 |
| 用户满意度 | ≥ 4.5/5 | 用户反馈 |
| 错误可理解性 | 100% | 人工评估 |

### 1.4 技术栈

**核心库**:
```json
{
  "dependencies": {
    "commander": "^11.1.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.1",
    "inquirer": "^9.2.12",
    "cli-table3": "^0.6.3",
    "fast-glob": "^3.3.2"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "vitest": "^1.0.4"
  }
}
```

**功能映射**:
- **commander**: CLI 框架
- **chalk**: 彩色输出
- **ora**: 进度指示器
- **inquirer**: 交互式提示
- **cli-table3**: 表格输出
- **fast-glob**: 快速文件匹配

---

## 2. RLM PLANNING - 计划阶段

### 2.1 Story 划分

#### Story 1: 基础 CLI 框架 (Day 1 上午)
**User Story**: 作为开发者，我想通过命令行执行代码分析，以便快速生成架构文档

**TDD 测试用例**:
```typescript
// tests/cli/command.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { createCLI } from '@/cli/index';

describe('Story 1: Basic CLI Framework', () => {
  it('should register analyze command', () => {
    const program = createCLI();
    const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');

    expect(analyzeCmd).toBeDefined();
    expect(analyzeCmd?.description()).toContain('Analyze TypeScript project');
  });

  it('should accept source directory option', async () => {
    const program = createCLI();
    const mockAnalyze = vi.fn();

    program.commands[0].action(mockAnalyze);
    await program.parseAsync(['node', 'cli', 'analyze', '-s', './src']);

    expect(mockAnalyze).toHaveBeenCalledWith(
      expect.objectContaining({ source: './src' })
    );
  });

  it('should accept output file option', async () => {
    const program = createCLI();
    const mockAnalyze = vi.fn();

    program.commands[0].action(mockAnalyze);
    await program.parseAsync(['node', 'cli', 'analyze', '-o', 'output.puml']);

    expect(mockAnalyze).toHaveBeenCalledWith(
      expect.objectContaining({ output: 'output.puml' })
    );
  });

  it('should support format option (plantuml, json, svg)', async () => {
    const program = createCLI();
    const mockAnalyze = vi.fn();

    program.commands[0].action(mockAnalyze);
    await program.parseAsync(['node', 'cli', 'analyze', '-f', 'json']);

    expect(mockAnalyze).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'json' })
    );
  });

  it('should show version', () => {
    const program = createCLI();
    expect(program.version()).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

**验收标准**:
- ✅ `archguard --version` 显示版本号
- ✅ `archguard --help` 显示帮助信息
- ✅ `archguard analyze --help` 显示分析命令帮助
- ✅ 支持 `-s/--source` 选项
- ✅ 支持 `-o/--output` 选项
- ✅ 支持 `-f/--format` 选项 (plantuml/json/svg)

---

#### Story 2: 进度显示 (Day 1 下午)
**User Story**: 作为用户，我想看到实时进度，以便了解分析进展

**TDD 测试用例**:
```typescript
// tests/cli/progress.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressReporter } from '@/cli/progress';

describe('Story 2: Progress Display', () => {
  let reporter: ProgressReporter;

  beforeEach(() => {
    reporter = new ProgressReporter();
  });

  it('should start spinner with message', () => {
    const spinnerSpy = vi.spyOn(reporter['spinner'], 'start');
    reporter.start('Parsing files...');

    expect(spinnerSpy).toHaveBeenCalledWith('Parsing files...');
  });

  it('should update progress with count', () => {
    reporter.start('Parsing files...');
    reporter.update(10, 50); // 10 of 50 files

    expect(reporter['spinner'].text).toContain('10/50');
    expect(reporter['spinner'].text).toContain('20%');
  });

  it('should succeed with message', () => {
    const succeedSpy = vi.spyOn(reporter['spinner'], 'succeed');
    reporter.start('Parsing files...');
    reporter.succeed('Parsed 50 files');

    expect(succeedSpy).toHaveBeenCalledWith('Parsed 50 files');
  });

  it('should fail with error message', () => {
    const failSpy = vi.spyOn(reporter['spinner'], 'fail');
    reporter.start('Parsing files...');
    reporter.fail('Failed to parse: syntax error');

    expect(failSpy).toHaveBeenCalledWith('Failed to parse: syntax error');
  });

  it('should support multi-stage progress', () => {
    reporter.start('Stage 1: Parsing');
    reporter.succeed('Parsed 50 files');

    reporter.start('Stage 2: Analyzing');
    reporter.succeed('Analyzed 50 files');

    reporter.start('Stage 3: Generating');
    reporter.succeed('Generated PlantUML diagram');

    expect(reporter.getStages()).toHaveLength(3);
    expect(reporter.getStages().every(s => s.status === 'success')).toBe(true);
  });
});
```

**验收标准**:
- ✅ 显示旋转加载指示器
- ✅ 显示当前阶段名称
- ✅ 显示进度百分比 (x/y files)
- ✅ 成功时显示 ✓ 绿色消息
- ✅ 失败时显示 ✗ 红色消息
- ✅ 支持多阶段进度展示

---

#### Story 3: 缓存机制 (Day 2 上午)
**User Story**: 作为用户，我想重复分析时更快，以便提高工作效率

**TDD 测试用例**:
```typescript
// tests/cache/cache-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheManager } from '@/cache/cache-manager';
import { ArchJSON } from '@/types/arch-json';
import fs from 'fs-extra';
import path from 'path';

describe('Story 3: Cache Mechanism', () => {
  let cache: CacheManager;
  const cacheDir = path.join(__dirname, '.test-cache');

  beforeEach(() => {
    cache = new CacheManager(cacheDir);
  });

  afterEach(async () => {
    await fs.remove(cacheDir);
  });

  it('should compute file hash', async () => {
    const filePath = path.join(__dirname, 'fixtures/sample.ts');
    const hash1 = await cache.computeFileHash(filePath);
    const hash2 = await cache.computeFileHash(filePath);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256
  });

  it('should cache parsed result', async () => {
    const filePath = 'src/services/user.ts';
    const hash = 'abc123';
    const result: Partial<ArchJSON> = {
      entities: [{ id: '1', name: 'UserService', type: 'class' }]
    };

    await cache.set(filePath, hash, result);
    const cached = await cache.get(filePath, hash);

    expect(cached).toEqual(result);
  });

  it('should invalidate cache when file changes', async () => {
    const filePath = 'src/services/user.ts';
    const oldHash = 'abc123';
    const newHash = 'def456';
    const result = { entities: [] };

    await cache.set(filePath, oldHash, result);
    const cached = await cache.get(filePath, newHash);

    expect(cached).toBeNull(); // Different hash = cache miss
  });

  it('should support cache clearing', async () => {
    await cache.set('file1.ts', 'hash1', { entities: [] });
    await cache.set('file2.ts', 'hash2', { entities: [] });

    await cache.clear();

    const cached1 = await cache.get('file1.ts', 'hash1');
    const cached2 = await cache.get('file2.ts', 'hash2');
    expect(cached1).toBeNull();
    expect(cached2).toBeNull();
  });

  it('should report cache statistics', async () => {
    await cache.set('file1.ts', 'hash1', { entities: [] });
    await cache.get('file1.ts', 'hash1'); // Hit
    await cache.get('file2.ts', 'hash2'); // Miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });
});
```

**验收标准**:
- ✅ 使用文件内容 SHA-256 作为缓存键
- ✅ 缓存到 `~/.archguard/cache` 目录
- ✅ 文件未修改时读取缓存
- ✅ 文件修改后重新解析
- ✅ 提供 `--no-cache` 选项禁用缓存
- ✅ 提供 `archguard cache clear` 命令

---

#### Story 4: 错误处理优化 (Day 2 下午)
**User Story**: 作为用户，我想看到清晰的错误信息，以便快速定位问题

**TDD 测试用例**:
```typescript
// tests/cli/error-handler.test.ts
import { describe, it, expect } from 'vitest';
import { ErrorHandler } from '@/cli/error-handler';
import { ParseError, APIError, ValidationError } from '@/errors';

describe('Story 4: Error Handling', () => {
  const handler = new ErrorHandler();

  it('should format parse error with file location', () => {
    const error = new ParseError(
      'Unexpected token',
      'src/services/user.ts',
      42
    );

    const message = handler.format(error);
    expect(message).toContain('Parse Error');
    expect(message).toContain('src/services/user.ts:42');
    expect(message).toContain('Unexpected token');
  });

  it('should format API error with retry suggestion', () => {
    const error = new APIError('Rate limit exceeded', 429);

    const message = handler.format(error);
    expect(message).toContain('API Error');
    expect(message).toContain('Rate limit exceeded');
    expect(message).toContain('Please try again later');
  });

  it('should format validation error with suggestions', () => {
    const error = new ValidationError(
      'Invalid output format: xml',
      ['plantuml', 'json', 'svg']
    );

    const message = handler.format(error);
    expect(message).toContain('Validation Error');
    expect(message).toContain('Invalid output format: xml');
    expect(message).toContain('Available: plantuml, json, svg');
  });

  it('should provide helpful suggestions for common errors', () => {
    const error = new Error('ENOENT: no such file or directory');

    const message = handler.format(error);
    expect(message).toContain('File not found');
    expect(message).toContain('Check if the path is correct');
  });

  it('should format error with colored output', () => {
    const error = new ParseError('Syntax error', 'test.ts', 10);

    const coloredMessage = handler.format(error, { color: true });
    expect(coloredMessage).toContain('\x1b[31m'); // Red color code
  });
});
```

**验收标准**:
- ✅ 解析错误显示文件和行号
- ✅ API 错误显示状态码和重试建议
- ✅ 验证错误显示有效选项列表
- ✅ 常见错误提供解决方案
- ✅ 使用彩色输出（错误红色，警告黄色）
- ✅ 提供 `--verbose` 选项显示详细堆栈

---

#### Story 5: 配置文件支持 (Day 3 上午)
**User Story**: 作为用户，我想保存配置，以便避免重复输入参数

**TDD 测试用例**:
```typescript
// tests/config/config-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '@/config/config-loader';
import fs from 'fs-extra';
import path from 'path';

describe('Story 5: Configuration File', () => {
  let loader: ConfigLoader;
  const testDir = path.join(__dirname, '.test-config');

  beforeEach(() => {
    loader = new ConfigLoader(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should load config from archguard.config.json', async () => {
    const configPath = path.join(testDir, 'archguard.config.json');
    await fs.writeJson(configPath, {
      source: './src',
      output: './docs',
      format: 'plantuml'
    });

    const config = await loader.load();
    expect(config.source).toBe('./src');
    expect(config.output).toBe('./docs');
    expect(config.format).toBe('plantuml');
  });

  it('should merge CLI options with config file', async () => {
    const configPath = path.join(testDir, 'archguard.config.json');
    await fs.writeJson(configPath, {
      source: './src',
      format: 'plantuml'
    });

    const config = await loader.load({ output: './custom.puml' });
    expect(config.source).toBe('./src'); // From config
    expect(config.output).toBe('./custom.puml'); // From CLI (overrides)
    expect(config.format).toBe('plantuml'); // From config
  });

  it('should validate config schema', async () => {
    const configPath = path.join(testDir, 'archguard.config.json');
    await fs.writeJson(configPath, {
      source: './src',
      format: 'invalid-format' // Invalid!
    });

    await expect(loader.load()).rejects.toThrow('Invalid format');
  });

  it('should support .js config file with module.exports', async () => {
    const configPath = path.join(testDir, 'archguard.config.js');
    await fs.writeFile(configPath, `
      module.exports = {
        source: './src',
        exclude: ['**/*.test.ts'],
        ai: {
          model: 'claude-3-5-sonnet-20241022',
          maxTokens: 4096
        }
      };
    `);

    const config = await loader.load();
    expect(config.source).toBe('./src');
    expect(config.exclude).toEqual(['**/*.test.ts']);
    expect(config.ai.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('should create default config with init command', async () => {
    await loader.init();

    const configPath = path.join(testDir, 'archguard.config.json');
    const exists = await fs.pathExists(configPath);
    expect(exists).toBe(true);

    const config = await fs.readJson(configPath);
    expect(config).toHaveProperty('source');
    expect(config).toHaveProperty('output');
    expect(config).toHaveProperty('format');
  });
});
```

**验收标准**:
- ✅ 支持 `archguard.config.json`
- ✅ 支持 `archguard.config.js`
- ✅ CLI 选项优先级高于配置文件
- ✅ 验证配置文件格式
- ✅ 提供 `archguard init` 生成默认配置
- ✅ 支持项目级和全局配置

**配置文件示例**:
```json
{
  "source": "./src",
  "output": "./docs/architecture.puml",
  "format": "plantuml",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ],
  "ai": {
    "model": "claude-3-5-sonnet-20241022",
    "maxTokens": 4096,
    "temperature": 0
  },
  "cache": {
    "enabled": true,
    "ttl": 86400
  }
}
```

---

#### Story 6: 性能优化与并行处理 (Day 3 下午)
**User Story**: 作为用户，我想大项目分析更快，以便提高效率

**TDD 测试用例**:
```typescript
// tests/performance/parallel-parser.test.ts
import { describe, it, expect } from 'vitest';
import { ParallelParser } from '@/parser/parallel-parser';
import { performance } from 'perf_hooks';

describe('Story 6: Performance Optimization', () => {
  it('should parse multiple files in parallel', async () => {
    const parser = new ParallelParser({ concurrency: 4 });
    const files = [
      'src/services/user.ts',
      'src/services/auth.ts',
      'src/controllers/user.controller.ts',
      'src/controllers/auth.controller.ts'
    ];

    const results = await parser.parseFiles(files);
    expect(results).toHaveLength(4);
    expect(results.every(r => r.entities.length > 0)).toBe(true);
  });

  it('should be faster than sequential parsing', async () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);

    // Sequential
    const seqParser = new ParallelParser({ concurrency: 1 });
    const seqStart = performance.now();
    await seqParser.parseFiles(files);
    const seqTime = performance.now() - seqStart;

    // Parallel
    const parParser = new ParallelParser({ concurrency: 4 });
    const parStart = performance.now();
    await parParser.parseFiles(files);
    const parTime = performance.now() - parStart;

    expect(parTime).toBeLessThan(seqTime * 0.7); // At least 30% faster
  });

  it('should limit concurrency to avoid memory issues', async () => {
    const parser = new ParallelParser({ concurrency: 2 });
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    parser.on('task:start', () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
    });

    parser.on('task:end', () => {
      currentConcurrent--;
    });

    await parser.parseFiles(files);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should report progress during parallel parsing', async () => {
    const parser = new ParallelParser({ concurrency: 4 });
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    const progressUpdates: number[] = [];

    parser.on('progress', (completed, total) => {
      progressUpdates.push(completed);
    });

    await parser.parseFiles(files);
    expect(progressUpdates).toHaveLength(10);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(10);
  });

  it('should handle errors gracefully in parallel mode', async () => {
    const parser = new ParallelParser({ concurrency: 4 });
    const files = [
      'valid1.ts',
      'invalid.ts', // Will cause parse error
      'valid2.ts'
    ];

    const results = await parser.parseFiles(files, { continueOnError: true });
    expect(results).toHaveLength(3);
    expect(results[1].error).toBeDefined();
    expect(results[0].entities).toBeDefined();
    expect(results[2].entities).toBeDefined();
  });
});
```

**验收标准**:
- ✅ 支持并行解析（默认 CPU 核心数）
- ✅ 提供 `--concurrency` 选项
- ✅ 并行模式下性能提升 ≥ 30%
- ✅ 限制并发数避免内存溢出
- ✅ 错误不影响其他文件处理
- ✅ 实时报告并行进度

---

### 2.2 实施时间表

#### Day 1: CLI 框架 + 进度显示
```
09:00 - 10:30 | 🔴 Story 1 测试编写 (CLI 框架)
10:30 - 12:00 | 🟢 Story 1 实现 (commander 集成)
12:00 - 13:00 | 午餐
13:00 - 14:30 | 🔴 Story 2 测试编写 (进度显示)
14:30 - 16:00 | 🟢 Story 2 实现 (ora + chalk)
16:00 - 17:00 | ♻️ 重构优化
17:00 - 17:30 | 手动测试 + 文档
```

**Day 1 交付物**:
- ✅ `archguard analyze` 命令可用
- ✅ 支持 `-s`, `-o`, `-f` 选项
- ✅ 实时进度指示器
- ✅ 彩色输出

---

#### Day 2: 缓存 + 错误处理
```
09:00 - 10:30 | 🔴 Story 3 测试编写 (缓存机制)
10:30 - 12:00 | 🟢 Story 3 实现 (Cache Manager)
12:00 - 13:00 | 午餐
13:00 - 14:30 | 🔴 Story 4 测试编写 (错误处理)
14:30 - 16:00 | 🟢 Story 4 实现 (Error Handler)
16:00 - 17:00 | ♻️ 重构优化
17:00 - 17:30 | 集成测试
```

**Day 2 交付物**:
- ✅ 缓存系统正常工作
- ✅ `archguard cache clear` 命令
- ✅ 友好的错误提示
- ✅ `--verbose` 调试模式

---

#### Day 3: 配置 + 性能优化
```
09:00 - 10:30 | 🔴 Story 5 测试编写 (配置文件)
10:30 - 12:00 | 🟢 Story 5 实现 (Config Loader)
12:00 - 13:00 | 午餐
13:00 - 14:30 | 🔴 Story 6 测试编写 (并行处理)
14:30 - 16:00 | 🟢 Story 6 实现 (Parallel Parser)
16:00 - 17:00 | ♻️ 最终优化 + 性能测试
17:00 - 17:30 | E2E 测试 + 文档完善
```

**Day 3 交付物**:
- ✅ `archguard init` 命令
- ✅ 配置文件支持
- ✅ 并行处理性能提升
- ✅ 完整的 CLI 文档

---

### 2.3 技术架构

#### 目录结构
```
src/
├── cli/
│   ├── index.ts              # CLI 入口
│   ├── commands/
│   │   ├── analyze.ts        # 分析命令
│   │   ├── init.ts           # 初始化命令
│   │   └── cache.ts          # 缓存管理命令
│   ├── progress.ts           # 进度报告器
│   └── error-handler.ts      # 错误处理器
├── config/
│   ├── config-loader.ts      # 配置加载器
│   └── schema.ts             # 配置验证模式
├── cache/
│   ├── cache-manager.ts      # 缓存管理器
│   └── hash.ts               # 文件哈希计算
├── parser/
│   └── parallel-parser.ts    # 并行解析器
└── errors/
    ├── parse-error.ts
    ├── api-error.ts
    └── validation-error.ts
```

#### 关键接口设计

**CLI 命令接口**:
```typescript
// src/cli/commands/analyze.ts
export interface AnalyzeOptions {
  source: string;          // 源代码目录
  output?: string;         // 输出文件路径
  format: 'plantuml' | 'json' | 'svg';
  exclude?: string[];      // 排除模式
  cache?: boolean;         // 启用缓存
  concurrency?: number;    // 并发数
  verbose?: boolean;       // 详细日志
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const reporter = new ProgressReporter();
  const cache = new CacheManager();
  const parser = new ParallelParser({
    concurrency: options.concurrency ?? os.cpus().length
  });

  try {
    // Stage 1: 收集文件
    reporter.start('Collecting files...');
    const files = await collectFiles(options.source, options.exclude);
    reporter.succeed(`Found ${files.length} files`);

    // Stage 2: 解析文件
    reporter.start('Parsing files...');
    parser.on('progress', (completed, total) => {
      reporter.update(completed, total);
    });
    const results = await parser.parseFiles(files, { cache });
    reporter.succeed(`Parsed ${results.length} files`);

    // Stage 3: 生成文档
    reporter.start('Generating documentation...');
    const output = await generateDocs(results, options.format);
    await writeOutput(output, options.output);
    reporter.succeed(`Generated ${options.format} diagram`);

  } catch (error) {
    reporter.fail(ErrorHandler.format(error));
    process.exit(1);
  }
}
```

**进度报告接口**:
```typescript
// src/cli/progress.ts
export class ProgressReporter {
  private spinner: Ora;
  private stages: Stage[] = [];

  start(message: string): void;
  update(completed: number, total: number): void;
  succeed(message: string): void;
  fail(message: string): void;
  getStages(): Stage[];
}

interface Stage {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime?: number;
  endTime?: number;
}
```

**缓存管理接口**:
```typescript
// src/cache/cache-manager.ts
export class CacheManager {
  constructor(cacheDir?: string);

  async get(filePath: string, hash: string): Promise<ArchJSON | null>;
  async set(filePath: string, hash: string, data: ArchJSON): Promise<void>;
  async clear(): Promise<void>;
  async computeFileHash(filePath: string): Promise<string>;
  getStats(): CacheStats;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalSize: number;
}
```

---

## 3. RLM EXECUTION - 执行阶段

### 3.1 TDD 开发流程

#### 红-绿-重构示例 (Story 1: CLI Framework)

**🔴 红: 编写失败的测试**
```typescript
// tests/cli/command.test.ts
it('should register analyze command', () => {
  const program = createCLI();
  const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');

  expect(analyzeCmd).toBeDefined(); // FAILS: createCLI() doesn't exist yet
});
```

**🟢 绿: 最小实现**
```typescript
// src/cli/index.ts
import { Command } from 'commander';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('archguard')
    .version('1.0.0')
    .description('ArchGuard - TypeScript Architecture Analyzer');

  program
    .command('analyze')
    .description('Analyze TypeScript project and generate architecture diagrams')
    .option('-s, --source <path>', 'Source directory', './src')
    .option('-o, --output <path>', 'Output file path')
    .option('-f, --format <type>', 'Output format (plantuml|json|svg)', 'plantuml')
    .action(async (options) => {
      console.log('Analyzing...', options);
    });

  return program;
}
```

**♻️ 重构: 提取命令处理**
```typescript
// src/cli/commands/analyze.ts
import { Command } from 'commander';

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze TypeScript project and generate architecture diagrams')
    .option('-s, --source <path>', 'Source directory', './src')
    .option('-o, --output <path>', 'Output file path')
    .option('-f, --format <type>', 'Output format', 'plantuml')
    .option('--no-cache', 'Disable cache')
    .option('-c, --concurrency <num>', 'Parallel parsing concurrency', `${os.cpus().length}`)
    .option('-v, --verbose', 'Verbose output')
    .action(analyzeCommandHandler);
}

async function analyzeCommandHandler(options: AnalyzeOptions): Promise<void> {
  // Implementation in next cycle
}
```

```typescript
// src/cli/index.ts
import { Command } from 'commander';
import { createAnalyzeCommand } from './commands/analyze';

export function createCLI(): Command {
  const program = new Command()
    .name('archguard')
    .version('1.0.0')
    .description('ArchGuard - TypeScript Architecture Analyzer');

  program.addCommand(createAnalyzeCommand());

  return program;
}
```

### 3.2 关键实现

#### 实现 1: 进度报告器 (Story 2)

```typescript
// src/cli/progress.ts
import ora, { Ora } from 'ora';
import chalk from 'chalk';

export class ProgressReporter {
  private spinner: Ora;
  private stages: Stage[] = [];
  private currentStage: Stage | null = null;

  constructor() {
    this.spinner = ora();
  }

  start(message: string): void {
    const stage: Stage = {
      name: message,
      status: 'running',
      startTime: Date.now()
    };
    this.stages.push(stage);
    this.currentStage = stage;
    this.spinner.start(chalk.cyan(message));
  }

  update(completed: number, total: number): void {
    if (!this.currentStage) return;

    const percentage = Math.round((completed / total) * 100);
    const message = `${this.currentStage.name} ${chalk.gray(`(${completed}/${total} - ${percentage}%)`)}`;
    this.spinner.text = message;
  }

  succeed(message: string): void {
    if (this.currentStage) {
      this.currentStage.status = 'success';
      this.currentStage.endTime = Date.now();
    }
    this.spinner.succeed(chalk.green(message));
  }

  fail(message: string): void {
    if (this.currentStage) {
      this.currentStage.status = 'failed';
      this.currentStage.endTime = Date.now();
    }
    this.spinner.fail(chalk.red(message));
  }

  getStages(): Stage[] {
    return this.stages;
  }

  printSummary(): void {
    console.log('\n' + chalk.bold('Summary:'));
    for (const stage of this.stages) {
      const icon = stage.status === 'success' ? '✓' : '✗';
      const color = stage.status === 'success' ? chalk.green : chalk.red;
      const duration = stage.endTime && stage.startTime
        ? `${((stage.endTime - stage.startTime) / 1000).toFixed(2)}s`
        : 'N/A';
      console.log(color(`  ${icon} ${stage.name} (${duration})`));
    }
  }
}

interface Stage {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime?: number;
  endTime?: number;
}
```

#### 实现 2: 缓存管理器 (Story 3)

```typescript
// src/cache/cache-manager.ts
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { ArchJSON } from '@/types/arch-json';

export class CacheManager {
  private cacheDir: string;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalSize: 0
  };

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? path.join(os.homedir(), '.archguard', 'cache');
  }

  async get(filePath: string, hash: string): Promise<ArchJSON | null> {
    const cacheKey = this.getCacheKey(filePath, hash);
    const cachePath = this.getCachePath(cacheKey);

    try {
      if (await fs.pathExists(cachePath)) {
        const cached = await fs.readJson(cachePath);
        this.stats.hits++;
        this.updateHitRate();
        return cached;
      }
    } catch (error) {
      // Cache read error, treat as miss
    }

    this.stats.misses++;
    this.updateHitRate();
    return null;
  }

  async set(filePath: string, hash: string, data: ArchJSON): Promise<void> {
    const cacheKey = this.getCacheKey(filePath, hash);
    const cachePath = this.getCachePath(cacheKey);

    await fs.ensureDir(path.dirname(cachePath));
    await fs.writeJson(cachePath, data, { spaces: 2 });
  }

  async clear(): Promise<void> {
    if (await fs.pathExists(this.cacheDir)) {
      await fs.remove(this.cacheDir);
    }
    this.stats = { hits: 0, misses: 0, hitRate: 0, totalSize: 0 };
  }

  async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private getCacheKey(filePath: string, hash: string): string {
    return crypto
      .createHash('md5')
      .update(`${filePath}:${hash}`)
      .digest('hex');
  }

  private getCachePath(cacheKey: string): string {
    // Split into subdirectories to avoid too many files in one dir
    const subDir = cacheKey.slice(0, 2);
    return path.join(this.cacheDir, subDir, `${cacheKey}.json`);
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalSize: number;
}
```

#### 实现 3: 错误处理器 (Story 4)

```typescript
// src/cli/error-handler.ts
import chalk from 'chalk';
import { ParseError, APIError, ValidationError } from '@/errors';

export class ErrorHandler {
  static format(error: unknown, options: { color?: boolean; verbose?: boolean } = {}): string {
    const { color = true, verbose = false } = options;

    if (error instanceof ParseError) {
      return this.formatParseError(error, color);
    }

    if (error instanceof APIError) {
      return this.formatAPIError(error, color);
    }

    if (error instanceof ValidationError) {
      return this.formatValidationError(error, color);
    }

    if (error instanceof Error) {
      return this.formatGenericError(error, color, verbose);
    }

    return String(error);
  }

  private static formatParseError(error: ParseError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('Parse Error') : 'Parse Error';
    const location = `${error.filePath}:${error.line}`;
    const locationStr = useColor ? chalk.cyan(location) : location;

    return `
${title}
  ${locationStr}
  ${error.message}

${useColor ? chalk.yellow('Tip:') : 'Tip:'} Check the syntax at the specified line.
`;
  }

  private static formatAPIError(error: APIError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('API Error') : 'API Error';
    const statusCode = useColor ? chalk.yellow(`[${error.statusCode}]`) : `[${error.statusCode}]`;

    let suggestion = '';
    if (error.statusCode === 429) {
      suggestion = 'Please try again later or check your rate limits.';
    } else if (error.statusCode === 401) {
      suggestion = 'Check your ANTHROPIC_API_KEY environment variable.';
    } else if (error.statusCode >= 500) {
      suggestion = 'Claude API service may be temporarily unavailable. Please retry.';
    }

    return `
${title} ${statusCode}
  ${error.message}

${suggestion ? (useColor ? chalk.yellow('Suggestion:') : 'Suggestion:') + ' ' + suggestion : ''}
`;
  }

  private static formatValidationError(error: ValidationError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('Validation Error') : 'Validation Error';
    const available = error.suggestions.join(', ');

    return `
${title}
  ${error.message}

${useColor ? chalk.yellow('Available options:') : 'Available options:'} ${available}
`;
  }

  private static formatGenericError(error: Error, useColor: boolean, verbose: boolean): string {
    const title = useColor ? chalk.red.bold('Error') : 'Error';

    // Provide helpful suggestions for common errors
    let suggestion = '';
    if (error.message.includes('ENOENT')) {
      suggestion = 'File or directory not found. Check if the path is correct.';
    } else if (error.message.includes('EACCES')) {
      suggestion = 'Permission denied. Check file permissions.';
    } else if (error.message.includes('EADDRINUSE')) {
      suggestion = 'Port already in use.';
    }

    const stack = verbose && error.stack ? `\n${error.stack}` : '';

    return `
${title}
  ${error.message}

${suggestion ? (useColor ? chalk.yellow('Tip:') : 'Tip:') + ' ' + suggestion : ''}${stack}
`;
  }
}
```

#### 实现 4: 配置加载器 (Story 5)

```typescript
// src/config/config-loader.ts
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';

const configSchema = z.object({
  source: z.string().default('./src'),
  output: z.string().optional(),
  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
  exclude: z.array(z.string()).default([
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/node_modules/**'
  ]),
  ai: z.object({
    model: z.string().default('claude-3-5-sonnet-20241022'),
    maxTokens: z.number().default(4096),
    temperature: z.number().min(0).max(1).default(0)
  }).optional(),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(86400) // 24 hours
  }).optional()
});

export type Config = z.infer<typeof configSchema>;

export class ConfigLoader {
  private configDir: string;

  constructor(configDir: string = process.cwd()) {
    this.configDir = configDir;
  }

  async load(cliOptions: Partial<Config> = {}): Promise<Config> {
    const fileConfig = await this.loadFromFile();
    const merged = { ...fileConfig, ...cliOptions };
    return configSchema.parse(merged);
  }

  private async loadFromFile(): Promise<Partial<Config>> {
    // Try .json first
    const jsonPath = path.join(this.configDir, 'archguard.config.json');
    if (await fs.pathExists(jsonPath)) {
      return await fs.readJson(jsonPath);
    }

    // Try .js
    const jsPath = path.join(this.configDir, 'archguard.config.js');
    if (await fs.pathExists(jsPath)) {
      const module = await import(jsPath);
      return module.default ?? module;
    }

    return {};
  }

  async init(): Promise<void> {
    const configPath = path.join(this.configDir, 'archguard.config.json');

    if (await fs.pathExists(configPath)) {
      throw new Error('Configuration file already exists');
    }

    const defaultConfig: Config = configSchema.parse({});
    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
  }
}
```

#### 实现 5: 并行解析器 (Story 6)

```typescript
// src/parser/parallel-parser.ts
import pLimit from 'p-limit';
import { EventEmitter } from 'events';
import { TypeScriptParser } from './typescript-parser';
import { CacheManager } from '@/cache/cache-manager';
import { ArchJSON } from '@/types/arch-json';

export interface ParallelParserOptions {
  concurrency?: number;
}

export interface ParseResult {
  filePath: string;
  data?: ArchJSON;
  error?: Error;
  fromCache?: boolean;
}

export class ParallelParser extends EventEmitter {
  private parser: TypeScriptParser;
  private concurrency: number;

  constructor(options: ParallelParserOptions = {}) {
    super();
    this.parser = new TypeScriptParser();
    this.concurrency = options.concurrency ?? require('os').cpus().length;
  }

  async parseFiles(
    files: string[],
    options: { cache?: CacheManager; continueOnError?: boolean } = {}
  ): Promise<ParseResult[]> {
    const { cache, continueOnError = false } = options;
    const limit = pLimit(this.concurrency);
    const results: ParseResult[] = [];

    let completed = 0;
    const total = files.length;

    const tasks = files.map((filePath) =>
      limit(async () => {
        this.emit('task:start', filePath);

        try {
          // Try cache first
          if (cache) {
            const hash = await cache.computeFileHash(filePath);
            const cached = await cache.get(filePath, hash);

            if (cached) {
              completed++;
              this.emit('progress', completed, total);
              this.emit('task:end', filePath);
              return { filePath, data: cached, fromCache: true };
            }
          }

          // Parse file
          const data = await this.parser.parseFile(filePath);

          // Store in cache
          if (cache && data) {
            const hash = await cache.computeFileHash(filePath);
            await cache.set(filePath, hash, data);
          }

          completed++;
          this.emit('progress', completed, total);
          this.emit('task:end', filePath);
          return { filePath, data };

        } catch (error) {
          completed++;
          this.emit('progress', completed, total);
          this.emit('task:end', filePath);

          if (continueOnError) {
            return { filePath, error: error as Error };
          } else {
            throw error;
          }
        }
      })
    );

    const settled = await Promise.allSettled(tasks);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else if (continueOnError) {
        results.push({
          filePath: 'unknown',
          error: result.reason
        });
      } else {
        throw result.reason;
      }
    }

    return results;
  }
}
```

---

## 4. RLM VALIDATION - 验证阶段

### 4.1 测试策略

#### 单元测试覆盖率目标

| 模块 | 目标覆盖率 | 关键测试场景 |
|------|-----------|-------------|
| CLI 命令 | ≥ 85% | 参数解析、帮助信息、错误处理 |
| 进度报告 | ≥ 80% | 进度更新、多阶段、彩色输出 |
| 缓存管理 | ≥ 90% | 读写、失效、统计 |
| 错误处理 | ≥ 95% | 各类错误格式化、建议生成 |
| 配置加载 | ≥ 85% | 文件读取、合并、验证 |
| 并行解析 | ≥ 80% | 并发控制、进度报告、错误处理 |

#### 集成测试场景

**场景 1: 完整分析流程**
```typescript
// tests/integration/analyze.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

describe('Integration: Analyze Command', () => {
  it('should analyze project and generate PlantUML', async () => {
    const output = path.join(__dirname, 'output.puml');

    execSync(`archguard analyze -s ./fixtures/sample-project -o ${output}`, {
      encoding: 'utf-8'
    });

    const exists = await fs.pathExists(output);
    expect(exists).toBe(true);

    const content = await fs.readFile(output, 'utf-8');
    expect(content).toContain('@startuml');
    expect(content).toContain('@enduml');
    expect(content).toContain('class');
  });

  it('should use cache on second run', async () => {
    const output = path.join(__dirname, 'output.puml');

    // First run
    const time1Start = Date.now();
    execSync(`archguard analyze -s ./fixtures/sample-project -o ${output}`);
    const time1 = Date.now() - time1Start;

    // Second run (with cache)
    const time2Start = Date.now();
    execSync(`archguard analyze -s ./fixtures/sample-project -o ${output}`);
    const time2 = Date.now() - time2Start;

    expect(time2).toBeLessThan(time1 * 0.5); // At least 50% faster
  });
});
```

### 4.2 性能基准测试

**测试项目**: ArchGuard 自身

```typescript
// tests/performance/benchmarks.test.ts
import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';
import { ParallelParser } from '@/parser/parallel-parser';
import { CacheManager } from '@/cache/cache-manager';
import glob from 'fast-glob';

describe('Performance Benchmarks', () => {
  it('should analyze ArchGuard project in < 10s', async () => {
    const files = await glob('src/**/*.ts', { ignore: ['**/*.test.ts'] });
    const parser = new ParallelParser({ concurrency: 4 });

    const start = performance.now();
    await parser.parseFiles(files);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(10000); // 10 seconds
    console.log(`Analyzed ${files.length} files in ${(duration / 1000).toFixed(2)}s`);
  });

  it('should achieve > 80% cache hit rate', async () => {
    const files = await glob('src/**/*.ts', { ignore: ['**/*.test.ts'] });
    const cache = new CacheManager();
    const parser = new ParallelParser({ concurrency: 4 });

    // First pass: populate cache
    await parser.parseFiles(files, { cache });

    // Second pass: measure cache hits
    await parser.parseFiles(files, { cache });
    const stats = cache.getStats();

    expect(stats.hitRate).toBeGreaterThan(0.8);
  });
});
```

### 4.3 用户验收测试

**UAT 检查清单**:

- [ ] **CLI 基础功能**
  - [ ] `archguard --version` 显示正确版本
  - [ ] `archguard --help` 显示完整帮助
  - [ ] `archguard analyze --help` 显示命令帮助

- [ ] **分析功能**
  - [ ] 分析 ArchGuard 项目成功
  - [ ] 生成的 PlantUML 可以渲染
  - [ ] 支持 JSON 输出格式
  - [ ] 排除模式正确工作

- [ ] **进度显示**
  - [ ] 显示解析进度 (x/y files)
  - [ ] 显示百分比
  - [ ] 显示旋转加载指示器
  - [ ] 成功时显示绿色 ✓

- [ ] **缓存机制**
  - [ ] 第二次运行明显更快
  - [ ] `archguard cache clear` 清除缓存
  - [ ] `--no-cache` 禁用缓存

- [ ] **错误处理**
  - [ ] 文件不存在时提示清晰
  - [ ] 语法错误显示文件和行号
  - [ ] API 错误显示状态码和建议
  - [ ] `--verbose` 显示详细堆栈

- [ ] **配置文件**
  - [ ] `archguard init` 创建配置
  - [ ] 读取 `archguard.config.json`
  - [ ] CLI 选项覆盖配置文件
  - [ ] 配置验证正常工作

- [ ] **性能**
  - [ ] ArchGuard 项目分析 < 10s
  - [ ] 并行解析性能提升明显
  - [ ] 内存使用 < 300MB

---

## 5. RLM INTEGRATION - 集成阶段

### 5.1 Git 工作流

**分支策略**:
```
master
  └── phase-3-cli-optimization
      ├── feature/cli-framework
      ├── feature/progress-display
      ├── feature/cache-mechanism
      ├── feature/error-handling
      ├── feature/config-loader
      └── feature/parallel-parser
```

**提交规范**:
```bash
# Story 1
git commit -m "test: add CLI framework tests (Story 1 - Red)"
git commit -m "feat: implement CLI framework with commander (Story 1 - Green)"
git commit -m "refactor: extract analyze command (Story 1 - Refactor)"

# Story 2
git commit -m "test: add progress reporter tests (Story 2 - Red)"
git commit -m "feat: implement progress reporter with ora (Story 2 - Green)"
git commit -m "refactor: improve progress display (Story 2 - Refactor)"
```

### 5.2 PR 模板

```markdown
## Phase 3: CLI Optimization - Story X

### 变更描述
[简要描述本次变更]

### RLM 跟踪
- **阶段**: EXECUTION → VALIDATION
- **Story**: Story X - [名称]
- **TDD 状态**: 🔴 Red → 🟢 Green → ♻️ Refactor

### 测试覆盖
- [ ] 单元测试通过 (≥ 80% 覆盖率)
- [ ] 集成测试通过
- [ ] 手动测试完成

### 验收标准
- [ ] [验收标准 1]
- [ ] [验收标准 2]

### 性能影响
- 完整流程时间: [X]s
- 缓存命中率: [X]%
- 内存使用: [X]MB

### 截图/演示
[CLI 输出截图]
```

### 5.3 合并策略

**Story 级合并**:
- 每个 Story 完成后合并到 `phase-3-cli-optimization`
- 使用 Squash Merge 保持历史清晰
- 确保所有测试通过

**Phase 级合并**:
- Phase 3 所有 Story 完成后
- 完整的性能测试和 UAT
- 合并到 `master` 使用 Merge Commit

---

## 6. RLM MONITORING - 监控阶段

### 6.1 CLI 使用监控

**监控指标**:

| 指标 | 收集方法 | 目标 |
|------|---------|------|
| 命令执行次数 | 匿名遥测 | N/A |
| 平均执行时间 | 性能日志 | < 10s |
| 缓存命中率 | 缓存统计 | > 80% |
| 错误率 | 错误日志 | < 1% |
| 用户满意度 | 反馈收集 | ≥ 4.5/5 |

**遥测数据示例** (匿名):
```json
{
  "event": "analyze_command",
  "duration": 8.5,
  "fileCount": 45,
  "cacheHitRate": 0.85,
  "format": "plantuml",
  "version": "1.0.0"
}
```

### 6.2 性能监控仪表板

**指标收集**:
```typescript
// src/telemetry/metrics.ts
export class MetricsCollector {
  async recordAnalyze(metrics: {
    duration: number;
    fileCount: number;
    cacheHitRate: number;
    format: string;
  }): Promise<void> {
    // Send to analytics (opt-in)
    if (this.isEnabled()) {
      await this.send('analyze_command', metrics);
    }
  }
}
```

### 6.3 用户反馈机制

**反馈收集**:
```bash
# 命令行反馈
archguard feedback "Great tool! Very fast."

# 自动问题报告
archguard report-issue
```

**反馈分析**:
- 每周汇总用户反馈
- 识别常见问题和改进点
- 优先级排序和迭代

---

## 附录 A: CLI 命令参考

### 主命令

```bash
# 显示版本
archguard --version

# 显示帮助
archguard --help

# 分析项目
archguard analyze [options]

# 初始化配置
archguard init

# 缓存管理
archguard cache clear
archguard cache stats
```

### analyze 命令选项

```bash
archguard analyze \
  -s, --source <path>        # 源代码目录 (默认: ./src)
  -o, --output <path>        # 输出文件路径
  -f, --format <type>        # 输出格式: plantuml|json|svg (默认: plantuml)
  -e, --exclude <patterns>   # 排除模式 (可多次使用)
  --no-cache                 # 禁用缓存
  -c, --concurrency <num>    # 并发数 (默认: CPU 核心数)
  -v, --verbose              # 详细输出
  -q, --quiet                # 静默模式
```

### 使用示例

```bash
# 基础用法
archguard analyze

# 自定义源目录和输出
archguard analyze -s ./src -o ./docs/architecture.puml

# JSON 格式输出
archguard analyze -f json -o ./architecture.json

# 排除测试文件
archguard analyze -e "**/*.test.ts" -e "**/*.spec.ts"

# 禁用缓存
archguard analyze --no-cache

# 详细模式
archguard analyze -v

# 使用配置文件
archguard init  # 创建 archguard.config.json
archguard analyze  # 使用配置文件
```

---

## 附录 B: 配置文件示例

### archguard.config.json

```json
{
  "source": "./src",
  "output": "./docs/architecture.puml",
  "format": "plantuml",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**",
    "**/__tests__/**"
  ],
  "ai": {
    "model": "claude-3-5-sonnet-20241022",
    "maxTokens": 4096,
    "temperature": 0
  },
  "cache": {
    "enabled": true,
    "ttl": 86400
  },
  "concurrency": 4,
  "verbose": false
}
```

### archguard.config.js

```javascript
module.exports = {
  source: './src',
  output: './docs/architecture.puml',
  format: 'plantuml',
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts'
  ],
  ai: {
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4096,
    temperature: 0
  },
  cache: {
    enabled: true,
    ttl: 24 * 60 * 60 // 24 hours
  }
};
```

---

## 附录 C: 故障排查

### 常见问题

**问题 1: 命令未找到**
```bash
$ archguard: command not found
```
**解决方案**:
```bash
# 全局安装
npm install -g archguard

# 或使用 npx
npx archguard analyze
```

**问题 2: API 错误 429**
```bash
API Error [429]: Rate limit exceeded
```
**解决方案**:
- 等待几分钟后重试
- 检查 API 配额
- 使用 `--concurrency 1` 降低并发

**问题 3: 内存溢出**
```bash
FATAL ERROR: Reached heap limit
```
**解决方案**:
```bash
# 增加 Node.js 内存限制
NODE_OPTIONS=--max-old-space-size=4096 archguard analyze

# 或降低并发数
archguard analyze -c 2
```

**问题 4: 缓存问题**
```bash
# 缓存过期或损坏
```
**解决方案**:
```bash
# 清除缓存
archguard cache clear

# 禁用缓存运行
archguard analyze --no-cache
```

---

**文档版本**: 1.0
**创建日期**: 2026-01-25
**状态**: ✅ 计划完成，待执行
**预计完成时间**: 2-3 天
