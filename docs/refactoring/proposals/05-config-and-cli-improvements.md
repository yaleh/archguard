# ArchGuard 配置与 CLI 管理机制改进建议 (RLM 分析)

**文档版本**: 1.0
**创建日期**: 2026-01-25
**分析方法**: RLM (Refactoring Lifecycle Management)
**改进范围**: 配置系统、命令行参数、输出目录管理
**优先级**: 🔴 高 (P0) - 影响用户体验和灵活性

---

## 执行摘要

本文档基于 RLM 方法对 ArchGuard 的配置和命令行管理机制进行系统分析，识别当前实现的限制，并提出增强灵活性和用户体验的改进建议。主要改进包括：

1. **可配置的 Claude CLI 命令** - 支持自定义 Claude CLI 路径（默认 `claude`）
2. **可配置的 CLI 额外参数** - 支持传递自定义参数给 Claude CLI
3. **可配置的输出目录** - 统一管理架构图文件输出位置（默认 `./archguard`）

---

## 1. 现有实现分析

### 1.1 当前配置机制

**配置文件支持**:
```typescript
// src/cli/config-loader.ts
const configSchema = z.object({
  source: z.string().default('./src'),
  output: z.string().optional(),
  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
  exclude: z.array(z.string()).default([...]),
  ai: z.object({
    model: z.string().optional(),
    timeout: z.number().optional(),
  }).optional().default({}),
  cache: z.object({...}).default({...}),
  concurrency: z.number().optional(),
  verbose: z.boolean().optional(),
});
```

**命令行参数**:
```typescript
// src/cli/commands/analyze.ts
.option('-s, --source <path>', 'Source directory to analyze', './src')
.option('-o, --output <path>', 'Output file path')
.option('-f, --format <type>', 'Output format (plantuml|json|svg)', 'plantuml')
.option('-e, --exclude <patterns...>', 'Exclude patterns')
.option('--no-cache', 'Disable cache')
.option('-c, --concurrency <num>', 'Parallel parsing concurrency')
.option('-v, --verbose', 'Verbose output')
```

### 1.2 Claude CLI 集成分析

**当前硬编码实现**:
```typescript
// src/utils/cli-detector.ts
const { stdout } = await execa('claude-glm', ['--version'], {...});

// src/ai/claude-code-wrapper.ts
const result = await execa('claude-glm', [], {
  input: prompt,
});
```

**问题识别**:
- ❌ Claude CLI 命令硬编码为 `claude-glm`
- ❌ 无法支持不同的 Claude CLI 变体（`claude`, `claude-glm`, 自定义路径）
- ❌ 无法传递额外的 CLI 参数（如 `--model sonnet`）
- ❌ 缺乏灵活性，难以适配不同环境

### 1.3 输出路径管理分析

**当前实现**:
```typescript
// src/cli/commands/analyze.ts
const defaultOutput = options.output || path.join(process.cwd(), 'architecture');
const pngPath = defaultOutput + '.png';
await generator.generateAndRender(archJSON, pngPath);
```

**问题识别**:
- ⚠️ 输出路径逻辑分散在多个地方
- ⚠️ 缺少统一的输出目录配置
- ⚠️ 用户难以集中管理所有输出文件

---

## 2. RLM 优化建议

### 2.1 可配置的 Claude CLI 命令

#### 建议 1: 添加 `cli.command` 配置项

**问题**: Claude CLI 命令硬编码，缺乏灵活性

**解决方案**: 在配置 schema 中添加 `cli` 对象

**配置 Schema 更新**:
```typescript
const configSchema = z.object({
  // ... 现有配置 ...

  // 新增：CLI 配置
  cli: z.object({
    // Claude CLI 命令（默认 'claude'）
    command: z.string().default('claude'),

    // Claude CLI 额外参数（数组形式）
    args: z.array(z.string()).default([]),

    // CLI 超时时间（毫秒）
    timeout: z.number().default(60000),
  }).default({
    command: 'claude',
    args: [],
    timeout: 60000,
  }),

  // 保持向后兼容：ai 配置映射到 cli 配置
  ai: z.object({
    model: z.string().optional(),
    timeout: z.number().optional(),
  }).optional(),
});
```

**配置文件示例**:
```json
{
  "cli": {
    "command": "claude",
    "args": ["--model", "sonnet"],
    "timeout": 60000
  }
}
```

