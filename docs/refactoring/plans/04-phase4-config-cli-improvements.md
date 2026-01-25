# Phase 4: 配置与 CLI 管理机制改进 (TDD)

**计划名称**: ArchGuard 配置灵活性增强实施计划
**阶段**: Phase 4 - Configuration & CLI Flexibility Enhancement
**方法论**: RLM (Refactoring Lifecycle Management) + TDD
**预计时间**: 6-9 个工作日
**依赖**: Phase 1 (代码指纹) + Phase 2 (Claude Code CLI) + Phase 3 (CLI 开发) 完成
**创建日期**: 2026-01-25
**对应提案**: [05-config-and-cli-improvements.md](../proposals/05-config-and-cli-improvements.md)

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
- ✅ Phase 2: Claude Code CLI 集成已完成
- ✅ Phase 3: CLI 基础框架已搭建
- ❌ Claude CLI 命令硬编码为 `claude-glm`
- ❌ 无法传递额外的 CLI 参数
- ❌ 输出路径管理分散且不统一
- ❌ 配置优先级逻辑不够清晰
- ❌ 缺少向后兼容性保证

**目标用户痛点**:
1. **CLI 命令硬编码**: 无法使用不同的 Claude CLI 变体（`claude`, `claude-glm`, 自定义路径）
2. **参数传递受限**: 无法传递自定义参数给 Claude CLI（如 `--model sonnet`）
3. **输出管理混乱**: 输出文件分散，缺少统一的输出目录配置
4. **配置不灵活**: 难以适配不同环境和用户需求

### 1.2 提案目标

**核心目标**: 提供灵活、可配置、向后兼容的配置和 CLI 管理机制

**具体目标**:
1. **可配置的 Claude CLI 命令** (Priority: High - P0)
   - 支持配置文件指定 CLI 命令（默认 `claude`）
   - 支持命令行参数覆盖 CLI 命令
   - 支持自定义 CLI 路径

2. **可配置的 CLI 额外参数** (Priority: High - P0)
   - 支持配置文件传递 CLI 参数
   - 支持命令行参数传递
   - 参数合并策略（配置文件 + CLI）

3. **可配置的输出目录** (Priority: Medium - P1)
   - 新增 `outputDir` 配置项（默认 `./archguard`）
   - 统一管理所有输出文件路径
   - 自动创建输出目录
   - 清晰的路径解析优先级

4. **完善的配置优先级** (Priority: Medium - P1)
   - 深度合并配置对象
   - 向后兼容旧配置格式
   - 配置验证和错误提示

### 1.3 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| CLI 命令可配置性 | 100% | 功能测试 |
| 配置灵活性 | 支持 3+ CLI 变体 | 集成测试 |
| 向后兼容性 | 100% | 兼容性测试 |
| 配置验证准确率 | 100% | 单元测试 |
| 用户满意度 | ≥ 4/5 | 用户反馈 |
| 文档完整性 | 100% | 文档审查 |

### 1.4 技术栈

**核心库**:
```json
{
  "dependencies": {
    "zod": "^3.25.76",           // 配置验证
    "commander": "^11.1.0",       // CLI 框架
    "execa": "^8.0.0",            // 进程执行
    "fs-extra": "^11.2.0"         // 文件系统操作
  }
}
```

**新增依赖**: 无（使用现有依赖）

### 1.5 影响范围

**修改文件**:
- `src/cli/config-loader.ts` - 配置 Schema 扩展和深度合并
- `src/cli/types.ts` - 类型定义更新
- `src/cli/commands/analyze.ts` - 新增 CLI 参数
- `src/utils/cli-detector.ts` - 支持自定义 CLI 命令
- `src/ai/claude-code-wrapper.ts` - 使用可配置的 CLI
- `src/cli/utils/output-path-resolver.ts` - 新建输出路径解析器

**新增文件**:
- `src/types/node-plantuml.d.ts` - 类型声明
- `src/cli/utils/output-path-resolver.ts` - 输出路径管理

---

## 2. RLM PLANNING - 计划阶段

### 2.1 阶段划分

