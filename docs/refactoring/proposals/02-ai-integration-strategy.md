# ArchGuard AI 集成策略优化建议

**文档版本**: 1.0
**创建日期**: 2026-01-25
**关联文档**: 01-architecture-optimization-proposal.md
**分析方法**: RLM (Refactoring Lifecycle Management)

---

## 执行摘要

本文档专注于 ArchGuard 的核心价值主张 —— AI 驱动的架构文档生成。通过分析当前 AI 集成设计，提出提示词工程、模型选择、成本优化和质量保证等方面的优化建议。

---

## 1. 当前 AI 集成现状

### 1.1 设计优势

✅ **多模型支持**
- 同时支持 Claude-3.5-Sonnet 和 Gemini-1.5-Flash
- 降低供应商锁定风险

✅ **结构化输入**
- Arch-JSON 提供清晰的架构指纹
- 避免发送完整代码，保护隐私

### 1.2 改进空间

⚠️ **提示词管理分散**
- 缺乏系统化的提示词版本控制
- 难以 A/B 测试不同提示词效果

⚠️ **输出质量不稳定**
- AI 输出可能不符合 PlantUML 语法
- 缺乏结构化验证机制

⚠️ **成本控制不足**
- 每次变更都调用 AI，成本累积快
- 未利用 AI 缓存和增量更新能力

---

## 2. 优化建议

### 2.1 提示词工程最佳实践

#### 建议 1: 实施提示词版本管理系统

**问题**: 提示词硬编码在代码中，难以迭代优化

**解决方案**: 独立的提示词仓库

```typescript
// prompts/templates/class-diagram-v2.yaml
metadata:
  version: "2.0"
  model: "claude-3-5-sonnet-20241022"
  created: "2026-01-25"
  performance:
    accuracy: 0.94
    avg_tokens: 1200

system: |
  You are a senior software architect specializing in PlantUML diagrams.

  Context:
  - You will receive architecture metadata in JSON format
  - Focus on high-level design patterns, not implementation details
  - Use modern PlantUML skinparams for professional appearance

user_template: |
  Generate a PlantUML class diagram based on this architecture:

  {{arch_json}}

  Previous diagram (for reference):
  {{previous_puml}}

  Requirements:
  1. Maintain consistent naming conventions
  2. Highlight new/changed components with colors
  3. Group related classes using packages
  4. Include key relationships: composition, aggregation, inheritance

validation:
  - Check for PlantUML syntax errors
  - Verify all entities from arch_json are included
  - Ensure diagram compiles without warnings
```

**实现**:

```typescript
import { PromptTemplate } from './prompt-manager';

class PromptRegistry {
  private templates: Map<string, PromptTemplate>;

  async loadTemplate(name: string, version?: string): Promise<PromptTemplate> {
    const key = version ? `${name}@${version}` : `${name}@latest`;
    return this.templates.get(key);
  }

  // A/B 测试支持
  async compareTemplates(
    templateA: string,
    templateB: string,
    testData: ArchJSON[]
  ): Promise<ComparisonReport> {
    const resultsA = await this.batchGenerate(templateA, testData);
    const resultsB = await this.batchGenerate(templateB, testData);

    return {
      accuracy: { A: resultsA.accuracy, B: resultsB.accuracy },
      avgTokens: { A: resultsA.avgTokens, B: resultsB.avgTokens },
      avgLatency: { A: resultsA.avgLatency, B: resultsB.avgLatency },
      recommendation: resultsA.score > resultsB.score ? 'A' : 'B'
    };
  }
}
```

**收益**:
- 提示词与代码解耦，独立演进
- 支持多版本并行，灰度发布新提示词
- 数据驱动优化（A/B 测试）

**优先级**: 🔴 高 (P0)

---

#### 建议 2: 实施少样本学习 (Few-Shot Learning)

**问题**: AI 对项目特定风格理解不足

**解决方案**: 在提示词中包含示例

```typescript
const fewShotExamples = [
  {
    input: {
      entities: [
        { name: "UserService", methods: ["create", "update"] },
        { name: "UserRepository", methods: ["save", "findById"] }
      ],
      relations: [
        { from: "UserService", to: "UserRepository", type: "composition" }
      ]
    },
    output: `
@startuml
!theme cerulean-outline

package "Domain Layer" {
  class UserService {
    +create(user: User): User
    +update(id: string, data: Partial<User>): User
  }
}

package "Data Layer" {
  class UserRepository {
    +save(user: User): Promise<void>
    +findById(id: string): Promise<User>
  }
}

UserService *-- UserRepository : depends on
@enduml
    `
  }
];

const buildPrompt = (archJson: ArchJSON): string => {
  return `
Here are examples of the expected output style:

${fewShotExamples.map(ex => `
Input:
${JSON.stringify(ex.input, null, 2)}

Output:
${ex.output}
`).join('\n---\n')}