**命令行参数支持**:
```bash
# 使用默认 claude 命令
archguard analyze

# 使用自定义 claude-glm 命令
archguard analyze --cli-command claude-glm

# 指定额外的 CLI 参数
archguard analyze --cli-args "--model sonnet --print"

# 组合使用
archguard analyze --cli-command /usr/local/bin/claude-custom --cli-args "--timeout 120"
```

**代码实现**:
```typescript
// src/cli/types.ts
export interface CLIConfig {
  command: string;
  args: string[];
  timeout: number;
}

export interface AnalyzeOptions {
  source: string;
  output?: string;
  format: 'plantuml' | 'json' | 'svg';
  exclude?: string[];
  cache: boolean;
  concurrency?: number;
  verbose?: boolean;
  // 新增
  cliCommand?: string;
  cliArgs?: string[];
}

// src/cli/commands/analyze.ts
export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    // ... 现有选项 ...
    .option('--cli-command <cmd>', 'Claude CLI command (default: claude)', 'claude')
    .option('--cli-args <args...>', 'Additional CLI arguments')
    .action(analyzeCommandHandler);
}

// src/utils/cli-detector.ts
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
    // ... 错误处理 ...
  }
}

// src/ai/claude-code-wrapper.ts
async callCLI(prompt: string): Promise<string> {
  try {
    // 构建命令参数
    const args = [...this.options.cliArgs];

    const result = await execa(this.options.cliCommand, args, {
      timeout: this.options.timeout,
      cwd: this.options.workingDir,
      input: prompt,
    });

    return result.stdout;
  } catch (error) {
    throw error;
  }
}
```

**优先级**: 🔴 高 (P0) - 核心灵活性需求

---

### 2.2 可配置的输出目录

#### 建议 2: 添加 `outputDir` 配置项

**问题**: 输出路径管理分散，缺少统一配置

**解决方案**: 添加独立的输出目录配置

**配置 Schema 更新**:
```typescript
const configSchema = z.object({
  // ... 现有配置 ...

  // 新增：输出目录配置
  outputDir: z.string().default('./archguard'),

  // output 保持向后兼容
  output: z.string().optional(),

  // format 保持不变
  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
});
```

**输出路径解析逻辑**:
```typescript
// src/cli/utils/output-path-resolver.ts
export class OutputPathResolver {
  constructor(private config: Config) {}

  /**
   * 解析输出路径
   * 优先级：命令行 output > 配置文件 outputDir > 默认 './archguard'
   */
  resolve(options: AnalyzeOptions): {
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
      // 命令行指定了完整路径
      const parsed = path.parse(options.output);
      outputDir = parsed.dir || process.cwd();
      baseName = parsed.name;
    } else if (this.config.output) {
      // 配置文件指定了路径
      const parsed = path.parse(this.config.output);
      outputDir = parsed.dir || path.join(process.cwd(), this.config.outputDir || '');
      baseName = parsed.name;
    } else {
      // 使用默认输出目录
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

**配置文件示例**:
```json
{
  "outputDir": "./docs/archguard",
  "format": "png"
}
```

**命令行使用**:
```bash
# 使用默认输出目录 ./archguard
archguard analyze
# 输出文件：./archguard/architecture.png 和 ./archguard/architecture.puml

# 指定输出目录
archguard analyze --output-dir ./docs/architecture
# 输出文件：./docs/architecture/architecture.png

# 指定完整输出路径（覆盖 outputDir）
archguard analyze -o ./docs/my-project/architecture
# 输出文件：./docs/my-project/architecture.png