#### Phase 4.1: 配置 Schema 扩展 (1-2 天)

**目标**: 扩展配置 Schema，支持新的配置项

**关键任务**:
1. 更新 `configSchema` 添加 `cli` 配置对象
2. 添加 `outputDir` 配置项
3. 实现配置深度合并逻辑
4. 实现向后兼容性处理
5. 编写配置验证测试

**验收标准**:
- [ ] 配置 Schema 验证通过
- [ ] 默认值符合预期
- [ ] 向后兼容性测试通过
- [ ] 测试覆盖率 ≥ 80%

---

#### Phase 4.2: CLI 参数集成 (2-3 天)

**目标**: 添加新的命令行参数支持

**关键任务**:
1. 添加 `--cli-command` 参数
2. 添加 `--cli-args` 参数
3. 添加 `--output-dir` 参数
4. 更新命令帮助文档
5. 编写 CLI 集成测试

**验收标准**:
- [ ] 命令行参数正确传递
- [ ] 帮助文档准确
- [ ] 集成测试通过
- [ ] 测试覆盖率 ≥ 80%

---

#### Phase 4.3: Claude CLI Wrapper 重构 (1-2 天)

**目标**: 更新 Claude CLI 集成使用可配置命令

**关键任务**:
1. 更新 `ClaudeCodeWrapper` 使用配置
2. 更新 `CLIDetector` 支持自定义命令
3. 添加 CLI 参数拼接逻辑
4. 编写单元测试

**验收标准**:
- [ ] 支持自定义 CLI 路径
- [ ] 正确传递额外参数
- [ ] 错误处理完善
- [ ] 测试覆盖率 ≥ 80%

---

#### Phase 4.4: 输出路径管理重构 (1-2 天)

**目标**: 统一输出路径管理

**关键任务**:
1. 创建 `OutputPathResolver` 类
2. 更新 analyze 命令使用新解析器
3. 添加输出目录自动创建
4. 编写集成测试

**验收标准**:
- [ ] 输出路径配置统一
- [ ] 自动创建输出目录
- [ ] 路径优先级正确
- [ ] 测试覆盖率 ≥ 80%

---

#### Phase 4.5: 文档与测试 (1 天)

**目标**: 更新文档和完成测试

**关键任务**:
1. 更新 README.md
2. 更新配置文件示例
3. 编写迁移指南
4. 完整端到端测试

**验收标准**:
- [ ] 文档完整准确
- [ ] 示例可运行
- [ ] E2E 测试通过
- [ ] 迁移指南清晰

---

### 2.2 Story 划分

#### Story 1: 配置 Schema 扩展 (Phase 4.1)

**User Story**: 作为用户，我想通过配置文件自定义 Claude CLI 命令，以便适配我的环境

**TDD 测试用例**:
```typescript
// tests/cli/config-loader.test.ts
import { describe, it, expect } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import fs from 'fs-extra';

describe('Story 1: Config Schema Extension', () => {
  describe('CLI Configuration', () => {
    it('should parse cli.command with default value', async () => {
      const loader = new ConfigLoader('./fixtures/config');
      const config = await loader.load({});

      expect(config.cli?.command).toBe('claude');
    });

    it('should parse cli.command from config file', async () => {
      const loader = new ConfigLoader('./fixtures/config-with-cli');
      const config = await loader.load({});

      expect(config.cli?.command).toBe('claude-glm');
    });

    it('should parse cli.args as array', async () => {
      const loader = new ConfigLoader('./fixtures/config-with-cli');
      const config = await loader.load({});

      expect(config.cli?.args).toEqual(['--model', 'sonnet']);
    });

    it('should parse cli.timeout', async () => {
      const loader = new ConfigLoader('./fixtures/config-with-cli');
      const config = await loader.load({});

      expect(config.cli?.timeout).toBe(60000);
    });
  });

  describe('Output Directory Configuration', () => {
    it('should parse outputDir with default value', async () => {
      const loader = new ConfigLoader('./fixtures/config');
      const config = await loader.load({});

      expect(config.outputDir).toBe('./archguard');
    });

    it('should parse outputDir from config file', async () => {
      const loader = new ConfigLoader('./fixtures/config-with-output');
      const config = await loader.load({});

      expect(config.outputDir).toBe('./docs/archguard');
    });
  });

  describe('Backward Compatibility', () => {
    it('should migrate ai.model to cli.args', async () => {
      const loader = new ConfigLoader('./fixtures/config-old-ai');
      const config = await loader.load({});

      expect(config.cli?.args).toContain('--model');
      expect(config.cli?.args).toContain('claude-glm');
    });

    it('should migrate ai.timeout to cli.timeout', async () => {
      const loader = new ConfigLoader('./fixtures/config-old-ai');
      const config = await loader.load({});

      expect(config.cli?.timeout).toBe(60000);
    });

    it('should remove deprecated ai.apiKey', async () => {
      const loader = new ConfigLoader('./fixtures/config-old-apikey');
      const config = await loader.load({});

      expect(config.ai).not.toHaveProperty('apiKey');
    });
  });
});
```