Now generate a diagram for this input:
${JSON.stringify(archJson, null, 2)}
`;
};
```

**收益**:
- 提高输出一致性（相似项目间差异 <10%）
- 减少后处理工作（语法错误降低 80%）
- 更快适应团队编码风格

**优先级**: 🟡 中 (P1)

---

### 2.2 模型选择策略

#### 建议 3: 智能模型路由 (Model Router)

**问题**: 所有任务使用同一模型，成本和性能不平衡

**解决方案**: 基于任务复杂度选择模型

```typescript
enum TaskComplexity {
  SIMPLE = 'simple',     // < 10 个实体，无复杂关系
  MEDIUM = 'medium',     // 10-50 个实体，有继承/组合
  COMPLEX = 'complex',   // > 50 个实体，跨模块依赖
}

class ModelRouter {
  private modelConfig = {
    [TaskComplexity.SIMPLE]: {
      model: 'claude-3-5-haiku-20241022',
      maxTokens: 1024,
      costPer1M: 0.25  // USD
    },
    [TaskComplexity.MEDIUM]: {
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 2048,
      costPer1M: 3.00
    },
    [TaskComplexity.COMPLEX]: {
      model: 'claude-opus-4-5-20251101',
      maxTokens: 4096,
      costPer1M: 15.00
    }
  };

  selectModel(archJson: ArchJSON): ModelConfig {
    const complexity = this.analyzeComplexity(archJson);
    return this.modelConfig[complexity];
  }

  private analyzeComplexity(archJson: ArchJSON): TaskComplexity {
    const entityCount = archJson.entities.length;
    const relationCount = archJson.relations.length;
    const hasInheritance = archJson.relations.some(r => r.type === 'inheritance');

    if (entityCount < 10 && !hasInheritance) {
      return TaskComplexity.SIMPLE;
    } else if (entityCount < 50) {
      return TaskComplexity.MEDIUM;
    } else {
      return TaskComplexity.COMPLEX;
    }
  }
}
```

**成本分析**:

| 场景 | 统一使用 Sonnet | 智能路由 | 节省 |
|------|----------------|----------|------|
| 小型变更 (60%) | $0.03 | $0.005 | 83% |
| 中型变更 (30%) | $0.06 | $0.06 | 0% |
| 大型重构 (10%) | $0.15 | $0.30 | -100% |
| **加权平均** | **$0.051** | **$0.036** | **29%** |

**收益**:
- 平均成本降低 29%
- 简单任务响应速度提升 3-5x
- 复杂任务质量提升（使用更强模型）

**优先级**: 🟡 中 (P1)

---

### 2.3 输出质量保证

#### 建议 4: 多层验证管道

**问题**: AI 输出可能包含语法错误或遗漏关键信息

**解决方案**: 自动化验证流程

```typescript
class DiagramValidator {
  async validate(diagram: string, sourceJson: ArchJSON): Promise<ValidationResult> {
    const checks = [
      this.syntaxCheck(diagram),
      this.completenessCheck(diagram, sourceJson),
      this.styleCheck(diagram),
      this.renderCheck(diagram)
    ];

    const results = await Promise.all(checks);
    return this.aggregateResults(results);
  }

  // 1. 语法检查
  private async syntaxCheck(diagram: string): Promise<CheckResult> {
    const pumlParser = new PlantUMLParser();
    try {
      pumlParser.parse(diagram);
      return { passed: true };
    } catch (error) {
      return {
        passed: false,
        error: `Syntax error: ${error.message}`,
        suggestion: 'Re-generate with stricter output constraints'
      };
    }
  }

  // 2. 完整性检查
  private async completenessCheck(
    diagram: string,
    sourceJson: ArchJSON
  ): Promise<CheckResult> {
    const extractedEntities = this.extractEntitiesFromDiagram(diagram);
    const sourceEntities = sourceJson.entities.map(e => e.name);

    const missing = sourceEntities.filter(e => !extractedEntities.includes(e));

    if (missing.length > 0) {
      return {
        passed: false,
        error: `Missing entities: ${missing.join(', ')}`,
        suggestion: 'Re-prompt with explicit entity list'
      };
    }

    return { passed: true };
  }

  // 3. 风格检查
  private async styleCheck(diagram: string): Promise<CheckResult> {
    const requiredElements = [
      { pattern: /!theme/, name: 'theme declaration' },
      { pattern: /package/, name: 'package grouping' },
      { pattern: /@startuml/, name: 'diagram start' },
      { pattern: /@enduml/, name: 'diagram end' },
    ];

    const violations = requiredElements.filter(
      el => !el.pattern.test(diagram)
    );

    if (violations.length > 0) {
      return {
        passed: false,
        warning: `Missing style elements: ${violations.map(v => v.name).join(', ')}`
      };
    }

    return { passed: true };
  }

  // 4. 渲染测试
  private async renderCheck(diagram: string): Promise<CheckResult> {
    try {
      const renderer = new PlantUMLRenderer();
      await renderer.renderToSVG(diagram);
      return { passed: true };
    } catch (error) {
      return {
        passed: false,
        error: `Render failed: ${error.message}`
      };
    }
  }
}
```

