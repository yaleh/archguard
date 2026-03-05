# ArchGuard: 从 API SDK 到 Claude Code CLI 的迁移计划

**文档版本**: 1.0
**创建日期**: 2026-01-25
**方法论**: RLM + TDD
**预计工作量**: 2-3 天
**风险等级**: 中等

---

## 📋 执行摘要

本文档定义了将 ArchGuard 从直接使用 `@anthropic-ai/sdk` 迁移到通过 **Claude Code CLI** 集成的完整计划。迁移将分 4 个阶段进行，每个阶段都遵循 TDD 方法论。

### 迁移价值

| 维度 | 当前状态 (API SDK) | 目标状态 (Claude Code CLI) |
|------|-------------------|----------------------------|
| **API Key 管理** | 需要用户配置 ANTHROPIC_API_KEY | 复用 Claude Code 配置，零配置 |
| **依赖** | @anthropic-ai/sdk (12.8 MB) | execa (轻量级) |
| **成本可见性** | 需要自己追踪 | Claude Code 订阅包含 |
| **上下文理解** | 无项目上下文 | Claude Code 理解项目 |
| **维护负担** | 需追踪 SDK 更新 | Claude Code 自动更新 |

---

## 1. 现状分析

### 1.1 当前架构

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Interface                        │
│                  (archguard analyze)                    │
└──────────────────┬──────────────────────────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
┌──────▼──────┐       ┌───────▼────────┐
│   Parser    │       │ AI Generator   │
│  (ts-morph) │       │(@anthropic-sdk)│ ← 需要迁移
└──────┬──────┘       └───────┬────────┘
       │                      │
       │   ┌──────────────────┘
       │   │
┌──────▼───▼──────┐
│   Arch-JSON     │
│  (Data Model)   │
└─────────────────┘
```

### 1.2 现有实现清单

#### ✅ 保留的核心代码

| 文件 | 功能 | 状态 | 覆盖率 |
|------|------|------|--------|
| `src/parser/**/*.ts` | TypeScript 解析 | ✅ 保留 | 99.1% |
| `src/types/**/*.ts` | 类型定义 | ✅ 保留 | 100% |
| `src/cli/progress.ts` | 进度显示 | ✅ 保留 | 95% |
| `src/cli/cache-manager.ts` | 缓存管理 | ✅ 保留 | 92% |
| `src/ai/plantuml-validator.ts` | 验证器 | ✅ 保留 | 98% |
| `src/ai/prompt-builder.ts` | 提示词构建 | 🔄 重构 | 97% |

#### ❌ 需要移除的代码

| 文件 | 功能 | 原因 | 影响 |
|------|------|------|------|
| `src/ai/claude-connector.ts` | API SDK 封装 | 改用 CLI | 中等 |
| `src/ai/cost-tracker.ts` | 成本追踪 | CLI 自带 | 低 |
| `@anthropic-ai/sdk` (依赖) | Anthropic SDK | 不再需要 | 高 |

#### 🆕 需要新增的代码

| 文件 | 功能 | 复杂度 | 测试优先级 |
|------|------|--------|-----------|
| `src/ai/claude-code-wrapper.ts` | CLI 封装 | 中 | 高 |
| `src/ai/output-parser.ts` | 输出解析 | 低 | 高 |
| `src/ai/prompt-template-manager.ts` | 模板管理 | 低 | 中 |
| `prompts/class-diagram.txt` | 类图模板 | 低 | 中 |
| `prompts/README.md` | 模板文档 | 低 | 低 |

### 1.3 依赖变更

#### package.json 变更

**移除:**
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.20.0"  // ❌ 移除
  }
}
```

**新增:**
```json
{
  "dependencies": {
    "execa": "^8.0.0"  // ✅ 子进程管理
  }
}
```

### 1.4 测试现状

**现有测试 (323/329 通过, 98.2%)**

| 测试套件 | 文件数 | 测试数 | 覆盖率 | 依赖 API Key |
|---------|-------|-------|--------|-------------|
| Unit Tests | 42 | 287 | 99.1% | ❌ No |
| Integration Tests | 5 | 27 | 97.88% | ✅ Yes (2 tests) |
| E2E Tests | 3 | 15 | ~80% | ✅ Yes (3 tests) |