**红-绿-重构示例**:
```typescript
// 🔴 RED: 写失败的测试
it('should support cli configuration', async () => {
  const loader = new ConfigLoader();
  const config = await loader.load({
    cliCommand: 'claude-custom',
  });

  expect(config.cli?.command).toBe('claude-custom');
});

// 🟢 GREEN: 写最小代码让测试通过
// src/cli/config-loader.ts
export class ConfigLoader {
  async load(cliOptions: Partial<Config> = {}): Promise<Config> {
    const fileConfig = await this.loadFromFile();
    const merged = { ...fileConfig, ...cliOptions };

    if (cliOptions.cliCommand) {
      merged.cli = merged.cli || {};
      merged.cli.command = cliOptions.cliCommand;
    }

    return configSchema.parse(merged);
  }
}

// ♻️ REFACTOR: 重构改进代码
// src/cli/config-loader.ts
export class ConfigLoader {
  async load(cliOptions: Partial<Config> = {}): Promise<Config> {
    const fileConfig = await this.loadFromFile();
    const normalized = this.normalizeConfig(fileConfig);
    const merged = this.deepMerge(normalized, cliOptions);

    return configSchema.parse(merged);
  }

  private deepMerge(target: any, source: any): any {
    // 深度合并实现...
  }

  private normalizeConfig(config: any): any {
    // 向后兼容处理...
  }
}
```

---

#### Story 2: CLI 参数集成 (Phase 4.2)

**User Story**: 作为用户，我想通过命令行参数覆盖配置，以便快速调整行为

**TDD 测试用例**:
```typescript
// tests/cli/commands/analyze.test.ts
import { describe, it, expect } from 'vitest';
import { createAnalyzeCommand } from '@/cli/commands/analyze';

describe('Story 2: CLI Parameters Integration', () => {
  describe('CLI Command Options', () => {
    it('should accept --cli-command option', () => {
      const command = createAnalyzeCommand();
      const options = command.parseOptions(['--cli-command', 'claude-glm']);

      expect(options.cliCommand).toBe('claude-glm');
    });

    it('should accept --cli-args option', () => {
      const command = createAnalyzeCommand();
      const options = command.parseOptions([
        '--cli-args',
        '--model',
        'sonnet'
      ]);

      expect(options.cliArgs).toEqual(['--model', 'sonnet']);
    });

    it('should accept --output-dir option', () => {
      const command = createAnalyzeCommand();
      const options = command.parseOptions(['--output-dir', './docs']);

      expect(options.outputDir).toBe('./docs');
    });
  });

  describe('Priority Order', () => {
    it('should prioritize CLI over config file', async () => {
      // Test CLI args override config file
    });

    it('should merge cli.args from config and CLI', async () => {
      // Test args merging logic
    });
  });
});
```

---

#### Story 3: Claude CLI Wrapper 重构 (Phase 4.3)

**User Story**: 作为系统，我想使用可配置的 Claude CLI，以便支持不同环境

