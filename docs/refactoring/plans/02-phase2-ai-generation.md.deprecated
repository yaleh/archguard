# Phase 2: AI 集成与文档生成 (TDD)

**阶段名称**: AI Integration & PlantUML Generation
**预计时间**: 3-4 天
**开发方法**: TDD (Test-Driven Development)
**依赖**: Phase 1 (代码指纹提取) 完成
**核心**: Claude Sonnet 集成

---

## 📋 阶段目标

实现基于 Claude Code 的智能文档生成器，能够：
1. 集成 Claude Sonnet 3.5 API
2. 设计高质量提示词模板
3. 生成符合规范的 PlantUML 类图
4. 实现输出验证和错误处理
5. 优化成本和性能

**核心价值**: 将结构化代码指纹转化为高质量的可视化架构文档

---

## 1. TDD 开发计划

### 1.1 测试用例设计

#### Story 1: Claude API 连接

**测试**:
```typescript
// __tests__/ai/claude-connector.test.ts

import { describe, it, expect, vi } from 'vitest';
import { ClaudeConnector } from '@/ai/claude-connector';

describe('ClaudeConnector', () => {
  it('should initialize with API key', () => {
    const connector = new ClaudeConnector('test-api-key');

    expect(connector).toBeDefined();
    expect(connector.getModel()).toBe('claude-3-5-sonnet-20241022');
  });

  it('should make successful API call', async () => {
    const connector = new ClaudeConnector(process.env.ANTHROPIC_API_KEY);

    const response = await connector.chat('Hello, Claude!');

    expect(response).toBeDefined();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });

  it('should handle API errors gracefully', async () => {
    const connector = new ClaudeConnector('invalid-key');

    await expect(
      connector.chat('Test')
    ).rejects.toThrow('API authentication failed');
  });

  it('should respect token limits', async () => {
    const connector = new ClaudeConnector(process.env.ANTHROPIC_API_KEY);
    const longInput = 'a'.repeat(200000); // 超过限制

    await expect(
      connector.chat(longInput)
    ).rejects.toThrow('Input exceeds token limit');
  });
});
```

**实现**:
```typescript
// src/ai/claude-connector.ts

import Anthropic from '@anthropic-ai/sdk';

export class ClaudeConnector {
  private client: Anthropic;
  private model = 'claude-3-5-sonnet-20241022';
  private maxTokens = 4096;

  constructor(apiKey: string) {
    if (!apiKey || apiKey.length === 0) {
      throw new Error('API key is required');
    }

    this.client = new Anthropic({
      apiKey
    });
  }

  getModel(): string {
    return this.model;
  }

  async chat(prompt: string): Promise<string> {
    try {
      // 检查 token 限制
      const estimatedTokens = this.estimateTokens(prompt);
      if (estimatedTokens > 100000) {
        throw new Error('Input exceeds token limit');
      }

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      return response.content[0].text;
    } catch (error) {
      if (error.status === 401) {
        throw new Error('API authentication failed');
      }
      throw error;
    }
  }

  private estimateTokens(text: string): number {
    // 粗略估算：4 字符 ≈ 1 token
    return Math.ceil(text.length / 4);
  }
}
```

---

#### Story 2: 提示词模板

**测试**:
```typescript
// __tests__/ai/prompt-builder.test.ts

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('should build basic class diagram prompt', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-01-25',
      sourceFiles: ['test.ts'],
      entities: [
        {
          id: 'UserService',
          name: 'UserService',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'findUser',
              type: 'method',
              visibility: 'public',
              parameters: [{ name: 'id', type: 'string', isOptional: false }],
              returnType: 'User'
            }
          ],
          decorators: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 }
        }
      ],
      relations: []
    };

    const prompt = builder.buildClassDiagramPrompt(archJson);

    expect(prompt).toContain('PlantUML');
    expect(prompt).toContain('UserService');
    expect(prompt).toContain('findUser');
    expect(prompt).toContain('@startuml');
  });

  it('should include few-shot examples', () => {
    const prompt = builder.buildClassDiagramPrompt(simpleArchJson);

    expect(prompt).toContain('Here are examples');
    expect(prompt).toMatch(/Input:[\s\S]*Output:/);
  });

  it('should add output constraints', () => {
    const prompt = builder.buildClassDiagramPrompt(simpleArchJson);

    expect(prompt).toContain('Requirements:');
    expect(prompt).toContain('valid PlantUML syntax');
    expect(prompt).toContain('@startuml');
    expect(prompt).toContain('@enduml');
  });
});
```