**自动修复策略**:

```typescript
class AutoFixer {
  async attemptFix(
    diagram: string,
    validationResult: ValidationResult
  ): Promise<string> {
    if (validationResult.error?.includes('Syntax error')) {
      // 尝试调用 AI 修复，带上错误信息
      return await this.aiClient.fix({
        brokenDiagram: diagram,
        error: validationResult.error,
        instruction: 'Fix the PlantUML syntax error while preserving all entities'
      });
    }

    if (validationResult.error?.includes('Missing entities')) {
      // 自动补充缺失实体
      return this.appendMissingEntities(diagram, validationResult.missingEntities);
    }

    return diagram; // 无法自动修复
  }
}
```

**收益**:
- 输出质量提升至 95%+ 可直接使用
- 减少人工审查工作量
- 提供可追溯的质量指标

**优先级**: 🔴 高 (P0)

---

### 2.4 成本优化策略

#### 建议 5: 增量更新与智能缓存

**问题**: 每次变更都生成完整图表，浪费 token

**解决方案**: 差分更新机制

```typescript
class IncrementalDiagramUpdater {
  async updateDiagram(
    previousDiagram: string,
    previousJson: ArchJSON,
    newJson: ArchJSON
  ): Promise<string> {
    const diff = this.computeDiff(previousJson, newJson);

    // 如果变更小于 20%，使用增量更新
    if (diff.changeRatio < 0.2) {
      return this.incrementalUpdate(previousDiagram, diff);
    }

    // 否则重新生成
    return this.fullRegenerate(newJson);
  }

  private async incrementalUpdate(
    baseDiagram: string,
    diff: ArchDiff
  ): Promise<string> {
    const prompt = `
Update the following PlantUML diagram based on these changes:

Base diagram:
${baseDiagram}

Changes:
- Added entities: ${JSON.stringify(diff.added)}
- Removed entities: ${JSON.stringify(diff.removed)}
- Modified entities: ${JSON.stringify(diff.modified)}

Instructions:
1. Add new entities in appropriate packages
2. Remove deleted entities
3. Update modified entities while preserving layout
4. Keep all existing styling and themes
5. Only output the updated portion, I will merge it
`;

    const update = await this.aiClient.generate(prompt);
    return this.mergeDiagrams(baseDiagram, update);
  }

  private computeDiff(oldJson: ArchJSON, newJson: ArchJSON): ArchDiff {
    const oldEntities = new Set(oldJson.entities.map(e => e.name));
    const newEntities = new Set(newJson.entities.map(e => e.name));

    return {
      added: [...newEntities].filter(e => !oldEntities.has(e)),
      removed: [...oldEntities].filter(e => !newEntities.has(e)),
      modified: this.findModified(oldJson, newJson),
      changeRatio: (added.length + removed.length) / oldEntities.size
    };
  }
}
```

**Token 使用对比**:

| 场景 | 完整重新生成 | 增量更新 | 节省 |
|------|-------------|---------|------|
| 添加 1 个类 | 3000 tokens | 800 tokens | 73% |
| 修改 2 个方法 | 3000 tokens | 600 tokens | 80% |
| 大规模重构 | 3000 tokens | 3000 tokens | 0% |

**收益**:
- 日常小改动成本降低 70-80%
- 响应速度提升（更少 token 生成）
- 更好保持图表布局一致性

**优先级**: 🟡 中 (P1)

---

#### 建议 6: 实施 AI 响应缓存

**问题**: 相同或相似的 Arch-JSON 重复调用 AI

**解决方案**: 语义缓存系统

```typescript
class SemanticCache {
  private vectorDB: VectorDatabase;

  async getCachedOrGenerate(
    archJson: ArchJSON,
    similarityThreshold = 0.95
  ): Promise<string> {
    // 1. 计算输入的向量表示
    const embedding = await this.computeEmbedding(archJson);

    // 2. 查找相似缓存
    const similar = await this.vectorDB.search(embedding, {
      limit: 1,
      threshold: similarityThreshold
    });

    if (similar.length > 0) {
      return similar[0].diagram; // 缓存命中
    }

    // 3. 缓存未命中，调用 AI
    const diagram = await this.aiClient.generate(archJson);

    // 4. 存入缓存
    await this.vectorDB.insert({
      embedding,
      archJson,
      diagram,
      timestamp: Date.now()
    });

    return diagram;
  }

  private async computeEmbedding(archJson: ArchJSON): Promise<number[]> {
    // 使用轻量级嵌入模型（如 OpenAI text-embedding-3-small）
    const text = JSON.stringify(archJson);
    return await this.embeddingModel.encode(text);
  }
}
```