**TDD 测试用例**:
```typescript
// tests/ai/claude-code-wrapper.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ClaudeCodeWrapper } from '@/ai/claude-code-wrapper';

describe('Story 3: Claude CLI Wrapper Refactoring', () => {
  describe('Configurable CLI Command', () => {
    it('should use configured cli.command', async () => {
      const wrapper = new ClaudeCodeWrapper({
        cli: { command: 'claude-glm', args: [], timeout: 60000 }
      });

      const isAvailable = await wrapper.isClaudeCodeAvailable();

      expect(isAvailable).toBe(true);
    });

    it('should accept custom cli path', async () => {
      const wrapper = new ClaudeCodeWrapper({
        cli: { command: '/usr/local/bin/claude', args: [], timeout: 60000 }
      });

      const isAvailable = await wrapper.isClaudeCodeAvailable();

      // Assuming /usr/local/bin/claude exists
      expect(isAvailable).toBe(true);
    });
  });

  describe('CLI Arguments', () => {
    it('should pass additional args to CLI', async () => {
      const wrapper = new ClaudeCodeWrapper({
        cli: {
          command: 'claude',
          args: ['--model', 'sonnet'],
          timeout: 60000
        }
      });

      // Test that args are passed to execa
      const result = await wrapper.callCLI('test prompt');

      expect(result).toBeDefined();
    });
  });
});
```

---

#### Story 4: 输出路径管理重构 (Phase 4.4)

**User Story**: 作为用户，我想配置统一的输出目录，以便管理架构图文件

**TDD 测试用例**:
```typescript
// tests/cli/utils/output-path-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver';

describe('Story 4: Output Path Management', () => {
  describe('Path Resolution', () => {
    it('should resolve default output directory', () => {
      const resolver = new OutputPathResolver({
        outputDir: './archguard'
      });
      const result = resolver.resolve({});

      expect(result.outputDir).toContain('archguard');
      expect(result.baseName).toBe('architecture');
      expect(result.paths.png).toContain('archguard/architecture.png');
    });

    it('should prioritize CLI output option', () => {
      const resolver = new OutputPathResolver({
        outputDir: './archguard'
      });
      const result = resolver.resolve({
        output: './custom/diagram'
      });

      expect(result.outputDir).toContain('custom');
      expect(result.baseName).toBe('diagram');
    });

    it('should create output directory automatically', async () => {
      const resolver = new OutputPathResolver({
        outputDir: './test-output'
      });
      const result = resolver.resolve({});

      // Verify directory was created
      await fs.ensureDir(result.outputDir);
      const exists = await fs.pathExists(result.outputDir);

      expect(exists).toBe(true);
    });
  });

  describe('Path Priority', () => {
    it('should prioritize: CLI > config > default', () => {
      const resolver = new OutputPathResolver({
        output: './config/arch',
        outputDir: './config'
      });

      // CLI overrides both
      const result1 = resolver.resolve({ output: './cli/arch' });
      expect(result1.outputDir).toContain('cli');

      // Config overrides default
      const result2 = resolver.resolve({});
      expect(result2.outputDir).toContain('config');
    });
  });
});
```

---

### 2.3 时间线

```
Week 1
├─ Day 1-2: Phase 4.1 - 配置 Schema 扩展
├─ Day 3-4: Phase 4.2 - CLI 参数集成
└─ Day 5: Phase 4.3 - Claude CLI Wrapper 重构

Week 2
├─ Day 1: Phase 4.4 - 输出路径管理重构
├─ Day 2: 集成测试和修复
└─ Day 3: Phase 4.5 - 文档和最终验证
```

**总工期**: 6-9 个工作日

---

### 2.4 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 配置兼容性破坏 | 中 | 高 | 完善向后兼容逻辑 + 测试 |
| CLI 参数冲突 | 低 | 中 | 参数验证和警告 |
| 路径解析错误 | 中 | 中 | 充分测试 + 文档 |
| 用户体验下降 | 低 | 中 | 渐进式采用 + 文档 |

---

## 3. RLM EXECUTION - 执行阶段

### 3.1 开发流程