**实现**:
```typescript
// src/ai/prompt-builder.ts

import { ArchJSON } from '../types/arch-json';

export class PromptBuilder {
  private systemPrompt = `You are a senior software architect specializing in PlantUML diagrams.
Your task is to generate clean, professional UML class diagrams from architecture metadata.`;

  buildClassDiagramPrompt(archJson: ArchJSON): string {
    return `${this.systemPrompt}

${this.getFewShotExamples()}

Now generate a PlantUML class diagram for this architecture:

\`\`\`json
${JSON.stringify(archJson, null, 2)}
\`\`\`

Requirements:
1. Use valid PlantUML syntax
2. Start with @startuml and end with @enduml
3. Include all entities from the JSON
4. Show relationships with appropriate arrows
5. Use modern PlantUML theme (e.g., !theme cerulean-outline)
6. Group related classes with packages
7. Show visibility (+ public, - private, # protected)
8. Include method parameters and return types

Output ONLY the PlantUML code, no explanations.`;
  }

  private getFewShotExamples(): string {
    return `Here are examples of expected output:

Example 1:
Input:
\`\`\`json
{
  "entities": [
    { "name": "User", "type": "class", "members": [] }
  ],
  "relations": []
}
\`\`\`

Output:
\`\`\`plantuml
@startuml
!theme cerulean-outline

class User {
}

@enduml
\`\`\`

Example 2:
Input:
\`\`\`json
{
  "entities": [
    {
      "name": "UserService",
      "type": "class",
      "members": [
        {
          "name": "findUser",
          "type": "method",
          "parameters": [{"name": "id", "type": "string"}],
          "returnType": "User"
        }
      ]
    },
    {
      "name": "IUserRepository",
      "type": "interface"
    }
  ],
  "relations": [
    { "from": "UserService", "to": "IUserRepository", "type": "dependency" }
  ]
}
\`\`\`

Output:
\`\`\`plantuml
@startuml
!theme cerulean-outline

interface IUserRepository

class UserService {
  +findUser(id: string): User
}

UserService ..> IUserRepository : depends on

@enduml
\`\`\`
`;
  }
}
```

---

#### Story 3: PlantUML 生成

**测试**:
```typescript
// __tests__/ai/plantuml-generator.test.ts

describe('PlantUMLGenerator', () => {
  let generator: PlantUMLGenerator;

  beforeEach(() => {
    generator = new PlantUMLGenerator({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022'
    });
  });

  it('should generate valid PlantUML code', async () => {
    const archJson = loadFixture('simple-class.json');

    const puml = await generator.generate(archJson);

    expect(puml).toContain('@startuml');
    expect(puml).toContain('@enduml');
    expect(validatePlantUML(puml)).toBe(true);
  });

  it('should include all entities', async () => {
    const archJson: ArchJSON = {
      entities: [
        { name: 'UserService', type: 'class', /* ... */ },
        { name: 'IUserRepository', type: 'interface', /* ... */ }
      ],
      relations: []
    };

    const puml = await generator.generate(archJson);

    expect(puml).toContain('UserService');
    expect(puml).toContain('IUserRepository');
  });

  it('should show relationships', async () => {
    const archJson: ArchJSON = {
      entities: [
        { name: 'Admin', type: 'class' },
        { name: 'User', type: 'class' }
      ],
      relations: [
        { from: 'Admin', to: 'User', type: 'inheritance' }
      ]
    };

    const puml = await generator.generate(archJson);

    expect(puml).toContain('Admin');
    expect(puml).toContain('User');
    expect(puml).toMatch(/Admin\s+\|?\-+\>?\s+User/); // 继承箭头
  });

  it('should handle large projects', async () => {
    const archJson = loadFixture('archguard-self.json');

    const start = Date.now();
    const puml = await generator.generate(archJson);
    const duration = Date.now() - start;

    expect(puml.length).toBeGreaterThan(100);
    expect(duration).toBeLessThan(10000); // < 10s
  });
});
```

**实现**:
```typescript
// src/ai/plantuml-generator.ts

import { ClaudeConnector } from './claude-connector';
import { PromptBuilder } from './prompt-builder';
import { PlantUMLValidator } from './plantuml-validator';
import { ArchJSON } from '../types/arch-json';

export interface GeneratorConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
}