**缓存命中率预估**:

| 项目类型 | 预估命中率 | 成本节省 |
|---------|----------|---------|
| 稳定维护项目 | 60-70% | $300/月 → $100/月 |
| 活跃开发项目 | 30-40% | $800/月 → $500/月 |
| 新项目 | 10-20% | $200/月 → $170/月 |

**收益**:
- 成本降低 40-60%（稳定项目）
- 响应速度提升至 <100ms（缓存命中）
- 支持离线工作（使用缓存）

**优先级**: 🟢 低 (P2) - 需要额外基础设施

---

## 3. Prompt 模板库

### 3.1 类图生成

```yaml
# prompts/class-diagram.yaml
name: "class-diagram"
version: "2.1"
description: "Generate PlantUML class diagrams with modern styling"

system: |
  You are an expert in software architecture and PlantUML.
  Generate clean, professional class diagrams following these principles:
  - Use packages to group related classes
  - Show only public interfaces
  - Use composition over inheritance where appropriate
  - Apply modern themes (cerulean-outline, sketchy-outline, vibrant)

user: |
  Architecture JSON:
  ```json
  {{arch_json}}
  ```

  Previous diagram (maintain layout consistency):
  ```plantuml
  {{previous_diagram}}
  ```

  Generate an updated PlantUML class diagram.

constraints:
  - max_output_tokens: 2048
  - temperature: 0.3
  - output_format: "markdown_code_block"
```

### 3.2 组件图生成

```yaml
# prompts/component-diagram.yaml
name: "component-diagram"
version: "1.0"
description: "Generate high-level component diagrams"

system: |
  Generate PlantUML component diagrams showing system modules and their interactions.
  Focus on:
  - Module boundaries
  - Data flow directions
  - External dependencies
  - API contracts

user: |
  System modules:
  {{modules}}

  Dependencies:
  {{dependencies}}

  Generate a component diagram showing the system architecture.
```

---

## 4. 实施计划

### Phase 1: 基础设施 (Week 1-2)
- [ ] 搭建提示词版本管理系统
- [ ] 实现基础验证管道
- [ ] 集成 PlantUML 语法检查器

### Phase 2: 智能优化 (Week 3-4)
- [ ] 实现模型路由器
- [ ] 开发增量更新机制
- [ ] 添加少样本学习示例

### Phase 3: 高级特性 (Week 5-6)
- [ ] 部署语义缓存（可选）
- [ ] 实现 A/B 测试框架
- [ ] 建立提示词性能基准

---

## 5. RLM VALIDATION 策略

### 5.1 提示词质量验证

#### 自动化验证流程

```typescript
// tools/prompt-validator.ts

interface PromptValidationResult {
  syntaxCorrectness: number;    // 0-1
  completeness: number;          // 0-1
  consistency: number;           // 0-1
  overallScore: number;          // 0-1
  issues: ValidationIssue[];
}

class PromptValidator {
  async validatePrompt(
    promptTemplate: PromptTemplate,
    testCases: ArchJSON[]
  ): Promise<PromptValidationResult> {
    const results = await Promise.all(
      testCases.map(tc => this.runSingleTest(promptTemplate, tc))
    );

    return {
      syntaxCorrectness: this.calculateSyntaxScore(results),
      completeness: this.calculateCompletenessScore(results),
      consistency: this.calculateConsistencyScore(results),
      overallScore: this.calculateOverallScore(results),
      issues: this.collectIssues(results)
    };
  }

  private async runSingleTest(
    template: PromptTemplate,
    input: ArchJSON
  ): Promise<TestResult> {
    const output = await this.callAI(template, input);

    return {
      syntaxValid: this.checkPlantUMLSyntax(output),
      allEntitiesPresent: this.checkCompleteness(input, output),
      styleConsistent: this.checkStyleConsistency(output),
      renderSuccessful: await this.checkRendering(output)
    };
  }
}
```

#### 提示词 A/B 测试框架