**TDD 循环**:
```
🔴 RED:   写失败的测试
  ↓
🟢 GREEN: 写最小代码让测试通过
  ↓
♻️ REFACTOR: 重构改进代码
  ↓
🔄 重复
```

**每日工作流**:
1. 晨会：查看任务清单
2. TDD 开发：红-绿-重构循环
3. 测试运行：确保所有测试通过
4. 代码审查：提交 PR
5. 文档更新：同步更新文档

---

### 3.2 Phase 4.1 实施细节

**文件**: `src/cli/config-loader.ts`

**关键实现**:
```typescript
import { z } from 'zod';

const configSchema = z.object({
  source: z.string().default('./src'),
  output: z.string().optional(),
  outputDir: z.string().default('./archguard'),
  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
  exclude: z.array(z.string()).default([...]),

  // CLI 配置
  cli: z.object({
    command: z.string().default('claude'),
    args: z.array(z.string()).default([]),
    timeout: z.number().default(60000),
  }).default({
    command: 'claude',
    args: [],
    timeout: 60000,
  }),

  // 向后兼容：ai 配置
  ai: z.object({
    model: z.string().optional(),
    timeout: z.number().optional(),
  }).optional(),

  cache: z.object({...}).default({...}),
  concurrency: z.number().optional(),
  verbose: z.boolean().optional(),
});

export class ConfigLoader {
  async load(cliOptions: Partial<Config> = {}): Promise<Config> {
    const fileConfig = await this.loadFromFile();
    const normalized = this.normalizeConfig(fileConfig);
    const merged = this.deepMerge(normalized, cliOptions);

    return configSchema.parse(merged);
  }

  private normalizeConfig(config: any): any {
    const normalized = { ...config };

    // ai.model -> cli.args
    if (config.ai?.model && !config.cli?.args) {
      normalized.cli = normalized.cli || {};
      normalized.cli.args = [`--model`, config.ai.model];
    }

    // ai.timeout -> cli.timeout
    if (config.ai?.timeout && !config.cli?.timeout) {
      normalized.cli = normalized.cli || {};
      normalized.cli.timeout = config.ai.timeout;
    }

    // 移除废弃配置
    if (normalized.ai) {
      delete (normalized.ai as any).apiKey;
      delete (normalized.ai as any).maxTokens;
      delete (normalized.ai as any).temperature;
      delete (normalized.ai as any).model;
      delete (normalized.ai as any).timeout;

      if (Object.keys(normalized.ai).length === 0) {
        delete normalized.ai;
      }
    }

    return normalized;
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };

    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }

    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}
```

---

### 3.3 Phase 4.2 实施细节

**文件**: `src/cli/commands/analyze.ts`

**关键实现**:
```typescript
export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze TypeScript project and generate architecture diagrams')
    .option('-s, --source <path>', 'Source directory to analyze', './src')
    .option('-o, --output <path>', 'Output file path')
    .option('-f, --format <type>', 'Output format (png|svg|json)', 'png')
    .option('-e, --exclude <patterns...>', 'Exclude patterns')
    .option('--no-cache', 'Disable cache')
    .option('-c, --concurrency <num>', 'Parallel parsing concurrency')
    .option('-v, --verbose', 'Verbose output')
    .option('--cli-command <cmd>', 'Claude CLI command (default: claude)', 'claude')
    .option('--cli-args <args...>', 'Additional CLI arguments')
    .option('--output-dir <dir>', 'Output directory (default: ./archguard)', './archguard')
    .action(analyzeCommandHandler);
}

async function analyzeCommandHandler(options: AnalyzeOptions): Promise<void> {
  // ... 实现代码
}
```

---

### 3.4 Phase 4.3 实施细节

**文件**: `src/utils/cli-detector.ts`

**关键实现**:
```typescript
export async function detectClaudeCodeCLI(command?: string): Promise<CLIDetectionResult> {
  const cliCommand = command || 'claude';

  try {
    const { stdout } = await execa(cliCommand, ['--version'], {
      timeout: 5000,
      reject: true,
    });

    return {
      available: true,
      version: stdout.trim(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
      return {
        available: false,
        error: `${cliCommand} not found in system PATH`,
      };
    }

    return {
      available: false,
      error: `Failed to detect CLI: ${errorMessage}`,
    };
  }
}
```

