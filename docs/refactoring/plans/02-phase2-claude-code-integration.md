# Phase 2: Claude Code CLI 集成与文档生成 (TDD)

**阶段名称**: Claude Code CLI Integration & PlantUML Generation
**预计时间**: 2-3 天
**开发方法**: TDD (Test-Driven Development)
**依赖**: Phase 1 (代码指纹提取) 完成
**核心**: 通过 Claude Code CLI 生成 PlantUML

**重大变更**: 从直接 AI API 调用改为 Claude Code CLI 集成

---

## 📋 阶段目标

实现基于 Claude Code CLI 的文档生成器，能够：
1. 封装 Claude Code 命令行调用
2. 设计高质量提示词模板
3. 生成符合规范的 PlantUML 类图
4. 解析和验证 CLI 输出
5. 实现错误处理和重试机制

**核心价值**: 将结构化代码指纹通过 Claude Code 转化为高质量的可视化架构文档

**优势**:
- ✅ 无需管理 API Key
- ✅ 利用 Claude Code 现有配置
- ✅ 与开发者工作流无缝集成
- ✅ 降低集成复杂度

---

## 1. RLM PROPOSAL - 阶段提案

### 1.1 问题陈述

**当前状态**:
- ✅ Phase 1: 代码指纹提取完成（Arch-JSON 生成）
- ❌ 缺少将 Arch-JSON 转换为 PlantUML 的能力
- ❌ 需要集成 AI 能力，但不希望直接管理 AI API

**目标**:
通过 Claude Code CLI 实现从 Arch-JSON 到 PlantUML 的转换，而不是直接调用 AI API。

### 1.2 方案对比

| 方案 | 优势 | 劣势 | 选择 |
|------|------|------|------|
| **直接 AI API** | 完全控制 | 需要管理 API Key，成本复杂 | ❌ 不采用 |
| **Claude Code CLI** | 零配置，利用现有工具 | 依赖 Claude Code 安装 | ✅ **采用** |
| **本地模板** | 无 AI 成本 | 灵活性差，质量低 | ❌ 不采用 |

---

## 2. RLM PLANNING - 计划阶段

### 2.1 Story 划分

#### Story 1: Claude Code CLI 封装 (Day 1 上午)

**User Story**: 作为开发者，我想调用 Claude Code CLI 生成内容，以便利用其 AI 能力

**TDD 测试用例**:
```typescript
// tests/unit/cli/claude-code-wrapper.test.ts

import { describe, it, expect, vi } from 'vitest';
import { ClaudeCodeWrapper } from '@/cli/claude-code-wrapper';

describe('Story 1: Claude Code CLI Wrapper', () => {
  it('should check if Claude Code CLI is available', async () => {
    const wrapper = new ClaudeCodeWrapper();
    const isAvailable = await wrapper.checkAvailability();

    expect(isAvailable).toBe(true);
  });

  it('should execute simple CLI command', async () => {
    const wrapper = new ClaudeCodeWrapper();
    const result = await wrapper.execute('echo "test"');

    expect(result).toContain('test');
  });

  it('should handle CLI not found error', async () => {
    const wrapper = new ClaudeCodeWrapper({ cliPath: '/invalid/path' });

    await expect(wrapper.checkAvailability()).resolves.toBe(false);
  });

  it('should respect timeout setting', async () => {
    const wrapper = new ClaudeCodeWrapper({ timeout: 100 });

    await expect(
      wrapper.execute('sleep 1')
    ).rejects.toThrow('timeout');
  }, 10000);
});
```

**验收标准**:
- ✅ 能检测 Claude Code CLI 是否可用
- ✅ 能执行基本的 CLI 命令
- ✅ 正确处理超时
- ✅ 错误处理完善

---

#### Story 2: 提示词构建器 (Day 1 下午)

**User Story**: 作为系统，我想根据 Arch-JSON 构建提示词，以便传递给 Claude Code