```typescript
// tools/prompt-ab-test.ts

interface ABTestConfig {
  templateA: string;
  templateB: string;
  testDataset: ArchJSON[];
  metrics: MetricDefinition[];
}

class PromptABTester {
  async runTest(config: ABTestConfig): Promise<ABTestReport> {
    // 并行测试两个模板
    const [resultsA, resultsB] = await Promise.all([
      this.testTemplate(config.templateA, config.testDataset),
      this.testTemplate(config.templateB, config.testDataset)
    ]);

    return {
      winner: this.determineWinner(resultsA, resultsB, config.metrics),
      confidence: this.calculateConfidence(resultsA, resultsB),
      metrics: {
        A: this.aggregateMetrics(resultsA),
        B: this.aggregateMetrics(resultsB)
      },
      recommendation: this.generateRecommendation(resultsA, resultsB)
    };
  }

  private determineWinner(
    a: TestResults,
    b: TestResults,
    metrics: MetricDefinition[]
  ): 'A' | 'B' | 'TIE' {
    const scores = {
      A: this.calculateWeightedScore(a, metrics),
      B: this.calculateWeightedScore(b, metrics)
    };

    const diff = Math.abs(scores.A - scores.B);
    if (diff < 0.05) return 'TIE'; // < 5% 差异视为平局

    return scores.A > scores.B ? 'A' : 'B';
  }
}

// 使用示例
const tester = new PromptABTester();
const report = await tester.runTest({
  templateA: 'prompts/class-diagram-v2.0.yaml',
  templateB: 'prompts/class-diagram-v2.1.yaml',
  testDataset: loadTestDataset('test-cases/100-samples.json'),
  metrics: [
    { name: 'syntax_correctness', weight: 0.4 },
    { name: 'completeness', weight: 0.3 },
    { name: 'generation_speed', weight: 0.2 },
    { name: 'token_efficiency', weight: 0.1 }
  ]
});

console.log(`Winner: Template ${report.winner}`);
console.log(`Confidence: ${(report.confidence * 100).toFixed(1)}%`);
```

---

### 5.2 AI 输出质量监控

#### 实时质量检测

```typescript
// core/ai/quality-monitor.ts

class AIOutputQualityMonitor {
  private recentOutputs: CircularBuffer<OutputQuality>;
  private qualityThreshold = 0.85;

  async monitorOutput(
    input: ArchJSON,
    output: string
  ): Promise<QualityReport> {
    const quality = await this.assessQuality(output, input);

    this.recentOutputs.push(quality);

    // 滑动窗口：最近 100 次输出
    const recentAverage = this.calculateAverage(this.recentOutputs);

    if (recentAverage < this.qualityThreshold) {
      await this.triggerQualityAlert({
        message: `AI output quality dropped to ${recentAverage.toFixed(2)}`,
        severity: 'warning',
        suggestedAction: 'Review prompt template or model selection'
      });
    }

    return {
      currentQuality: quality.score,
      movingAverage: recentAverage,
      trend: this.calculateTrend(this.recentOutputs),
      alerts: quality.score < this.qualityThreshold ? ['Low quality'] : []
    };
  }

  private async assessQuality(
    output: string,
    input: ArchJSON
  ): Promise<OutputQuality> {
    return {
      score: this.calculateCompositeScore({
        syntax: await this.validator.checkSyntax(output),
        completeness: this.checkCompleteness(output, input),
        style: this.checkStyleCompliance(output),
        rendering: await this.checkRendering(output)
      }),
      timestamp: Date.now()
    };
  }
}
```

#### 质量回归检测

```typescript
// __tests__/quality-regression.test.ts

describe('AI Output Quality Regression Tests', () => {
  const baseline = loadBaselineQuality(); // v1.0 的质量基线

  it('输出质量不应低于基线 5%', async () => {
    const testSet = loadTestDataset();
    const results = await generateDiagrams(testSet);

    const currentQuality = calculateAverageQuality(results);
    const regression = (baseline.quality - currentQuality) / baseline.quality;

    expect(regression).toBeLessThan(0.05);
  });

  it('语法错误率不应增加', async () => {
    const results = await generateDiagrams(testSet);
    const errorRate = results.filter(r => !r.syntaxValid).length / results.length;

    expect(errorRate).toBeLessThanOrEqual(baseline.errorRate);
  });
});
```

---

### 5.3 成本效益验证

#### 成本追踪系统

```typescript
// core/ai/cost-tracker.ts

interface CostMetrics {
  totalCalls: number;
  totalTokens: number;
  totalCost: number;           // USD
  avgCostPerCall: number;
  costByModel: Record<string, number>;
  costByComplexity: Record<string, number>;
}

class AICostTracker {
  private metrics: CostMetrics = this.initializeMetrics();

  trackCall(
    model: string,
    complexity: TaskComplexity,
    tokens: { input: number; output: number }
  ): void {
    const cost = this.calculateCost(model, tokens);

    this.metrics.totalCalls++;
    this.metrics.totalTokens += tokens.input + tokens.output;
    this.metrics.totalCost += cost;
    this.metrics.avgCostPerCall = this.metrics.totalCost / this.metrics.totalCalls;

    this.metrics.costByModel[model] = (this.metrics.costByModel[model] || 0) + cost;
    this.metrics.costByComplexity[complexity] =
      (this.metrics.costByComplexity[complexity] || 0) + cost;

    // 导出到 Prometheus
    aiCostMetric.inc({ model, complexity }, cost);
  }

  getDailyCost(): number {
    // 从 Prometheus 查询过去 24 小时的成本
    return this.queryMetrics('sum(increase(ai_cost_total[24h]))');
  }

  async generateCostReport(period: 'daily' | 'weekly' | 'monthly'): Promise<CostReport> {
    return {
      period,
      totalCost: this.metrics.totalCost,
      costBreakdown: this.metrics.costByModel,
      topExpensiveOperations: await this.getTopExpensive(10),
      savings: this.calculateSavings(),
      projectedMonthlyCost: this.projectMonthlyCost()
    };
  }

  private calculateSavings(): number {
    // 对比优化前后的成本
    const baseline = 500; // USD/月 (优化前)
    return baseline - this.projectedMonthlyCost();
  }
}
```