# 配置文件 + 命令行组合
# config.json: { "outputDir": "./docs/archguard" }
archguard analyze
# 输出文件：./docs/archguard/architecture.png
```

**优先级**: 🟡 中 (P1) - 用户体验改进

---

### 2.3 配置优先级与合并策略

#### 建议 3: 完善配置优先级机制

**当前实现**:
```typescript
const merged = { ...fileConfig, ...cliOptions };
```

**改进方案**: 深度合并 + 类型验证

```typescript
// src/cli/config-loader.ts
export class ConfigLoader {
  async load(cliOptions: Partial<Config> = {}): Promise<Config> {
    const fileConfig = await this.loadFromFile();

    // 深度合并配置
    const merged = this.deepMerge(fileConfig, cliOptions);

    // 向后兼容处理
    const normalized = this.normalizeConfig(merged);

    // 验证配置
    try {
      return configSchema.parse(normalized);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map((issue) => {
          const path = issue.path.join('.');
          return `  - ${path}: ${issue.message}`;
        }).join('\n');
        throw new Error(`Configuration validation failed:\n${issues}`);
      }
      throw error;
    }
  }

  /**
   * 深度合并配置对象
   */
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

  /**
   * 向后兼容：将旧配置映射到新配置
   */
  private normalizeConfig(config: any): any {
    const normalized = { ...config };

    // ai.model -> cli.args (如果是 --model 参数)
    if (config.ai?.model && !config.cli?.args) {
      normalized.cli = normalized.cli || {};
      normalized.cli.args = [`--model`, config.ai.model];
    }

    // ai.timeout -> cli.timeout
    if (config.ai?.timeout && !config.cli?.timeout) {
      normalized.cli = normalized.cli || {};
      normalized.cli.timeout = config.ai.timeout;
    }

    // 移除废弃的配置项
    if (normalized.ai) {
      delete (normalized.ai as any).apiKey;
      delete (normalized.ai as any).maxTokens;
      delete (normalized.ai as any).temperature;
      delete (normalized.ai as any).model;
      delete (normalized.ai as any).timeout;

      // 如果 ai 对象为空，删除它
      if (Object.keys(normalized.ai).length === 0) {
        delete normalized.ai;
      }
    }

    return normalized;
  }

  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}