**TDD 测试用例**:
```typescript
// tests/unit/cli/prompt-builder.test.ts

import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '@/cli/prompt-builder';
import type { ArchJSON } from '@/types';

describe('Story 2: Prompt Builder', () => {
  const sampleArchJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-25T00:00:00Z',
    sourceFiles: ['test.ts'],
    entities: [
      {
        id: 'UserService',
        name: 'UserService',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { filePath: 'test.ts', startLine: 1, endLine: 10 }
      }
    ],
    relations: []
  };

  it('should build basic prompt from Arch-JSON', () => {
    const builder = new PromptBuilder();
    const prompt = builder.buildPlantUMLPrompt(sampleArchJson);

    expect(prompt).toContain('架构指纹');
    expect(prompt).toContain('UserService');
    expect(prompt).toContain('PlantUML');
  });

  it('should include previous PlantUML when provided', () => {
    const builder = new PromptBuilder();
    const previousPuml = '@startuml\nclass OldClass\n@enduml';
    const prompt = builder.buildPlantUMLPrompt(sampleArchJson, previousPuml);

    expect(prompt).toContain(previousPuml);
    expect(prompt).toContain('更新');
  });

  it('should load template from file', async () => {
    const builder = new PromptBuilder();
    const template = await builder.loadTemplate('class-diagram');

    expect(template).toBeDefined();
    expect(template).toContain('{{ARCH_JSON}}');
  });

  it('should replace template variables', () => {
    const builder = new PromptBuilder();
    const template = 'Hello {{NAME}}, your age is {{AGE}}';
    const result = builder.replaceVariables(template, {
      NAME: 'Alice',
      AGE: '30'
    });

    expect(result).toBe('Hello Alice, your age is 30');
  });
});
```

**验收标准**:
- ✅ 能从 Arch-JSON 构建提示词
- ✅ 支持模板加载
- ✅ 支持变量替换
- ✅ 支持增量更新（包含历史 PlantUML）

---

#### Story 3: PlantUML 生成器 (Day 2 上午)

**User Story**: 作为系统，我想通过 Claude Code 生成 PlantUML，以便可视化架构

**TDD 测试用例**:
```typescript
// tests/unit/generator/plantuml-generator.test.ts

import { describe, it, expect, vi } from 'vitest';
import { PlantUMLGenerator } from '@/generator/plantuml-generator';
import type { ArchJSON } from '@/types';

describe('Story 3: PlantUML Generator', () => {
  const sampleArchJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-25T00:00:00Z',
    sourceFiles: ['user.ts'],
    entities: [
      {
        id: 'User',
        name: 'User',
        type: 'class',
        visibility: 'public',
        members: [
          {
            name: 'login',
            type: 'method',
            visibility: 'public',
            parameters: [],
            returnType: 'void'
          }
        ],
        sourceLocation: { filePath: 'user.ts', startLine: 1, endLine: 10 }
      }
    ],
    relations: []
  };

  it('should generate PlantUML from Arch-JSON', async () => {
    const generator = new PlantUMLGenerator();
    const plantUML = await generator.generate(sampleArchJson);

    expect(plantUML).toContain('@startuml');
    expect(plantUML).toContain('@enduml');
    expect(plantUML).toContain('class User');
  });

  it('should validate generated PlantUML syntax', async () => {
    const generator = new PlantUMLGenerator();
    const plantUML = await generator.generate(sampleArchJson);

    const isValid = generator.validate(plantUML);
    expect(isValid).toBe(true);
  });

  it('should handle CLI timeout gracefully', async () => {
    const generator = new PlantUMLGenerator({ timeout: 100 });

    await expect(
      generator.generate(sampleArchJson)
    ).rejects.toThrow(/timeout|time.*out/i);
  }, 10000);

  it('should retry on failure', async () => {
    const generator = new PlantUMLGenerator({ maxRetries: 2 });
    const spyExecute = vi.spyOn(generator as any, 'executeCLI');

    // Mock first call fails, second succeeds
    spyExecute.mockRejectedValueOnce(new Error('Temporary failure'));
    spyExecute.mockResolvedValueOnce('@startuml\nclass Test\n@enduml');

    const result = await generator.generate(sampleArchJson);

    expect(result).toContain('@startuml');
    expect(spyExecute).toHaveBeenCalledTimes(2);
  });
});
```