**需要更新的测试:**
- `tests/unit/ai/claude-connector.test.ts` → `claude-code-wrapper.test.ts`
- `tests/unit/ai/cost-tracker.test.ts` → 删除或废弃
- `tests/integration/ai/plantuml-generation.test.ts` → 更新为 CLI 模式

---

## 2. 迁移差距分析

### 2.1 功能差距矩阵

| 功能 | 当前实现 | 新方案要求 | 差距 | 优先级 |
|------|---------|-----------|------|--------|
| **API 调用** | @anthropic-ai/sdk | Claude Code CLI | 🔴 完全重写 | P0 |
| **认证** | ANTHROPIC_API_KEY | Claude Code 配置 | 🔴 移除 API Key | P0 |
| **提示词** | 硬编码在 PromptBuilder | 模板文件 | 🟡 重构 | P1 |
| **输出解析** | extractPlantUML() | 需要 CLI 输出解析 | 🟡 适配 | P1 |
| **重试逻辑** | 内置 | 需重新实现 | 🟡 迁移 | P1 |
| **成本追踪** | CostTracker | 不需要 | 🟢 移除 | P2 |
| **验证** | PlantUMLValidator | 保持不变 | 🟢 无需变更 | - |
| **缓存** | 文件缓存 | 保持不变 | 🟢 无需变更 | - |

### 2.2 技术风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Claude Code CLI 不可用 | 低 | 高 | 检测 CLI，提供清晰错误提示 |
| CLI 输出格式变化 | 中 | 中 | 鲁棒的输出解析，支持多格式 |
| 性能下降 (进程开销) | 低 | 低 | 基准测试，优化临时文件 I/O |
| 测试环境无 Claude Code | 中 | 中 | Mock CLI 调用，提供测试 fixture |
| 用户环境配置问题 | 中 | 中 | 详细文档 + 诊断命令 |

---

## 3. 迁移计划 (4 个阶段)

### 阶段概览

```
Phase 0: 准备阶段 (0.5天)
  ├─ 添加 execa 依赖
  ├─ 创建目录结构
  ├─ 设置测试基础设施
  └─ 创建 CLI 检测工具

Phase 1: CLI 封装 (1天)
  ├─ Story 1.1: ClaudeCodeWrapper 基础
  ├─ Story 1.2: 提示词模板系统
  ├─ Story 1.3: 输出解析器
  └─ Story 1.4: 错误处理与重试

Phase 2: 集成与替换 (0.5天)
  ├─ Story 2.1: 更新 PlantUMLGenerator
  ├─ Story 2.2: 更新 CLI 命令
  └─ Story 2.3: 配置文件更新

Phase 3: 测试与验证 (1天)
  ├─ Story 3.1: 单元测试迁移
  ├─ Story 3.2: 集成测试更新
  ├─ Story 3.3: E2E 测试更新
  ├─ Story 3.4: 自我验证 (用 ArchGuard 分析自己)
  └─ Story 3.5: 性能基准测试
```

---

## 4. Phase 0: 准备阶段 (0.5 天)

### 目标
- 设置项目基础设施
- 添加必要依赖
- 创建目录结构
- 建立测试框架

### 任务清单

#### Task 0.1: 依赖管理
```bash
# 添加新依赖
npm install execa@^8.0.0

# 暂时保留 @anthropic-ai/sdk (用于回退)
# 待 Phase 3 完成后移除
```

#### Task 0.2: 目录结构
```
src/ai/
├── claude-code-wrapper.ts       # 新增 - CLI 封装
├── output-parser.ts             # 新增 - 输出解析
├── prompt-template-manager.ts   # 新增 - 模板管理
├── plantuml-generator.ts        # 修改 - 使用新 wrapper
├── prompt-builder.ts            # 重构 - 改为模板系统
├── plantuml-validator.ts        # 保留 - 无需修改
├── claude-connector.ts          # 废弃 - 标记为 deprecated
└── cost-tracker.ts              # 废弃 - 标记为 deprecated

prompts/                         # 新增目录
├── class-diagram.txt            # 类图提示词模板
├── component-diagram.txt        # (预留)
├── sequence-diagram.txt         # (预留)
└── README.md                    # 模板使用说明

tests/unit/ai/
├── claude-code-wrapper.test.ts  # 新增
├── output-parser.test.ts        # 新增
└── prompt-template-manager.test.ts # 新增
```