```

**优先级**: 🟡 中 (P1) - 配置健壮性改进

---

## 3. RLM PLANNING - 实施计划

### 3.1 阶段划分

#### Phase 1: 配置 Schema 扩展 (1-2 天)

**任务**:
1. ✅ 更新 `configSchema` 添加 `cli` 和 `outputDir` 配置
2. ✅ 更新 TypeScript 类型定义
3. ✅ 编写配置验证测试
4. ✅ 更新配置初始化模板

**验收标准**:
- [ ] 配置 schema 验证通过
- [ ] 默认值符合预期
- [ ] 向后兼容性测试通过

**影响文件**:
- `src/cli/config-loader.ts`
- `src/cli/types.ts`

---

#### Phase 2: CLI 参数集成 (2-3 天)

**任务**:
1. ✅ 添加 `--cli-command` 和 `--cli-args` 选项
2. ✅ 添加 `--output-dir` 选项
3. ✅ 更新命令帮助文档
4. ✅ 编写 CLI 集成测试

**验收标准**:
- [ ] 命令行参数正确传递到配置
- [ ] 帮助文档准确描述新选项
- [ ] 测试覆盖率 > 80%

**影响文件**:
- `src/cli/commands/analyze.ts`
- `src/cli/commands/init.ts`

---

#### Phase 3: Claude CLI Wrapper 重构 (1-2 天)

**任务**:
1. ✅ 更新 `ClaudeCodeWrapper` 使用可配置的 CLI 命令
2. ✅ 更新 `CLIDetector` 支持自定义命令
3. ✅ 添加 CLI 参数拼接逻辑
4. ✅ 编写单元测试

**验收标准**:
- [ ] 支持自定义 Claude CLI 路径
- [ ] 正确传递额外参数
- [ ] 错误处理完善

**影响文件**:
- `src/ai/claude-code-wrapper.ts`
- `src/utils/cli-detector.ts`

---

#### Phase 4: 输出路径管理重构 (1-2 天)

**任务**:
1. ✅ 创建 `OutputPathResolver` 类
2. ✅ 更新 analyze 命令使用新的路径解析器
3. ✅ 添加输出目录自动创建逻辑
4. ✅ 编写集成测试

**验收标准**:
- [ ] 输出路径配置统一
- [ ] 自动创建输出目录
- [ ] 路径优先级正确

**影响文件**:
- `src/cli/utils/output-path-resolver.ts` (新增)
- `src/cli/commands/analyze.ts`

---

#### Phase 5: 文档与测试 (1 天)

**任务**:
1. ✅ 更新 README.md
2. ✅ 更新配置文件示例
3. ✅ 编写迁移指南
4. ✅ 完整端到端测试

**验收标准**:
- [ ] 文档完整准确
- [ ] 示例可运行
- [ ] E2E 测试通过

**影响文件**:
- `README.md`
- `docs/CONFIGURATION.md` (新增)

---

### 3.2 时间线

```
Week 1: Phase 1-2 (配置扩展 + CLI集成)
Week 2: Phase 3-4 (Wrapper重构 + 路径管理)
Week 2: Phase 5 (文档测试)
```

**总工期**: 6-9 个工作日

---

## 4. RLM VALIDATION - 验证策略

### 4.1 单元测试

**配置验证测试**:
```typescript
// tests/unit/config-loader.test.ts
describe('ConfigLoader - CLI Configuration', () => {
  it('should parse cli.command with default value', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load({});
    expect(config.cli?.command).toBe('claude');
  });

  it('should merge cli args from file and CLI', async () => {
    const loader = new ConfigLoader('./fixtures/config-with-cli.json');
    const config = await loader.load({
      cliArgs: ['--model', 'sonnet'],
    });
    expect(config.cli?.args).toContain('--model');
    expect(config.cli?.args).toContain('sonnet');
  });

  it('should support backward compatibility with ai.model', async () => {
    const loader = new ConfigLoader('./fixtures/config-old-ai.json');
    const config = await loader.load({});
    expect(config.cli?.args).toEqual(['--model', 'claude-glm']);
  });
});
```

**输出路径测试**:
```typescript
// tests/unit/output-path-resolver.test.ts
describe('OutputPathResolver', () => {
  it('should resolve default output directory', () => {
    const resolver = new OutputPathResolver({
      outputDir: './archguard',
    });
    const result = resolver.resolve({});
    expect(result.outputDir).endsWith('archguard');
    expect(result.baseName).toBe('architecture');
  });

  it('should prioritize CLI output option', () => {
    const resolver = new OutputPathResolver({
      outputDir: './archguard',
    });
    const result = resolver.resolve({
      output: './custom/diagram',
    });
    expect(result.outputDir).toContain('custom');
    expect(result.baseName).toBe('diagram');
  });
});
```

---

### 4.2 集成测试

**CLI 集成测试**:
```typescript
// tests/integration/cli-args.test.ts
describe('CLI Arguments Integration', () => {
  it('should use custom claude command', async () => {
    const { execaCommand } = await import('execa');
    const { stdout } = await execaCommand(
      'node dist/cli/index.js analyze --cli-command claude-glm --format json'
    );
    expect(stdout).toContain('Claude Code CLI available');
  });

  it('should pass additional args to claude', async () => {
    // 测试额外参数传递
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

## 5. RLM INTEGRATION - 集成策略

### 5.1 向后兼容性

**兼容性保证**:
1. ✅ 旧配置文件自动迁移
2. ✅ 废弃配置项显示警告
3. ✅ 默认行为保持不变
4. ✅ 渐进式采用新特性

**迁移示例**:
```typescript
// 旧配置 (仍可工作)
{
  "ai": {
    "model": "claude-glm",
    "timeout": 60000
  }
}

// 自动迁移到
{
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-glm"],
    "timeout": 60000
  }
}
```

---

### 5.2 发布策略

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

## 6. RLM MONITORING - 持续改进

### 6.1 监控指标

**配置使用情况**:
- 统计使用 `cli.command` 配置的用户比例
- 追踪 `outputDir` 配置的采用率
- 监控向后兼容性警告触发频率

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

## 7. 配置文件完整示例

### 7.1 最小化配置

```json
{
  "source": "./src",
  "outputDir": "./archguard",
  "format": "png"
}
```

**说明**:
- 使用默认输出目录 `./archguard`（会在项目根目录创建）
- 如需输出到 `docs` 子目录，设置 `outputDir: "./docs/archguard"`

### 7.2 完整配置

```json
{
  "source": "./src",
  "outputDir": "./docs/archguard",
  "format": "png",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**",
    "**/dist/**"
  ],
  "cli": {
    "command": "claude",
    "args": ["--model", "sonnet"],
    "timeout": 60000
  },
  "cache": {
    "enabled": true,
    "ttl": 86400
  },
  "concurrency": 4,
  "verbose": false
}
```

### 7.3 高级配置（自定义 Claude CLI）

```json
{
  "source": "./packages/core",
  "outputDir": "./architecture-diagrams",
  "cli": {
    "command": "/usr/local/bin/claude-custom",
    "args": [
      "--model",
      "claude-sonnet-4-20250514",
      "--timeout",
      "120",
      "--max-tokens",
      "8000"
    ],
    "timeout": 120000
  },
  "concurrency": 8
}
```

---

## 8. 迁移指南

### 8.1 从 v1.0 升级到 v1.1

**步骤 1: 更新配置文件**

```bash
# 备份现有配置
cp archguard.config.json archguard.config.json.backup

# 查看迁移警告
archguard analyze --verbose
```

**步骤 2: 采用新配置（可选）**

```json
// 旧配置 (仍可工作)
{
  "ai": {
    "model": "claude-glm"
  }
}

// 新配置 (推荐)
{
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-glm"]
  }
}
```

**步骤 3: 验证配置**

```bash
# 验证配置有效
archguard analyze --dry-run

# 测试实际运行
archguard analyze -o ./test-output
```

---

### 8.2 常见迁移场景

**场景 1: 使用自定义 Claude CLI**

```bash
# 旧方式：需要修改代码
# 新方式：配置文件
{
  "cli": {
    "command": "claude-glm"
  }
}
```

**场景 2: 集中管理输出文件**

```bash
# 旧方式：每次指定 -o
archguard analyze -o ./docs/arch-v1
archguard analyze -o ./docs/arch-v2

# 新方式：配置 outputDir
{
  "outputDir": "./docs"
}
archguard analyze -o architecture-v1
archguard analyze -o architecture-v2
```

---

## 9. 预期收益

### 9.1 用户体验改进

| 维度 | 改进前 | 改进后 | 提升 |
|------|--------|--------|------|
| **CLI 灵活性** | 硬编码命令 | 完全可配置 | ✨ 100% |
| **环境适配** | 需修改代码 | 配置即可 | ✨ 10x |
| **输出管理** | 分散配置 | 统一管理 | ✨ 5x |
| **学习曲线** | 中等 | 简化 | ✨ -30% |

### 9.2 维护性改进

- ✅ 减少硬编码依赖
- ✅ 提高配置可测试性
- ✅ 简化新环境部署
- ✅ 增强向后兼容性

### 9.3 功能增强

- ✅ 支持多种 Claude CLI 变体
- ✅ 支持自定义 CLI 参数
- ✅ 统一的输出目录管理
- ✅ 更好的配置优先级控制

---

## 10. 风险评估

### 10.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 配置兼容性破坏 | 中 | 高 | 完善向后兼容逻辑 |
| CLI 参数冲突 | 低 | 中 | 参数验证和警告 |
| 路径解析错误 | 中 | 中 | 充分测试 + 文档 |

### 10.2 用户采用风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 配置复杂度增加 | 中 | 中 | 提供默认配置 + 文档 |
| 迁移成本 | 低 | 低 | 向后兼容 + 自动迁移 |

---

## 11. 成功度量

### 11.1 定量指标

- ✅ 配置灵活性：支持的配置项数量 +50%
- ✅ 测试覆盖率：≥ 80%
- ✅ 向后兼容性：100% 旧配置可工作
- ✅ 文档完整性：所有新特性有文档

### 11.2 定性指标

- ✅ 用户满意度：配置易用性反馈 > 4/5
- ✅ 维护性：代码可读性和可维护性提升
- ✅ 扩展性：易于添加新配置项

---

## 12. 附录

### 12.1 相关文档

- [00-implementation-roadmap.md](./00-implementation-roadmap.md) - 总体实施计划
- [01-architecture-optimization-proposal.md](./01-architecture-optimization-proposal.md) - 架构优化建议
- [02-claude-code-integration-strategy.md](./02-claude-code-integration-strategy.md) - Claude Code 集成策略

### 12.2 配置参考

**完整配置 Schema**: 见 `src/cli/config-loader.ts`
**类型定义**: 见 `src/cli/types.ts`

### 12.3 示例代码仓库

**配置示例**: `examples/config/`
- `minimal-config.json` - 最小化配置
- `full-config.json` - 完整配置
- `custom-cli-config.json` - 自定义 CLI 配置

---

**文档作者**: Claude Code (AI Assistant)
**最后更新**: 2026-01-25
**文档状态**: ✅ 完成
**适用版本**: ArchGuard v1.1.0+
**下一步**: 提交 PR 进行技术评审