**验收标准**:
- ✅ 能生成有效的 PlantUML 代码
- ✅ 包含所有实体
- ✅ 语法验证通过
- ✅ 支持重试机制

---

#### Story 4: 输出解析器 (Day 2 下午)

**User Story**: 作为系统，我想从 Claude Code 输出中提取 PlantUML 代码块

**TDD 测试用例**:
```typescript
// tests/unit/cli/output-parser.test.ts

import { describe, it, expect } from 'vitest';
import { OutputParser } from '@/cli/output-parser';

describe('Story 4: Output Parser', () => {
  it('should extract PlantUML from markdown code block', () => {
    const output = `
Here is the PlantUML diagram:

\`\`\`plantuml
@startuml
class User
@enduml
\`\`\`

That's the diagram.
    `;

    const parser = new OutputParser();
    const plantUML = parser.extractPlantUML(output);

    expect(plantUML).toBe('@startuml\nclass User\n@enduml');
  });

  it('should extract PlantUML without code block markers', () => {
    const output = `
@startuml
class User {
  +login()
}
@enduml
    `;

    const parser = new OutputParser();
    const plantUML = parser.extractPlantUML(output);

    expect(plantUML).toContain('@startuml');
    expect(plantUML).toContain('class User');
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
    const plantUML = parser.extractPlantUML(output);

    expect(plantUML).not.toContain('typescript');
    expect(plantUML).toContain('@startuml');
  });

  it('should throw error if no PlantUML found', () => {
    const output = 'No diagram here';

    const parser = new OutputParser();

    expect(() => parser.extractPlantUML(output)).toThrow('No PlantUML code found');
  });
});
```

**验收标准**:
- ✅ 能从各种格式提取 PlantUML
- ✅ 支持 markdown 代码块
- ✅ 支持直接 PlantUML 文本
- ✅ 错误处理完善

---

#### Story 5: 集成测试 (Day 3)

**User Story**: 作为开发者，我想端到端测试整个流程

**TDD 测试用例**:
```typescript
// tests/integration/plantuml-generation.test.ts

import { describe, it, expect } from 'vitest';
import { TypeScriptParser } from '@/parser/typescript-parser';
import { PlantUMLGenerator } from '@/generator/plantuml-generator';

describe('Story 5: End-to-End PlantUML Generation', () => {
  it('should generate PlantUML from TypeScript code', async () => {
    const tsCode = `
export class UserService {
  async login(username: string, password: string): Promise<User> {
    // ...
  }
}

export interface User {
  id: string;
  name: string;
}
    `;

    // Step 1: Parse TypeScript
    const parser = new TypeScriptParser();
    const archJson = await parser.parse(tsCode);

    expect(archJson.entities).toHaveLength(2); // UserService + User

    // Step 2: Generate PlantUML
    const generator = new PlantUMLGenerator();
    const plantUML = await generator.generate(archJson);

    expect(plantUML).toContain('@startuml');
    expect(plantUML).toContain('class UserService');
    expect(plantUML).toContain('interface User');
    expect(plantUML).toContain('@enduml');
  });

  it('should handle real project files', async () => {
    const parser = new TypeScriptParser();
    const generator = new PlantUMLGenerator();

    // Parse actual ArchGuard source
    const archJson = await parser.parseFile('src/parser/typescript-parser.ts');

    expect(archJson.entities.length).toBeGreaterThan(0);

    const plantUML = await generator.generate(archJson);

    expect(plantUML).toContain('@startuml');
    expect(plantUML).toContain('TypeScriptParser');
  });
});
```

**验收标准**:
- ✅ 端到端流程正常工作
- ✅ 能处理真实项目代码
- ✅ 生成的 PlantUML 质量高

---

## 3. RLM EXECUTION - 执行阶段

### 3.1 TDD 实施流程

每个 Story 遵循严格的 Red-Green-Refactor 循环：

```
🔴 RED (写失败的测试)
  ↓
🟢 GREEN (最小实现使测试通过)
  ↓
♻️ REFACTOR (重构代码，保持测试通过)
  ↓
(下一个测试)
```

### 3.2 关键实现

#### ClaudeCodeWrapper 实现

```typescript
// src/cli/claude-code-wrapper.ts