export class PlantUMLGenerator {
  private connector: ClaudeConnector;
  private promptBuilder: PromptBuilder;
  private validator: PlantUMLValidator;
  private maxRetries: number;

  constructor(config: GeneratorConfig) {
    this.connector = new ClaudeConnector(config.apiKey);
    this.promptBuilder = new PromptBuilder();
    this.validator = new PlantUMLValidator();
    this.maxRetries = config.maxRetries || 3;
  }

  async generate(archJson: ArchJSON): Promise<string> {
    const prompt = this.promptBuilder.buildClassDiagramPrompt(archJson);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.connector.chat(prompt);
        const puml = this.extractPlantUML(response);

        // 验证输出
        const validation = this.validator.validate(puml, archJson);

        if (validation.isValid) {
          return puml;
        }

        // 验证失败，尝试修复
        if (attempt < this.maxRetries) {
          console.warn(`Validation failed (attempt ${attempt}), retrying...`);
          console.warn(`Issues: ${validation.issues.join(', ')}`);
        }
      } catch (error) {
        if (attempt === this.maxRetries) {
          throw new Error(`Failed to generate PlantUML after ${this.maxRetries} attempts: ${error.message}`);
        }
        console.warn(`API call failed (attempt ${attempt}), retrying...`);
      }
    }

    throw new Error('Failed to generate valid PlantUML');
  }

  private extractPlantUML(response: string): string {
    // 提取 ```plantuml ... ``` 代码块
    const match = response.match(/```(?:plantuml)?\s*([\s\S]*?)```/);

    if (match) {
      return match[1].trim();
    }

    // 如果没有代码块，尝试查找 @startuml ... @enduml
    const umlMatch = response.match(/@startuml[\s\S]*@enduml/);

    if (umlMatch) {
      return umlMatch[0];
    }

    // 假设整个响应都是 PlantUML
    return response.trim();
  }
}
```

---

#### Story 4: 输出验证

**测试**:
```typescript
// __tests__/ai/plantuml-validator.test.ts