---

### 3.5 Phase 4.4 实施细节

**文件**: `src/cli/utils/output-path-resolver.ts` (新建)

**关键实现**:
```typescript
import fs from 'fs-extra';
import path from 'path';
import type { Config } from '../types';

export class OutputPathResolver {
  constructor(private config: Config) {}

  resolve(options: {
    output?: string;
    outputDir?: string;
  }): {
    outputDir: string;
    baseName: string;
    paths: {
      puml: string;
      png: string;
      svg: string;
      json: string;
    };
  } {
    // 1. 确定输出目录
    let outputDir: string;
    let baseName: string;

    if (options.output) {
      // CLI 完整路径
      const parsed = path.parse(options.output);
      outputDir = parsed.dir || process.cwd();
      baseName = parsed.name;
    } else if (options.outputDir) {
      // CLI outputDir
      outputDir = path.resolve(process.cwd(), options.outputDir);
      baseName = 'architecture';
    } else if (this.config.output) {
      // 配置文件 output
      const parsed = path.parse(this.config.output);
      outputDir = parsed.dir || path.join(process.cwd(), this.config.outputDir || './archguard');
      baseName = parsed.name;
    } else {
      // 默认输出目录
      outputDir = path.join(process.cwd(), this.config.outputDir || './archguard');
      baseName = 'architecture';
    }

    // 2. 确保输出目录存在
    fs.ensureDirSync(outputDir);

    // 3. 生成各类文件路径
    const paths = {
      puml: path.join(outputDir, `${baseName}.puml`),
      png: path.join(outputDir, `${baseName}.png`),
      svg: path.join(outputDir, `${baseName}.svg`),
      json: path.join(outputDir, `${baseName}.json`),
    };

    return { outputDir, baseName, paths };
  }
}
```

---

## 4. RLM VALIDATION - 验证阶段

### 4.1 单元测试

**测试文件**: `tests/unit/`

**测试覆盖率目标**: ≥ 80%

**关键测试用例**:
- 配置 Schema 验证
- 深度合并逻辑
- 向后兼容性
- CLI 参数解析
- 输出路径解析
- Claude CLI 检测

---

### 4.2 集成测试

**测试文件**: `tests/integration/`

**关键测试场景**:
```typescript
// tests/integration/config-cli-flow.test.ts
describe('Configuration & CLI Integration', () => {
  it('should work with default config', async () => {
    const result = await execa('node', ['dist/cli/index.js', 'analyze', '-s', './src']);
    expect(result.exitCode).toBe(0);
  });

  it('should work with custom CLI command', async () => {
    const result = await execa('node', [
      'dist/cli/index.js',
      'analyze',
      '--cli-command',
      'claude-glm',
      '-s',
      './src'
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('should respect outputDir config', async () => {
    const result = await execa('node', [
      'dist/cli/index.js',
      'analyze',
      '--output-dir',
      './test-output'
    ]);
    expect(result.exitCode).toBe(0);
    expect(await fs.pathExists('./test-output/architecture.png')).toBe(true);
  });
});
```

---

### 4.3 质量门控

**必须满足**:
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ 所有集成测试通过
- ✅ 向后兼容性测试通过
- ✅ 文档完整性检查通过
- ✅ ESLint 无错误
- ✅ TypeScript 类型检查通过

---

## 5. RLM INTEGRATION - 集成阶段

### 5.1 Git 工作流

**分支策略**:
```
main (protected)
  ↑
feature/config-cli-improvements (开发分支)
  ↑
origin/feature/config-cli-improvements (PR)
```

**PR 模板**:
```markdown
## Phase 4: 配置与 CLI 管理机制改进

### 改进内容
- [ ] 可配置的 Claude CLI 命令
- [ ] 可配置的 CLI 额外参数
- [ ] 可配置的输出目录
- [ ] 完善的配置优先级

### 测试
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 向后兼容性测试通过

### 文档
- [ ] README.md 更新
- [ ] 配置示例更新
- [ ] 迁移指南完成

### 检查清单
- [ ] ESLint 通过
- [ ] TypeScript 类型检查通过
- [ ] 测试覆盖率 ≥ 80%
```