#### Task 0.3: CLI 检测工具
```typescript
// src/utils/cli-detector.ts

export interface CLIDetectionResult {
  available: boolean;
  version?: string;
  error?: string;
}

export async function detectClaudeCodeCLI(): Promise<CLIDetectionResult> {
  // TDD 实现
}
```

### 验收标准
- ✅ execa 依赖已安装
- ✅ prompts/ 目录已创建
- ✅ 测试文件框架已建立
- ✅ CLI 检测工具可用

---

## 5. Phase 1: CLI 封装 (1 天)

### Story 1.1: ClaudeCodeWrapper 基础 (2h)

#### TDD 测试用例
```typescript
// tests/unit/ai/claude-code-wrapper.test.ts

describe('Story 1.1: ClaudeCodeWrapper Basics', () => {
  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const wrapper = new ClaudeCodeWrapper();
      expect(wrapper.options.timeout).toBe(30000);
      expect(wrapper.options.maxRetries).toBe(2);
    });

    it('should accept custom options', () => {
      const wrapper = new ClaudeCodeWrapper({
        timeout: 60000,
        maxRetries: 3,
        workingDir: '/custom/dir'
      });
      expect(wrapper.options.timeout).toBe(60000);
      expect(wrapper.options.maxRetries).toBe(3);
    });
  });

  describe('CLI Detection', () => {
    it('should detect Claude Code CLI availability', async () => {
      const wrapper = new ClaudeCodeWrapper();
      const available = await wrapper.isClaudeCodeAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should throw if Claude Code CLI not found', async () => {
      // Mock execa to simulate CLI not found
      await expect(async () => {
        const wrapper = new ClaudeCodeWrapper();
        await wrapper.checkCLIAvailability();
      }).rejects.toThrow('Claude Code CLI not found');
    });
  });

  describe('Temporary File Management', () => {
    it('should create temporary directory', async () => {
      const wrapper = new ClaudeCodeWrapper();
      const tempDir = await wrapper.createTempDir();

      expect(tempDir).toContain('archguard-');
      expect(await fs.pathExists(tempDir)).toBe(true);
    });

    it('should cleanup temporary files', async () => {
      const wrapper = new ClaudeCodeWrapper();
      const tempDir = await wrapper.createTempDir();

      await wrapper.cleanup(tempDir);
      expect(await fs.pathExists(tempDir)).toBe(false);
    });
  });
});
```

#### 实现接口
```typescript
// src/ai/claude-code-wrapper.ts

export interface ClaudeCodeOptions {
  timeout?: number;
  maxRetries?: number;
  workingDir?: string;
  model?: string;
}

export class ClaudeCodeWrapper {
  constructor(options?: ClaudeCodeOptions);

  async isClaudeCodeAvailable(): Promise<boolean>;
  async checkCLIAvailability(): Promise<void>;
  async createTempDir(): Promise<string>;
  async cleanup(tempDir: string): Promise<void>;
}
```

### Story 1.2: 提示词模板系统 (2h)

#### TDD 测试用例
```typescript
describe('Story 1.2: Prompt Template System', () => {
  describe('PromptTemplateManager', () => {
    it('should load class diagram template', async () => {
      const manager = new PromptTemplateManager();
      const template = await manager.loadTemplate('class-diagram');

      expect(template).toContain('{{ARCH_JSON}}');
      expect(template).toContain('PlantUML');
    });

    it('should render template with variables', async () => {
      const manager = new PromptTemplateManager();
      const archJson = { entities: [], relations: [] };

      const rendered = await manager.render('class-diagram', {
        ARCH_JSON: JSON.stringify(archJson, null, 2),
        PREVIOUS_PUML: null
      });

      expect(rendered).not.toContain('{{ARCH_JSON}}');
      expect(rendered).toContain('"entities"');
    });

    it('should handle missing template', async () => {
      const manager = new PromptTemplateManager();

      await expect(
        manager.loadTemplate('non-existent')
      ).rejects.toThrow('Template not found');
    });
  });

  describe('Template File Creation', () => {
    it('should create class-diagram.txt with proper content', async () => {
      const templatePath = 'prompts/class-diagram.txt';
      const content = await fs.readFile(templatePath, 'utf-8');

      expect(content).toContain('你是一个资深软件架构师');
      expect(content).toContain('{{ARCH_JSON}}');
      expect(content).toContain('@startuml');
    });
  });
});
```