#### 成本优化验证

```typescript
// __tests__/cost-optimization.test.ts

describe('Cost Optimization Validation', () => {
  it('智能路由应降低成本至少 20%', async () => {
    // 场景 A: 全部使用 Sonnet
    const costWithoutRouting = await simulateCost({
      model: 'claude-3-5-sonnet',
      taskCount: 1000
    });

    // 场景 B: 智能路由
    const costWithRouting = await simulateCost({
      useModelRouter: true,
      taskCount: 1000
    });

    const savings = (costWithoutRouting - costWithRouting) / costWithoutRouting;
    expect(savings).toBeGreaterThan(0.2); // > 20% 节省
  });

  it('缓存应减少 60% 重复调用', async () => {
    const tracker = new CacheHitTracker();

    // 模拟稳定项目（很多重复 Arch-JSON）
    await runSimulation({
      project: 'stable-maintenance',
      duration: '1 month'
    });

    expect(tracker.hitRate).toBeGreaterThan(0.6);
  });
});
```

---

## 6. RLM INTEGRATION 策略

### 6.1 提示词版本管理集成

#### Git 工作流

```bash
# prompts/ 仓库结构
prompts/
├─ templates/
│  ├─ class-diagram-v1.0.yaml
│  ├─ class-diagram-v2.0.yaml
│  ├─ component-diagram-v1.0.yaml
│  └─ sequence-diagram-v1.0.yaml
├─ examples/
│  └─ few-shot-examples.json
├─ tests/
│  └─ validation-dataset.json
└─ README.md
```

**发布流程**:
1. **开发新版本提示词**
   ```bash
   git checkout -b feature/prompt-v2.1
   # 编辑 templates/class-diagram-v2.1.yaml
   ```

2. **A/B 测试验证**
   ```bash
   npm run prompt:test -- --compare v2.0 v2.1
   ```

3. **创建 PR**
   - 包含 A/B 测试报告
   - 性能对比数据
   - 示例输出

4. **审查通过后合并**
   ```bash
   git checkout main
   git merge feature/prompt-v2.1
   git tag prompt-v2.1
   ```

5. **部署到生产**
   ```bash
   npm run deploy:prompts
   ```

---

### 6.2 特性开关与灰度发布

#### AI 功能开关

```typescript
// core/ai/feature-flags.ts

interface AIFeatureFlags {
  useModelRouter: boolean;
  enableSemanticCache: boolean;
  useBatchProcessing: boolean;
  enableIncrementalUpdate: boolean;
  defaultPromptVersion: string;
}

const aiFlags: AIFeatureFlags = {
  useModelRouter: env.AI_MODEL_ROUTER === 'true',
  enableSemanticCache: env.AI_SEMANTIC_CACHE === 'true',
  useBatchProcessing: env.AI_BATCH === 'true',
  enableIncrementalUpdate: env.AI_INCREMENTAL === 'true',
  defaultPromptVersion: env.AI_PROMPT_VERSION || 'v2.0'
};

// 使用示例
async function generateDiagram(archJson: ArchJSON): Promise<string> {
  const connector = new AIConnector();

  if (aiFlags.useModelRouter) {
    const model = modelRouter.selectModel(archJson);
    connector.setModel(model);
  }

  if (aiFlags.enableIncrementalUpdate && hasPreviousDiagram()) {
    return await connector.incrementalUpdate(archJson, previousDiagram);
  }

  const prompt = await loadPrompt(aiFlags.defaultPromptVersion);
  return await connector.generate(prompt, archJson);
}
```

#### 灰度发布策略

```typescript
// 逐步推出新提示词版本

const rolloutConfig = {
  'prompt-v2.1': {
    rolloutPercentage: 10,  // 从 10% 用户开始
    monitoringPeriod: 7,    // 监控 7 天
    rollbackThreshold: 0.8  // 质量低于 0.8 自动回滚
  }
};

function selectPromptVersion(userId: string): string {
  for (const [version, config] of Object.entries(rolloutConfig)) {
    if (shouldEnableForUser(userId, config.rolloutPercentage)) {
      // 检查质量指标
      const quality = getRecentQuality(version);
      if (quality < config.rollbackThreshold) {
        logger.warn(`Auto-rollback ${version} due to low quality`);
        return 'v2.0'; // 回退到稳定版本
      }
      return version;
    }
  }

  return 'v2.0'; // 默认稳定版本
}
```