---

### 5.2 向后兼容性

**兼容性矩阵**:
| 配置版本 | 支持状态 | 废弃计划 |
|---------|---------|---------|
| v1.0 (ai.*) | ✅ 支持 | v2.0 移除 |
| v1.1 (cli.*) | ✅ 推荐 | 长期支持 |

**迁移示例**:
```typescript
// v1.0 配置 (仍可工作)
{
  "ai": {
    "model": "claude-glm",
    "timeout": 60000
  }
}

// v1.1 配置 (推荐)
{
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-glm"],
    "timeout": 60000
  }
}
```

---

### 5.3 发布策略

**版本规划**:
- **v1.1.0**: 引入新配置特性（向后兼容）
- **v1.2.0**: 标记旧配置为废弃
- **v2.0.0**: 移除废弃配置

**发布检查清单**:
- [ ] CHANGELOG.md 更新
- [ ] 迁移指南发布
- [ ] 示例配置更新
- [ ] 文档同步更新

---

## 6. RLM MONITORING - 监控阶段

### 6.1 监控指标

**配置使用情况**:
- 使用 `cli.command` 配置的用户比例
- `outputDir` 配置的采用率
- 向后兼容性警告触发频率

**质量指标**:
- 配置验证错误率 < 5%
- CLI 参数解析成功率 > 95%
- 输出路径相关 issues < 2 个/月

---

### 6.2 用户反馈

**反馈渠道**:
- GitHub Issues 标签: `config`
- 用户调研: 每季度一次
- 文档反馈: README.md 底部链接

**持续改进**:
- 根据反馈调整默认值
- 优化配置优先级逻辑
- 扩展配置项支持范围

---

### 6.3 成功度量

**预期收益**:
| 维度 | 改进前 | 改进后 | 提升 |
|------|--------|--------|------|
| **CLI 灵活性** | 硬编码命令 | 完全可配置 | ✨ 100% |
| **环境适配** | 需修改代码 | 配置即可 | ✨ 10x |
| **输出管理** | 分散配置 | 统一管理 | ✨ 5x |

**实际测量**:
- 配置灵活性: 支持的配置项数量 +50%
- 用户体验: 学习曲线 -30%
- 维护性: 代码可读性和可维护性提升

---

## 7. 附录

### 7.1 相关文档

**提案文档**: [05-config-and-cli-improvements.md](../proposals/05-config-and-cli-improvements.md)
**主计划**: [00-implementation-plan.md](./00-implementation-plan.md)
**Phase 1**: [01-phase1-code-fingerprint.md](./01-phase1-code-fingerprint.md)
**Phase 2**: [02-phase2-claude-code-integration.md](./02-phase2-claude-code-integration.md)
**Phase 3**: [03-phase3-cli-optimization.md](./03-phase3-cli-optimization.md)

### 7.2 配置文件示例

**最小化配置**:
```json
{
  "source": "./src",
  "outputDir": "./archguard"
}
```

**完整配置**:
```json
{
  "source": "./src",
  "outputDir": "./docs/archguard",
  "format": "png",
  "cli": {
    "command": "claude",
    "args": ["--model", "sonnet"],
    "timeout": 60000
  },
  "exclude": ["**/*.test.ts"],
  "cache": { "enabled": true }
}
```

### 7.3 迁移检查清单

**升级前**:
- [ ] 备份现有配置
- [ ] 查看迁移警告
- [ ] 阅读迁移指南

**升级后**:
- [ ] 验证配置有效
- [ ] 测试实际运行
- [ ] 更新文档

---

**文档作者**: Claude Code (AI Assistant)
**最后更新**: 2026-01-25
**文档状态**: ✅ 完成
**适用版本**: ArchGuard v1.1.0+
**下一步**: 开始 Phase 4.1 - 配置 Schema 扩展