#### 模板文件示例
```text
// prompts/class-diagram.txt

你是一个资深软件架构师，专注于生成清晰、准确的 PlantUML 架构图。

## 输入

架构指纹（JSON 格式）：
{{ARCH_JSON}}

{{#if PREVIOUS_PUML}}
上一版本的 PlantUML 图：
{{PREVIOUS_PUML}}

请基于新的架构指纹**增量更新**上述图表，保持风格一致。
{{else}}
请基于架构指纹生成全新的 PlantUML 类图。
{{/if}}

## 要求

1. **语法正确性**：必须包含 @startuml 和 @enduml
2. **完整性**：包含架构指纹中的所有实体
3. **关系准确**：正确表示继承、组合、依赖关系
4. **现代化**：使用 skinparam 提升视觉效果
5. **简洁性**：只输出代码，不要解释

## 输出格式

```plantuml
@startuml Architecture
!theme cerulean-outline

skinparam classAttributeIconSize 0
skinparam classFontSize 12

[您的 PlantUML 代码]

@enduml
```
```

### Story 1.3: 输出解析器 (1.5h)

#### TDD 测试用例
```typescript
describe('Story 1.3: Output Parser', () => {
  describe('OutputParser', () => {
    it('should extract PlantUML from markdown code block', () => {
      const output = `
Here is the diagram:

\`\`\`plantuml
@startuml
class User
@enduml
\`\`\`
      `;

      const parser = new OutputParser();
      const puml = parser.extractPlantUML(output);

      expect(puml).toContain('@startuml');
      expect(puml).toContain('class User');
      expect(puml).not.toContain('```');
    });

    it('should extract PlantUML from raw output', () => {
      const output = `@startuml
class User
@enduml`;

      const parser = new OutputParser();
      const puml = parser.extractPlantUML(output);

      expect(puml).toBe(output);
    });

    it('should handle multiple code blocks', () => {
      const output = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`plantuml
@startuml
class User
@enduml
\`\`\`
      `;

      const parser = new OutputParser();
      const puml = parser.extractPlantUML(output);

      expect(puml).toContain('@startuml');
      expect(puml).not.toContain('typescript');
    });

    it('should throw on no PlantUML found', () => {
      const output = 'No diagram here';
      const parser = new OutputParser();

      expect(() => parser.extractPlantUML(output)).toThrow(
        'No PlantUML code found in output'
      );
    });
  });
});
```

### Story 1.4: 错误处理与重试 (2.5h)

#### TDD 测试用例
```typescript
describe('Story 1.4: Error Handling and Retry', () => {
  describe('generatePlantUML', () => {
    it('should successfully generate PlantUML', async () => {
      const wrapper = new ClaudeCodeWrapper();
      const archJson = createTestArchJSON();

      const puml = await wrapper.generatePlantUML(archJson);

      expect(puml).toContain('@startuml');
      expect(puml).toContain('@enduml');
    });

    it('should retry on timeout', async () => {
      const wrapper = new ClaudeCodeWrapper({ maxRetries: 2 });

      // Mock first call to timeout
      let callCount = 0;
      vi.spyOn(wrapper as any, 'callCLI').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Timeout');
        }
        return '@startuml\nclass User\n@enduml';
      });

      const puml = await wrapper.generatePlantUML(createTestArchJSON());
      expect(callCount).toBe(2);
      expect(puml).toContain('class User');
    });

    it('should fail after max retries', async () => {
      const wrapper = new ClaudeCodeWrapper({ maxRetries: 2 });

      vi.spyOn(wrapper as any, 'callCLI').mockRejectedValue(
        new Error('CLI Error')
      );

      await expect(
        wrapper.generatePlantUML(createTestArchJSON())
      ).rejects.toThrow('Failed after 2 retries');
    });

    it('should validate PlantUML before returning', async () => {
      const wrapper = new ClaudeCodeWrapper();

      vi.spyOn(wrapper as any, 'callCLI').mockResolvedValue(
        'Invalid output without @startuml'
      );

      await expect(
        wrapper.generatePlantUML(createTestArchJSON())
      ).rejects.toThrow('Invalid PlantUML');
    });
  });

  describe('CLI Error Classification', () => {
    it('should classify file not found error', () => {
      const error = new Error('ENOENT: no such file');
      const classified = classifyCLIError(error);

      expect(classified.type).toBe('FILE_NOT_FOUND');
      expect(classified.retryable).toBe(false);
    });

    it('should classify timeout error', () => {
      const error = new Error('Command timed out');
      const classified = classifyCLIError(error);

      expect(classified.type).toBe('TIMEOUT');
      expect(classified.retryable).toBe(true);
    });

    it('should classify CLI not found error', () => {
      const error = new Error('spawn claude-code ENOENT');
      const classified = classifyCLIError(error);

      expect(classified.type).toBe('CLI_NOT_FOUND');
      expect(classified.retryable).toBe(false);
    });
  });
});
```

### Phase 1 验收标准
- ✅ ClaudeCodeWrapper 类完整实现
- ✅ 提示词模板系统可用
- ✅ 输出解析器正确工作
- ✅ 错误处理和重试机制完善
- ✅ 单元测试覆盖率 ≥ 90%
- ✅ 所有测试通过

---

## 6. Phase 2: 集成与替换 (0.5 天)

### Story 2.1: 更新 PlantUMLGenerator (1.5h)

#### 重构策略
```typescript
// src/ai/plantuml-generator.ts (重构后)