import { execa } from 'execa';

export interface ClaudeCodeOptions {
  cliPath?: string;
  timeout?: number;
  maxRetries?: number;
}

export class ClaudeCodeWrapper {
  constructor(private options: ClaudeCodeOptions = {}) {
    this.options.cliPath = options.cliPath ?? 'claude-code';
    this.options.timeout = options.timeout ?? 30000; // 30s
    this.options.maxRetries = options.maxRetries ?? 2;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      await execa(this.options.cliPath!, ['--version'], {
        timeout: 5000
      });
      return true;
    } catch {
      return false;
    }
  }

  async execute(command: string): Promise<string> {
    const { stdout } = await execa(this.options.cliPath!, [command], {
      timeout: this.options.timeout,
      shell: true
    });
    return stdout;
  }

  async generateFromPrompt(prompt: string): Promise<string> {
    // 保存 prompt 到临时文件
    const tempFile = await this.saveTempFile(prompt);

    try {
      const { stdout } = await execa(this.options.cliPath!, [
        '--prompt-file', tempFile,
        '--format', 'code',
        '--no-interactive'
      ], {
        timeout: this.options.timeout
      });

      return stdout;
    } finally {
      await fs.unlink(tempFile);
    }
  }

  private async saveTempFile(content: string): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `archguard-${Date.now()}.txt`);
    await fs.writeFile(tempFile, content);
    return tempFile;
  }
}
```

---

## 4. RLM VALIDATION - 验证阶段

### 4.1 测试策略

| 测试类型 | 覆盖范围 | 目标 |
|---------|---------|------|
| 单元测试 | 每个组件 | ≥ 80% |
| 集成测试 | 完整流程 | ≥ 3 个场景 |
| E2E 测试 | 真实项目 | ≥ 1 个 |

### 4.2 验收标准

- [ ] 所有单元测试通过
- [ ] 测试覆盖率 ≥ 80%
- [ ] PlantUML 语法正确率 ≥ 90%
- [ ] CLI 调用成功率 ≥ 95%
- [ ] 平均生成时间 < 10s
- [ ] 能处理 ArchGuard 自身代码

---

## 5. RLM INTEGRATION - 集成阶段

### 5.1 Git 工作流

```
master
  └── phase-2-claude-code-integration
      ├── feature/cli-wrapper
      ├── feature/prompt-builder
      ├── feature/plantuml-generator
      └── feature/output-parser
```

### 5.2 提交规范

```bash
git commit -m "test: add Claude Code CLI wrapper tests (Story 1 - Red)"
git commit -m "feat: implement Claude Code CLI wrapper (Story 1 - Green)"
git commit -m "refactor: improve error handling in CLI wrapper (Story 1 - Refactor)"
```

---

## 6. RLM MONITORING - 监控阶段

### 6.1 关键指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| CLI 调用成功率 | ≥ 95% | 成功次数 / 总次数 |
| PlantUML 语法正确率 | ≥ 90% | 验证通过 / 总生成 |
| 平均生成时间 | < 10s | 平均响应时间 |
| 测试覆盖率 | ≥ 80% | Codecov 报告 |

---

## 7. 风险与缓解

### 7.1 依赖 Claude Code CLI

**风险**: Claude Code CLI 可能未安装或版本不兼容

**缓解**:
- 启动时检查 CLI 可用性
- 提供清晰的错误提示和安装指南
- 文档中说明 Claude Code 为必需依赖

### 7.2 输出格式不稳定

**风险**: Claude Code 输出格式可能变化

**缓解**:
- 鲁棒的输出解析器
- 支持多种格式提取
- 重试机制

---

## 总结

Phase 2 通过集成 Claude Code CLI，实现了简洁、可靠的 PlantUML 生成能力。关键优势：

✅ **简化集成** - 无需管理 API Key
✅ **利用现有工具** - 复用 Claude Code 配置
✅ **降低复杂度** - 移除 AI SDK 依赖
✅ **提升体验** - 与开发者工作流一致

---

**文档版本**: 1.0
**创建日期**: 2026-01-25
**状态**: ✅ 计划完成，待执行