---

### 6.3 AI 服务集成测试

#### 端到端集成测试

```typescript
// __tests__/integration/ai-pipeline.test.ts

describe('AI Pipeline Integration', () => {
  it('完整流程：解析 -> AI 生成 -> 渲染', async () => {
    // 1. 解析代码
    const archJson = await parser.parse('__fixtures__/SampleProject.ts');

    // 2. AI 生成图表
    const diagram = await aiConnector.generate(archJson);

    // 3. 验证输出
    expect(validatePlantUML(diagram)).toBe(true);

    // 4. 渲染检查
    const svg = await renderer.renderToSVG(diagram);
    expect(svg).toContain('<svg');
  });

  it('应正确处理 AI 调用失败', async () => {
    // 模拟 API 失败
    mockAIService.fail();

    const result = await aiConnector.generateWithFallback(archJson);

    // 应使用缓存的上次结果
    expect(result).toBe(lastSuccessfulResult);
    expect(result).toContain('// Warning: AI service unavailable');
  });

  it('批处理应正确合并结果', async () => {
    const files = Array.from({ length: 50 }, (_, i) => `file${i}.ts`);
    const archJsons = await Promise.all(files.map(f => parser.parse(f)));

    const diagram = await aiBatchProcessor.processBatch(archJsons);

    // 验证所有文件都被包含
    archJsons.forEach(aj => {
      aj.entities.forEach(e => {
        expect(diagram).toContain(e.name);
      });
    });
  });
});
```

---

### 6.4 回滚与降级策略

#### 自动回滚触发器

```typescript
// core/ai/auto-rollback.ts

class AutoRollbackManager {
  private monitors = [
    {
      name: 'quality-drop',
      check: () => this.checkQualityDrop(),
      threshold: 0.15, // 质量下降 > 15%
      action: () => this.rollbackPromptVersion()
    },
    {
      name: 'error-spike',
      check: () => this.checkErrorRate(),
      threshold: 0.1, // 错误率 > 10%
      action: () => this.disableFeature('ai-generation')
    },
    {
      name: 'cost-surge',
      check: () => this.checkCostIncrease(),
      threshold: 2.0, // 成本增加 > 100%
      action: () => this.enableCostSavingMode()
    }
  ];

  async monitorAndRollback(): Promise<void> {
    for (const monitor of this.monitors) {
      const violation = await monitor.check();
      if (violation > monitor.threshold) {
        logger.error(`Auto-rollback triggered: ${monitor.name}`);
        await monitor.action();
        await this.notifyTeam({
          trigger: monitor.name,
          severity: 'critical',
          action: 'Auto-rollback executed'
        });
      }
    }
  }
}

// 每 5 分钟检查一次
setInterval(() => autoRollback.monitorAndRollback(), 5 * 60 * 1000);
```

---

## 7. RLM MONITORING 策略

### 7.1 AI 性能监控

#### 关键指标

```typescript
// core/ai/metrics.ts

const aiMetrics = {
  // 延迟指标
  generationLatency: new Histogram({
    name: 'ai_generation_duration_seconds',
    help: 'AI diagram generation latency',
    labelNames: ['model', 'complexity'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60]
  }),

  // 质量指标
  outputQuality: new Gauge({
    name: 'ai_output_quality_score',
    help: 'AI output quality score (0-1)',
    labelNames: ['model', 'prompt_version']
  }),

  // 成本指标
  costPerCall: new Histogram({
    name: 'ai_cost_per_call_usd',
    help: 'Cost per AI call in USD',
    labelNames: ['model'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5]
  }),

  // 成功率
  callSuccessRate: new Counter({
    name: 'ai_calls_total',
    help: 'Total AI calls',
    labelNames: ['model', 'status'] // success/error
  }),

  // Token 使用
  tokenUsage: new Counter({
    name: 'ai_tokens_total',
    help: 'Total tokens consumed',
    labelNames: ['model', 'type'] // input/output
  })
};

// 记录调用
function recordAICall(
  model: string,
  duration: number,
  tokens: { input: number; output: number },
  cost: number,
  success: boolean
) {
  aiMetrics.generationLatency.observe({ model, complexity }, duration);
  aiMetrics.costPerCall.observe({ model }, cost);
  aiMetrics.callSuccessRate.inc({ model, status: success ? 'success' : 'error' });
  aiMetrics.tokenUsage.inc({ model, type: 'input' }, tokens.input);
  aiMetrics.tokenUsage.inc({ model, type: 'output' }, tokens.output);
}
```

#### Grafana 仪表盘