import { ClaudeCodeWrapper } from './claude-code-wrapper';
import { PlantUMLValidator } from './plantuml-validator';
import { ArchJSON } from '../types';

export interface GeneratorConfig {
  // ❌ 移除: apiKey: string;
  model?: string;
  maxRetries?: number;
  timeout?: number;
  workingDir?: string;
}

export class PlantUMLGenerator {
  // ❌ 移除: private connector: ClaudeConnector;
  // ✅ 新增:
  private wrapper: ClaudeCodeWrapper;
  private validator: PlantUMLValidator;

  constructor(config: GeneratorConfig = {}) {
    // ❌ 移除 API Key 验证

    // ✅ 使用 ClaudeCodeWrapper
    this.wrapper = new ClaudeCodeWrapper({
      model: config.model,
      maxRetries: config.maxRetries,
      timeout: config.timeout,
      workingDir: config.workingDir,
    });

    this.validator = new PlantUMLValidator();
  }

  async generate(archJson: ArchJSON): Promise<string> {
    // ✅ 使用 wrapper 替代 connector
    const puml = await this.wrapper.generatePlantUML(archJson);

    // ✅ 保留验证逻辑
    const validation = this.validator.validate(puml, archJson);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.issues.join(', ')}`);
    }

    return puml;
  }

  // ❌ 移除: getLastUsage() - CLI 不提供 token 统计
}
```

#### TDD 测试用例
```typescript
describe('Story 2.1: PlantUMLGenerator Refactor', () => {
  it('should generate without API key', async () => {
    // ✅ 不再需要 apiKey
    const generator = new PlantUMLGenerator();
    const archJson = createTestArchJSON();

    const puml = await generator.generate(archJson);
    expect(puml).toContain('@startuml');
  });

  it('should use ClaudeCodeWrapper internally', async () => {
    const generator = new PlantUMLGenerator();

    expect(generator['wrapper']).toBeInstanceOf(ClaudeCodeWrapper);
    expect(generator['connector']).toBeUndefined(); // 确保旧的被移除
  });

  it('should validate output', async () => {
    const generator = new PlantUMLGenerator();

    vi.spyOn(generator['wrapper'], 'generatePlantUML').mockResolvedValue(
      'Invalid output'
    );

    await expect(
      generator.generate(createTestArchJSON())
    ).rejects.toThrow('Validation failed');
  });
});
```

### Story 2.2: 更新 CLI 命令 (1h)

#### 重构 analyze.ts
```typescript
// src/cli/commands/analyze.ts (关键部分)

// ❌ 移除:
// const generator = new PlantUMLGenerator({
//   apiKey: process.env.ANTHROPIC_API_KEY || '',
// });

// ✅ 新增:
const generator = new PlantUMLGenerator({
  model: config.ai?.model,
  timeout: 60000,
});

// ✅ 添加 CLI 可用性检查
progress.start('Checking Claude Code CLI...');
const cliAvailable = await isClaudeCodeAvailable();
if (!cliAvailable) {
  progress.fail('Claude Code CLI not found');
  console.error(
    'Please install Claude Code CLI from: https://docs.anthropic.com/claude-code'
  );
  process.exit(1);
}
progress.succeed('Claude Code CLI available');
```

### Story 2.3: 配置文件更新 (0.5h)

#### 更新 .archguardrc.json schema
```typescript
// src/config/config-schema.ts

const configSchema = z.object({
  source: z.string().default('./src'),
  output: z.string().optional(),
  format: z.enum(['plantuml', 'json']).default('plantuml'),
  exclude: z.array(z.string()).default([
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/node_modules/**'
  ]),

  // ❌ 移除:
  // ai: z.object({
  //   apiKey: z.string().optional(),
  // }),

  // ✅ 简化:
  ai: z.object({
    model: z.string().optional(),
    timeout: z.number().optional(),
  }).optional(),

  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(86400)
  }).optional()
});
```

### Phase 2 验收标准
- ✅ PlantUMLGenerator 不再依赖 API Key
- ✅ CLI 命令已更新
- ✅ 配置文件 schema 已更新
- ✅ 向后兼容处理 (旧配置文件仍可读取)
- ✅ 所有集成测试通过

---

## 7. Phase 3: 测试与验证 (1 天)

### Story 3.1: 单元测试迁移 (2h)

#### 测试迁移清单

| 原测试文件 | 迁移策略 | 新测试文件 |
|-----------|---------|-----------|
| `claude-connector.test.ts` | 废弃 | `claude-code-wrapper.test.ts` |
| `cost-tracker.test.ts` | 移除 | - |
| `plantuml-generator.test.ts` | 更新 Mock | `plantuml-generator.test.ts` |
| `prompt-builder.test.ts` | 重构 | `prompt-template-manager.test.ts` |

#### Mock 策略
```typescript
// tests/mocks/claude-code-cli-mock.ts

export function mockClaudeCodeCLI() {
  vi.mock('execa', () => ({
    execa: vi.fn().mockResolvedValue({
      stdout: '@startuml\nclass User\n@enduml',
      stderr: '',
      exitCode: 0,
    }),
  }));
}

export function mockClaudeCodeCLIError(errorType: 'timeout' | 'not_found' | 'invalid_output') {
  // 模拟各种错误场景
}
```

### Story 3.2: 集成测试更新 (2h)

#### 更新测试环境检测
```typescript
// tests/integration/setup.ts

export function isClaudeCodeAvailable(): boolean {
  try {
    execSync('claude-code --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function skipIfNoClaudeCode() {
  return {
    skip: !isClaudeCodeAvailable(),
    reason: 'Claude Code CLI not available in test environment'
  };
}
```

#### 更新集成测试
```typescript
// tests/integration/ai/plantuml-generation.test.ts

describe('PlantUML Generation Integration', skipIfNoClaudeCode(), () => {
  it('should generate PlantUML from real ArchJSON', async () => {
    const generator = new PlantUMLGenerator();
    const archJson = await parseTestProject();

    const puml = await generator.generate(archJson);

    expect(puml).toContain('@startuml');
    expect(puml).toContain('@enduml');

    // 验证所有实体都包含
    for (const entity of archJson.entities) {
      expect(puml).toContain(entity.name);
    }
  });

  it('should respect timeout configuration', async () => {
    const generator = new PlantUMLGenerator({ timeout: 5000 });

    // 使用非常大的项目测试超时
    const largeArchJson = createLargeArchJSON(1000);

    await expect(
      generator.generate(largeArchJson)
    ).rejects.toThrow('timeout');
  }, 10000);
});
```

### Story 3.3: E2E 测试更新 (1h)

#### 完整流程测试
```typescript
// tests/e2e/cli-workflow.test.ts

describe('E2E: Complete Workflow with CLI', () => {
  it('should analyze project and generate PlantUML', async () => {
    const testDir = await createTestProject();

    // 执行 CLI 命令
    const result = await execa('archguard', [
      'analyze',
      '-s', path.join(testDir, 'src'),
      '-o', path.join(testDir, 'output.puml'),
    ]);

    expect(result.exitCode).toBe(0);

    // 验证输出文件
    const puml = await fs.readFile(
      path.join(testDir, 'output.puml'),
      'utf-8'
    );
    expect(puml).toContain('@startuml');
  });

  it('should show helpful error when Claude Code not available', async () => {
    // Mock CLI 不可用
    vi.mock('execa', () => ({
      execa: vi.fn().mockRejectedValue(new Error('ENOENT'))
    }));

    const result = await execa('archguard', ['analyze'], {
      reject: false
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Claude Code CLI not found');
    expect(result.stderr).toContain('https://docs.anthropic.com/claude-code');
  });
});
```

### Story 3.4: 自我验证 (2h)

#### 使用 ArchGuard 分析自身

```bash
# 构建项目
npm run build

# 运行分析 (使用新的 CLI 集成)
./dist/cli/index.js analyze \
  -s ./src \
  -o ./docs/archguard-architecture-v2.puml \
  -v

# 验证输出
diff docs/archguard-architecture.puml docs/archguard-architecture-v2.puml

# 生成对比报告
```

#### 验证清单
- ✅ 所有 27 个文件都被解析
- ✅ 47 个实体都被识别
- ✅ 79 个关系都被提取
- ✅ PlantUML 语法正确
- ✅ 与旧版本输出质量相当或更好
- ✅ 性能指标：< 10s 总时间

### Story 3.5: 性能基准测试 (1h)

#### 基准测试脚本
```typescript
// tests/performance/cli-integration-benchmark.test.ts

describe('Performance: CLI Integration', () => {
  it('should not have significant overhead vs SDK', async () => {
    const archJson = await parseArchGuardProject();

    // 测试新实现
    const startCLI = performance.now();
    const generator = new PlantUMLGenerator();
    await generator.generate(archJson);
    const durationCLI = performance.now() - startCLI;

    console.log(`CLI Integration: ${durationCLI.toFixed(2)}ms`);

    // 性能应该在合理范围内 (< 15s)
    expect(durationCLI).toBeLessThan(15000);
  });

  it('should cache CLI calls effectively', async () => {
    const generator = new PlantUMLGenerator();
    const archJson = await parseArchGuardProject();

    // 第一次调用
    const start1 = performance.now();
    await generator.generate(archJson);
    const duration1 = performance.now() - start1;

    // 第二次调用 (应该从缓存读取)
    const start2 = performance.now();
    await generator.generate(archJson);
    const duration2 = performance.now() - start2;

    // 缓存应该显著提升性能
    expect(duration2).toBeLessThan(duration1 * 0.5);
  });
});
```

### Phase 3 验收标准
- ✅ 所有单元测试通过 (覆盖率 ≥ 90%)
- ✅ 所有集成测试通过
- ✅ E2E 测试验证完整流程
- ✅ 自我验证成功 (ArchGuard 分析自己)
- ✅ 性能基准满足要求
- ✅ 无回归问题

---

## 8. 清理与发布 (Phase 4 - 可选)

### Task 4.1: 移除废弃代码
```bash
# 移除旧依赖
npm uninstall @anthropic-ai/sdk

# 删除废弃文件
rm src/ai/claude-connector.ts
rm src/ai/cost-tracker.ts
rm tests/unit/ai/claude-connector.test.ts
rm tests/unit/ai/cost-tracker.test.ts

# 更新 exports
# src/ai/index.ts - 移除 ClaudeConnector, CostTracker 导出
```

### Task 4.2: 文档更新
- ✅ 更新 README.md (已完成)
- ✅ 更新 API 文档
- ✅ 更新 CHANGELOG.md
- ✅ 更新迁移指南

### Task 4.3: 发布检查清单
- [ ] 所有测试通过 (323+ tests)
- [ ] 代码覆盖率 ≥ 80%
- [ ] 性能基准达标
- [ ] 文档完整
- [ ] CHANGELOG 更新
- [ ] 版本号更新 (0.1.0 → 0.2.0)

---

## 9. 回退计划

### 触发条件
- 关键测试失败率 > 10%
- 性能下降 > 50%
- 发现阻塞性 Bug

### 回退步骤
1. 恢复 `@anthropic-ai/sdk` 依赖
2. 恢复 `src/ai/claude-connector.ts`
3. 恢复 `src/ai/plantuml-generator.ts` (旧版本)
4. 回退配置文件 schema
5. 恢复测试

### 数据保护
- 所有变更都在 feature branch 进行
- 主分支受保护
- 每个 Phase 完成后创建 tag

---

## 10. 监控指标

### 迁移进度指标

| 阶段 | 计划工时 | 任务数 | 测试数 | 当前状态 |
|------|---------|-------|--------|---------|
| Phase 0 | 4h | 3 | 5 | ⏳ 待开始 |
| Phase 1 | 8h | 4 | 50+ | ⏳ 待开始 |
| Phase 2 | 3h | 3 | 20+ | ⏳ 待开始 |
| Phase 3 | 8h | 5 | 30+ | ⏳ 待开始 |
| **总计** | **23h** | **15** | **105+** | **0%** |

### 质量指标

| 指标 | 目标 | 当前 | 状态 |
|------|------|------|------|
| 测试覆盖率 | ≥ 90% | - | ⏳ |
| 测试通过率 | 100% | - | ⏳ |
| 性能 (自我分析) | < 10s | - | ⏳ |
| 内存使用 | < 300MB | - | ⏳ |
| PlantUML 正确率 | ≥ 95% | - | ⏳ |

---

## 11. 风险与依赖

### 外部依赖
- ✅ Claude Code CLI 已安装
- ✅ Node.js >= 18.0.0
- ✅ execa 库可用
- ⚠️ Claude Code CLI 版本兼容性

### 技术依赖
- ✅ 现有 Parser 代码稳定
- ✅ PlantUMLValidator 可重用
- ✅ 测试基础设施完善

### 人员依赖
- ✅ 熟悉 TDD 方法论
- ✅ 了解 ArchGuard 架构
- ⚠️ 需要 Claude Code CLI 使用经验

---

## 12. 成功标准

### 功能完整性
- ✅ 所有现有功能保持不变
- ✅ PlantUML 生成质量不降低
- ✅ 错误处理更加健壮
- ✅ 用户体验提升 (无需配置 API Key)

### 技术质量
- ✅ 测试覆盖率 ≥ 90%
- ✅ 所有测试通过
- ✅ 无已知 Bug
- ✅ 代码符合 ESLint 规范

### 性能指标
- ✅ 自我分析 < 10s
- ✅ 内存使用 < 300MB
- ✅ 缓存命中率 > 80%

### 文档完整性
- ✅ README 更新
- ✅ API 文档完整
- ✅ 迁移指南清晰
- ✅ 故障排除文档完善

---

## 附录 A: 快速参考

### CLI 命令对比

**迁移前:**
```bash
# 需要设置 API Key
export ANTHROPIC_API_KEY=sk-...

# 运行分析
archguard analyze -s ./src -o ./architecture.puml
```

**迁移后:**
```bash
# 无需 API Key (使用 Claude Code 配置)

# 运行分析
archguard analyze -s ./src -o ./architecture.puml
```

### 配置文件对比

**迁移前 (.archguardrc.json):**
```json
{
  "source": "./src",
  "output": "./architecture.puml",
  "ai": {
    "apiKey": "${ANTHROPIC_API_KEY}",  // ❌ 需要
    "model": "claude-3-5-sonnet-20241022"
  }
}
```

**迁移后 (.archguardrc.json):**
```json
{
  "source": "./src",
  "output": "./architecture.puml",
  "ai": {
    // ✅ 无需 apiKey
    "model": "claude-3-5-sonnet-20241022",
    "timeout": 60000
  }
}
```

### 错误信息对比

**迁移前:**
```
Error: API key is required for PlantUMLGenerator
Please set ANTHROPIC_API_KEY environment variable
```

**迁移后:**
```
Error: Claude Code CLI not found
Please install Claude Code from: https://docs.anthropic.com/claude-code

To check installation: claude-code --version
```

---

**文档版本**: 1.0
**状态**: ✅ 计划完成，待用户确认
**下一步**: 等待用户确认后开始 Phase 0