describe('PlantUMLValidator', () => {
  const validator = new PlantUMLValidator();

  describe('syntax validation', () => {
    it('should validate correct syntax', () => {
      const puml = `
@startuml
class User
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing @startuml', () => {
      const puml = `
class User
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing @startuml');
    });

    it('should detect missing @enduml', () => {
      const puml = `
@startuml
class User
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing @enduml');
    });
  });

  describe('completeness validation', () => {
    it('should verify all entities are present', () => {
      const archJson: ArchJSON = {
        entities: [
          { name: 'User', type: 'class' },
          { name: 'Admin', type: 'class' }
        ],
        relations: []
      };

      const puml = `
@startuml
class User
class Admin
@enduml
      `;

      const result = validator.validateCompleteness(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.missingEntities).toHaveLength(0);
    });

    it('should detect missing entities', () => {
      const archJson: ArchJSON = {
        entities: [
          { name: 'User', type: 'class' },
          { name: 'Admin', type: 'class' }
        ],
        relations: []
      };

      const puml = `
@startuml
class User
@enduml
      `;

      const result = validator.validateCompleteness(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.missingEntities).toContain('Admin');
    });
  });

  describe('full validation', () => {
    it('should perform complete validation', () => {
      const archJson = loadFixture('simple-class.json');
      const puml = loadFixture('simple-class.puml');

      const result = validator.validate(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});
```

**实现**:
```typescript
// src/ai/plantuml-validator.ts

import { ArchJSON } from '../types/arch-json';

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  errors?: string[];
  missingEntities?: string[];
}

export class PlantUMLValidator {
  validate(puml: string, archJson: ArchJSON): ValidationResult {
    const issues: string[] = [];

    // 1. 语法检查
    const syntaxResult = this.validateSyntax(puml);
    if (!syntaxResult.isValid) {
      issues.push(...syntaxResult.errors);
    }

    // 2. 完整性检查
    const completenessResult = this.validateCompleteness(puml, archJson);
    if (!completenessResult.isValid) {
      issues.push(...completenessResult.missingEntities.map(
        e => `Missing entity: ${e}`
      ));
    }

    // 3. 风格检查
    const styleResult = this.validateStyle(puml);
    if (!styleResult.isValid) {
      issues.push(...styleResult.warnings);
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  validateSyntax(puml: string): ValidationResult {
    const errors: string[] = [];

    if (!puml.includes('@startuml')) {
      errors.push('Missing @startuml');
    }

    if (!puml.includes('@enduml')) {
      errors.push('Missing @enduml');
    }

    // 检查基本语法错误
    if (puml.includes('class class')) {
      errors.push('Duplicate "class" keyword');
    }

    return {
      isValid: errors.length === 0,
      errors,
      issues: errors
    };
  }

  validateCompleteness(puml: string, archJson: ArchJSON): ValidationResult {
    const missingEntities: string[] = [];

    for (const entity of archJson.entities) {
      // 检查实体名称是否在 PlantUML 中
      const regex = new RegExp(`\\b(class|interface|enum)\\s+${entity.name}\\b`);
      if (!regex.test(puml)) {
        missingEntities.push(entity.name);
      }
    }

    return {
      isValid: missingEntities.length === 0,
      missingEntities,
      issues: missingEntities.map(e => `Missing: ${e}`)
    };
  }

  validateStyle(puml: string): ValidationResult {
    const warnings: string[] = [];

    if (!puml.includes('!theme')) {
      warnings.push('Consider adding a theme (!theme cerulean-outline)');
    }

    if (!puml.includes('package')) {
      warnings.push('Consider grouping classes with packages');
    }

    return {
      isValid: true, // 风格问题不阻塞
      issues: warnings
    };
  }
}
```

---

### 1.2 TDD 红-绿-重构循环

#### 循环示例: PlantUML 生成

**🔴 Red**:
```typescript
it('should generate valid PlantUML', async () => {
  const generator = new PlantUMLGenerator({ apiKey: 'test' });
  const puml = await generator.generate(simpleArchJson);

  expect(puml).toContain('@startuml');
  // FAIL: PlantUMLGenerator not implemented
});
```

**🟢 Green**:
```typescript
async generate(archJson: ArchJSON): Promise<string> {
  // 最小实现
  return '@startuml\nclass User\n@enduml';
}
```

**♻️ Refactor**:
```typescript
async generate(archJson: ArchJSON): Promise<string> {
  const prompt = this.buildPrompt(archJson);
  const response = await this.callAPI(prompt);
  const puml = this.extractPuml(response);
  this.validate(puml);
  return puml;
}
```

---

## 2. 实现计划

### Day 1: Claude 集成

**上午** (3h):
- ✅ 环境配置（API Key）
- ✅ ClaudeConnector 基础实现
- ✅ 错误处理和重试机制

**下午** (4h):
- ✅ PromptBuilder 实现
- ✅ Few-shot 示例设计
- ✅ 提示词优化测试

**交付物**:
- `src/ai/claude-connector.ts`
- `src/ai/prompt-builder.ts`
- 对应测试文件

**验收**:
- [ ] 能成功调用 Claude API
- [ ] 提示词模板完整
- [ ] 测试覆盖率 > 80%

---

### Day 2: PlantUML 生成

**上午** (3h):
- ✅ PlantUMLGenerator 主逻辑
- ✅ 响应解析
- ✅ 重试机制

**下午** (4h):
- ✅ PlantUMLValidator 实现
- ✅ 语法验证
- ✅ 完整性验证

**交付物**:
- `src/ai/plantuml-generator.ts`
- `src/ai/plantuml-validator.ts`
- 集成测试

**验收**:
- [ ] 能生成基本类图
- [ ] 验证功能完整
- [ ] 测试覆盖率 > 80%

---

### Day 3: 优化与增强

**上午** (3h):
- ✅ 成本追踪
- ✅ 性能优化
- ✅ 缓存机制

**下午** (4h):
- ✅ 错误恢复
- ✅ 输出修复
- ✅ 边缘情况处理

**交付物**:
- `src/ai/cost-tracker.ts`
- `src/ai/output-fixer.ts`
- 性能测试

**验收**:
- [ ] 成本追踪准确
- [ ] 性能达标
- [ ] 边缘情况覆盖

---

### Day 4: 集成测试

**全天** (7h):
- ✅ 端到端测试
- ✅ ArchGuard 自测
- ✅ 文档完善
- ✅ Bug 修复

**交付物**:
- `__tests__/e2e/ai-generation.test.ts`
- API 文档
- 性能报告

**验收**:
- [ ] E2E 测试通过
- [ ] 自测成功
- [ ] 文档完整

---

## 3. 提示词工程

### 3.1 系统提示词

```typescript
const SYSTEM_PROMPT = `You are a senior software architect and PlantUML expert.

Your responsibilities:
1. Generate clean, professional UML diagrams
2. Follow PlantUML best practices
3. Use modern themes and styling
4. Ensure diagrams are readable and well-organized

Quality standards:
- Syntax must be 100% valid
- All entities from input must be included
- Relationships must be accurately represented
- Visibility modifiers must be shown
- Code should be well-formatted

Output format:
- Start with @startuml
- Include theme declaration
- Use packages for organization
- End with @enduml
- No explanations, only code`;
```

### 3.2 Few-Shot 示例库

```typescript
const FEW_SHOT_EXAMPLES = [
  {
    description: 'Simple class',
    input: { /* ArchJSON */ },
    output: `@startuml
!theme cerulean-outline

class User {
  -id: string
  -name: string
  +getName(): string
}

@enduml`
  },
  {
    description: 'Inheritance',
    input: { /* ArchJSON with inheritance */ },
    output: `@startuml
!theme cerulean-outline

class User {
  #email: string
}

class Admin {
  -role: string
}

Admin --|> User : extends

@enduml`
  },
  {
    description: 'Interface implementation',
    input: { /* ArchJSON with interface */ },
    output: `@startuml
!theme cerulean-outline

interface IUserRepository {
  +findById(id: string): User
  +save(user: User): void
}

class UserRepository {
  -db: Database
  +findById(id: string): User
  +save(user: User): void
}

UserRepository ..|> IUserRepository : implements

@enduml`
  }
];
```

### 3.3 约束和要求

```typescript
const OUTPUT_CONSTRAINTS = `
Requirements:
1. Syntax: Valid PlantUML (test with plantuml.com)
2. Structure: @startuml...@enduml
3. Theme: Use !theme cerulean-outline
4. Visibility:
   - + for public
   - - for private
   - # for protected
5. Types: Include parameter and return types
6. Organization: Group related classes with packages
7. Relationships:
   - --|> for inheritance
   - ..|> for implementation
   - --* for composition
   - --> for dependency
8. Formatting: Clean, readable, consistent indentation

DO NOT:
- Add explanatory text
- Use invalid PlantUML syntax
- Omit entities from input
- Add entities not in input
`;
```

---

## 4. 成本优化

### 4.1 成本追踪

```typescript
// src/ai/cost-tracker.ts

export class CostTracker {
  private totalTokens = 0;
  private totalCost = 0;
  private callCount = 0;

  // Claude 3.5 Sonnet 定价 (2026-01-25)
  private readonly COST_PER_1M_INPUT = 3.00;   // $3/M tokens
  private readonly COST_PER_1M_OUTPUT = 15.00; // $15/M tokens

  trackCall(inputTokens: number, outputTokens: number): void {
    this.totalTokens += inputTokens + outputTokens;
    this.callCount++;

    const inputCost = (inputTokens / 1_000_000) * this.COST_PER_1M_INPUT;
    const outputCost = (outputTokens / 1_000_000) * this.COST_PER_1M_OUTPUT;

    this.totalCost += inputCost + outputCost;
  }

  getReport(): CostReport {
    return {
      totalCalls: this.callCount,
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
      avgCostPerCall: this.totalCost / this.callCount,
      avgTokensPerCall: this.totalTokens / this.callCount
    };
  }
}
```

### 4.2 成本优化策略

**1. 输入优化**:
```typescript
// 只发送必要的信息
function optimizeArchJSON(archJson: ArchJSON): ArchJSON {
  return {
    entities: archJson.entities.map(e => ({
      name: e.name,
      type: e.type,
      members: e.members.map(m => ({
        name: m.name,
        type: m.type,
        // 省略 sourceLocation 等非必要字段
      }))
    })),
    relations: archJson.relations
    // 省略 timestamp, sourceFiles 等元数据
  };
}
```

**2. 批处理**:
```typescript
// 合并多个小文件
async generateBatch(archJsons: ArchJSON[]): Promise<string> {
  const merged = this.mergeArchJSONs(archJsons);
  return await this.generate(merged);
}
```

**3. 缓存**:
```typescript
class GenerationCache {
  private cache = new Map<string, string>();

  getCached(archJson: ArchJSON): string | null {
    const key = this.hash(archJson);
    return this.cache.get(key) || null;
  }

  setCached(archJson: ArchJSON, result: string): void {
    const key = this.hash(archJson);
    this.cache.set(key, result);
  }

  private hash(archJson: ArchJSON): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(archJson))
      .digest('hex');
  }
}
```

---

## 5. 性能基准

### 5.1 目标

| 场景 | 实体数 | 目标时间 | 目标成本 |
|------|--------|---------|---------|
| 小项目 | 1-5 | < 3s | < $0.01 |
| 中项目 | 5-20 | < 5s | < $0.03 |
| 大项目 | 20-50 | < 10s | < $0.10 |

### 5.2 性能测试

```typescript
// __tests__/performance/ai-benchmark.test.ts

describe('AI Generation Performance', () => {
  it('should generate small project diagram quickly', async () => {
    const archJson = loadFixture('small-project.json'); // 5 entities
    const generator = new PlantUMLGenerator({ apiKey });

    const start = Date.now();
    await generator.generate(archJson);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(3000);
  });

  it('should stay within cost budget', async () => {
    const archJson = loadFixture('medium-project.json'); // 20 entities
    const tracker = new CostTracker();
    const generator = new PlantUMLGenerator({ apiKey, tracker });

    await generator.generate(archJson);

    const report = tracker.getReport();
    expect(report.totalCost).toBeLessThan(0.03);
  });
});
```

---

## 6. 错误处理

### 6.1 错误类型

```typescript
export class AIGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean
  ) {
    super(message);
  }
}

export enum ErrorCode {
  API_AUTH_FAILED = 'API_AUTH_FAILED',
  API_TIMEOUT = 'API_TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_OUTPUT = 'INVALID_OUTPUT',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNKNOWN = 'UNKNOWN'
}
```

### 6.2 重试策略

```typescript
async generateWithRetry(archJson: ArchJSON): Promise<string> {
  const maxRetries = 3;
  const backoff = [1000, 2000, 5000]; // exponential backoff

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.generate(archJson);
    } catch (error) {
      if (!this.isRetryable(error) || attempt === maxRetries - 1) {
        throw error;
      }

      console.warn(`Attempt ${attempt + 1} failed, retrying...`);
      await this.sleep(backoff[attempt]);
    }
  }
}

private isRetryable(error: Error): boolean {
  return error instanceof AIGenerationError && error.retryable;
}
```

---

## 7. 验收标准

### 7.1 功能完整性

- [ ] **Claude 集成**
  - [ ] 成功调用 API
  - [ ] 正确处理响应
  - [ ] 错误处理完善

- [ ] **PlantUML 生成**
  - [ ] 语法正确率 ≥ 95%
  - [ ] 包含所有实体
  - [ ] 关系表示准确
  - [ ] 使用现代主题

- [ ] **验证功能**
  - [ ] 语法检查
  - [ ] 完整性检查
  - [ ] 风格检查

### 7.2 质量指标

- [ ] 测试覆盖率 ≥ 80%
- [ ] API 调用成功率 ≥ 99%
- [ ] 输出验证通过率 ≥ 95%

### 7.3 性能指标

- [ ] 小项目 (5 entities) < 3s
- [ ] 中项目 (20 entities) < 5s
- [ ] 大项目 (50 entities) < 10s

### 7.4 成本指标

- [ ] 小项目 < $0.01/次
- [ ] 中项目 < $0.03/次
- [ ] 大项目 < $0.10/次

---

## 8. 交付清单

### 8.1 代码文件

- [ ] `src/ai/claude-connector.ts`
- [ ] `src/ai/prompt-builder.ts`
- [ ] `src/ai/plantuml-generator.ts`
- [ ] `src/ai/plantuml-validator.ts`
- [ ] `src/ai/cost-tracker.ts`
- [ ] `src/ai/output-fixer.ts`

### 8.2 测试文件

- [ ] `__tests__/ai/claude-connector.test.ts`
- [ ] `__tests__/ai/prompt-builder.test.ts`
- [ ] `__tests__/ai/plantuml-generator.test.ts`
- [ ] `__tests__/ai/plantuml-validator.test.ts`
- [ ] `__tests__/e2e/ai-generation.test.ts`
- [ ] `__tests__/performance/ai-benchmark.test.ts`

### 8.3 文档

- [ ] API 文档 (JSDoc)
- [ ] 提示词工程指南
- [ ] 成本优化建议
- [ ] 故障排查指南

---

## 9. 下一步

Phase 2 完成后：
1. 代码审查
2. 性能优化
3. 准备 Phase 3: CLI 与整合
4. 提示词迭代优化

---

**版本**: 1.0
**状态**: ✅ 准备开始
**依赖**: Phase 1 完成