```yaml
# grafana/ai-monitoring-dashboard.json

{
  "dashboard": {
    "title": "AI Integration Monitoring",
    "panels": [
      {
        "title": "AI Call Latency (P95)",
        "targets": [{
          "expr": "histogram_quantile(0.95, ai_generation_duration_seconds)"
        }],
        "alert": {
          "conditions": "P95 > 10s for 5m",
          "message": "AI calls are slow"
        }
      },
      {
        "title": "Daily AI Cost",
        "targets": [{
          "expr": "sum(increase(ai_cost_per_call_usd[24h]))"
        }]
      },
      {
        "title": "Output Quality Trend",
        "targets": [{
          "expr": "avg(ai_output_quality_score) by (prompt_version)"
        }]
      },
      {
        "title": "Model Usage Distribution",
        "targets": [{
          "expr": "sum by (model) (rate(ai_calls_total[1h]))"
        }],
        "type": "pie"
      }
    ]
  }
}
```

---

### 7.2 提示词性能追踪

#### 版本对比分析

```typescript
// tools/prompt-performance-tracker.ts

interface PromptVersionMetrics {
  version: string;
  avgQuality: number;
  avgLatency: number;
  avgCost: number;
  errorRate: number;
  sampleSize: number;
}

class PromptPerformanceTracker {
  async compareVersions(
    versions: string[],
    period: string = '7d'
  ): Promise<VersionComparison> {
    const metrics = await Promise.all(
      versions.map(v => this.getMetricsForVersion(v, period))
    );

    return {
      versions: metrics,
      recommendation: this.determineRecommendation(metrics),
      chart: this.generateComparisonChart(metrics)
    };
  }

  private determineRecommendation(
    metrics: PromptVersionMetrics[]
  ): string {
    // 综合评分：质量 (50%) + 速度 (30%) + 成本 (20%)
    const scores = metrics.map(m => ({
      version: m.version,
      score:
        m.avgQuality * 0.5 +
        (1 - m.avgLatency / 10) * 0.3 +
        (1 - m.avgCost / 0.1) * 0.2
    }));

    const best = scores.reduce((a, b) => (a.score > b.score ? a : b));
    return `推荐使用 ${best.version} (综合评分: ${best.score.toFixed(2)})`;
  }
}
```

---

### 7.3 告警与异常检测

#### AI 服务健康检查

```yaml
# prometheus/ai-alerts.yml

groups:
  - name: ai-health
    rules:
      - alert: HighAIErrorRate
        expr: |
          sum(rate(ai_calls_total{status="error"}[5m])) /
          sum(rate(ai_calls_total[5m])) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "AI error rate above 10%"
          description: "{{ $value | humanizePercentage }} of AI calls failing"

      - alert: AIQualityDrop
        expr: avg(ai_output_quality_score) < 0.8
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "AI output quality below threshold"

      - alert: AICostSpike
        expr: |
          sum(increase(ai_cost_per_call_usd[1h])) >
          sum(increase(ai_cost_per_call_usd[1h] offset 24h)) * 1.5
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "AI costs increased by 50%"
```

---

### 7.4 用户体验监控

#### AI 生成体验追踪

```typescript
// 关键用户旅程：AI 生成图表
tracer.startTrace('user-ai-generation');

const milestones = [
  { name: 'prompt-loading', target: 50 },      // ms
  { name: 'ai-request', target: 2000 },
  { name: 'validation', target: 100 },
  { name: 'rendering', target: 300 }
];

for (const milestone of milestones) {
  const duration = await tracer.measureStep(milestone.name);

  if (duration > milestone.target * 1.5) {
    // 超过目标 50%
    userExperienceMetric.inc({
      step: milestone.name,
      status: 'slow'
    });
  }
}

tracer.endTrace();

// 收集用户反馈
interface AIGenerationFeedback {
  quality: 1 | 2 | 3 | 4 | 5;
  speed: 'fast' | 'acceptable' | 'slow';
  accuracy: 'accurate' | 'mostly-accurate' | 'inaccurate';
  comment?: string;
}
```

---

## 8. 成功指标

| 指标 | 基线 | 目标 | 测量方法 |
|------|------|------|---------|
| 输出语法正确率 | 70% | 95% | 自动验证通过率 |
| 平均响应时间 | 5s | 2s | P95 延迟 |
| 月度 AI 成本 | $500 | $200 | 账单分析 |
| 图表一致性评分 | - | >0.9 | 人工评审 |

---

## 9. 参考资源

- **Anthropic Prompt Engineering Guide**: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
- **PlantUML Reference**: https://plantuml.com/class-diagram
- **Few-Shot Learning**: "Language Models are Few-Shot Learners" (Brown et al., 2020)

---

**下一步行动**:
1. 创建 `prompts/` 仓库并设计 YAML schema
2. 实现基础的 PromptTemplate 加载器
3. 收集 10-20 个高质量示例作为 Few-Shot 语料库
