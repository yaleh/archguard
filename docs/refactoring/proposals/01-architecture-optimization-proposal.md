# ArchGuard 架构优化建议 (RLM 分析)

**文档版本**: 1.0
**创建日期**: 2026-01-25
**分析方法**: RLM (Refactoring Lifecycle Management)
**分析范围**: 基于现有架构设计文档和需求规格说明书

---

## 执行摘要

本文档基于 RLM 方法对 ArchGuard 项目进行系统架构分析，识别当前设计的优势与潜在改进点，并提出可执行的优化建议。分析涵盖架构模式、技术选型、扩展性、性能和可靠性等多个维度。

---

## 1. 现有架构分析

### 1.1 架构优势

✅ **清晰的三层架构**
- 触发层、引擎层、智脑层职责明确，符合关注点分离原则
- 便于独立测试和模块替换

✅ **合理的技术选型**
- ts-morph 提供强大的 TypeScript AST 分析能力
- AI SDK 支持多模型切换，降低供应商锁定风险

✅ **以变更驱动为核心**
- Hook 机制确保架构文档与代码同步
- 增量分析降低计算开销

### 1.2 潜在改进空间

⚠️ **架构耦合度**
- 当前设计中 AI Connector 与具体 AI 提供商耦合
- Snippet Extractor 与 TS-Scanner 紧耦合，限制多语言扩展

⚠️ **可观测性不足**
- 缺乏对解析性能、AI 调用成功率的监控
- 无法追踪架构文档质量的演化趋势

⚠️ **错误恢复策略**
- AI 调用失败时的回退机制未明确
- 解析错误可能导致整个流程中断

---

## 2. RLM 优化建议

### 2.1 架构模式优化

#### 建议 1: 引入插件化架构 (Plugin Architecture)

**问题**: 当前设计难以扩展到多语言（Java, Go, Python）

**解决方案**: 将 Scanner 抽象为插件接口

```typescript
// 核心接口定义
interface LanguagePlugin {
  name: string;
  extensions: string[];
  parse(filePath: string): Promise<ArchJSON>;
  validate(archJSON: ArchJSON): boolean;
}

// 插件注册中心
class PluginRegistry {
  private plugins: Map<string, LanguagePlugin>;

  register(plugin: LanguagePlugin): void;
  getPlugin(fileExtension: string): LanguagePlugin | null;
}
```

**收益**:
- 零修改添加新语言支持
- 社区贡献者可独立开发语言插件
- 符合开闭原则 (Open-Closed Principle)

**优先级**: 🔴 高 (P0) - 影响未来扩展性

---

#### 建议 2: 实施事件驱动架构 (Event-Driven Architecture)

**问题**: 当前流程是同步串行的，难以处理并发场景

**解决方案**: 引入事件总线解耦组件

```typescript
// 事件定义
enum ArchGuardEvent {
  FILES_CHANGED = 'files.changed',
  PARSING_COMPLETED = 'parsing.completed',
  AI_ANALYSIS_DONE = 'ai.analysis.done',
  DIAGRAM_UPDATED = 'diagram.updated',
}

// 事件总线
class EventBus {
  on(event: ArchGuardEvent, handler: (data: any) => Promise<void>): void;
  emit(event: ArchGuardEvent, data: any): Promise<void>;
}
```

**工作流示例**:
```
Hook Listener → [FILES_CHANGED]
  → Scanner → [PARSING_COMPLETED]
  → AI Connector → [AI_ANALYSIS_DONE]
  → Puml Renderer → [DIAGRAM_UPDATED]
```

**收益**:
- 组件间松耦合，易于单元测试
- 支持异步并发处理多个文件
- 可插入中间件（日志、性能监控）

**优先级**: 🟡 中 (P1) - 提升架构灵活性

---

### 2.2 技术实现优化

#### 建议 3: 实施分层缓存策略

**问题**: 每次触发都重新解析所有文件，性能开销大

**解决方案**: 三级缓存体系

```typescript
interface CacheStrategy {
  // L1: 内存缓存 (AST 对象)
  memoryCache: LRUCache<string, ASTNode>;

  // L2: 文件缓存 (Arch-JSON)
  fileCache: FileSystemCache<string, ArchJSON>;

  // L3: Git-aware 缓存 (基于文件哈希)
  gitCache: GitHashCache<string, ArchJSON>;
}

class SmartParser {
  async parse(filePath: string): Promise<ArchJSON> {
    const fileHash = await getGitHash(filePath);

    // 检查 L3: Git 哈希未变则直接返回
    if (this.gitCache.has(fileHash)) {
      return this.gitCache.get(fileHash);
    }

    // 执行解析
    const result = await this.doActualParsing(filePath);

    // 更新所有缓存层
    this.updateCaches(fileHash, result);
    return result;
  }
}
```

**收益**:
- 大型项目（>500 文件）性能提升 10-50x
- 降低 CPU 和内存使用
- 支持离线工作（使用 L2 缓存）

**优先级**: 🔴 高 (P0) - 直接影响非功能需求 (<2s 解析时间)

---

#### 建议 4: AI 调用优化 - 批处理与流式响应

**问题**: 单文件单次 AI 调用效率低，成本高

**解决方案**: 智能批处理策略

```typescript
class AIBatchProcessor {
  private batchSize = 10; // 每批处理 10 个文件
  private maxTokens = 100000; // Claude 上下文限制

  async processBatch(files: ArchJSON[]): Promise<PlantUMLDiagram> {
    // 智能分组：按模块聚合
    const batches = this.groupByModule(files, this.batchSize);

    // 并行处理多个批次
    const diagrams = await Promise.all(
      batches.map(batch => this.callAI(batch))
    );

    // 合并结果
    return this.mergeDiagrams(diagrams);
  }

  // 支持流式响应（降低 Time to First Token）
  async streamGenerate(input: ArchJSON): AsyncIterator<string> {
    const stream = await this.aiClient.streamCompletion({
      prompt: this.buildPrompt(input),
      stream: true,
    });

    for await (const chunk of stream) {
      yield chunk.text;
    }
  }
}
```

**收益**:
- AI 成本降低 40-60%（减少调用次数）
- 用户更快看到部分结果（流式响应）
- 更好利用 AI 上下文窗口

**优先级**: 🟡 中 (P1) - 降低运营成本

---

### 2.3 可靠性与可观测性优化

#### 建议 5: 实施熔断器模式 (Circuit Breaker)

**问题**: AI 服务故障可能导致整个流程阻塞

**解决方案**: 引入熔断器保护关键服务

```typescript
import { CircuitBreaker } from 'opossum';

class ResilientAIConnector {
  private breaker: CircuitBreaker;

  constructor(private aiClient: AIClient) {
    this.breaker = new CircuitBreaker(this.callAI.bind(this), {
      timeout: 30000,        // 30s 超时
      errorThresholdPercentage: 50,  // 错误率 >50% 触发熔断
      resetTimeout: 60000,   // 60s 后尝试恢复
    });

    // 熔断时的降级策略
    this.breaker.fallback(() => this.useLocalFallback());
  }

  private async useLocalFallback(): Promise<string> {
    // 使用上次成功的结果 + 占位符
    return this.loadLastSuccessfulDiagram() + '\n' +
           '/' + '/ Warning: AI service unavailable, using cached version';
  }
}
```

**收益**:
- 防止级联失败
- 服务降级而非完全不可用
- 快速失败，避免用户长时间等待

**优先级**: 🔴 高 (P0) - 确保生产可用性

---

#### 建议 6: 可观测性三支柱 (Logs, Metrics, Traces)

**问题**: 无法诊断性能瓶颈和故障根因

**解决方案**: 集成可观测性框架

```typescript
// 1. 结构化日志
import { Logger } from 'pino';

const logger = Logger({
  level: 'info',
  transport: {
    target: 'pino-pretty'
  }
});

logger.info({
  event: 'parsing.started',
  fileCount: 42,
  duration: 0
});

// 2. 指标收集
import { Counter, Histogram, Registry } from 'prom-client';

const parseCounter = new Counter({
  name: 'archguard_files_parsed_total',
  help: 'Total number of files parsed',
});

const aiLatency = new Histogram({
  name: 'archguard_ai_call_duration_seconds',
  help: 'AI call latency in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// 3. 分布式追踪
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('archguard');

async function processFile(file: string) {
  const span = tracer.startSpan('processFile', {
    attributes: { 'file.path': file }
  });

  try {
    // ... 业务逻辑
  } finally {
    span.end();
  }
}
```

**收益**:
- 实时监控系统健康状态
- 快速定位性能瓶颈
- 支持 SLO (Service Level Objectives) 制定

**优先级**: 🟡 中 (P1) - 提升运维能力

---

### 2.4 数据建模优化

#### 建议 7: 扩展 Arch-JSON 支持时序信息

**问题**: 当前 Arch-JSON 只表达静态结构，无法体现运行时行为

**解决方案**: 增加序列图生成能力

```typescript
interface ArchJSON {
  version: string;
  entities: Entity[];
  relations: Relation[];

  // 新增: 时序信息
  sequences?: Sequence[];
}

interface Sequence {
  name: string;           // e.g., "User Login Flow"
  participants: string[]; // e.g., ["User", "AuthController", "AuthService"]
  steps: SequenceStep[];
}

interface SequenceStep {
  from: string;
  to: string;
  message: string;       // e.g., "login(email, password)"
  type: 'sync' | 'async' | 'return';
  condition?: string;    // e.g., "if valid credentials"
}
```

**提取策略**:
- 静态分析方法调用链（基于 AST）
- 识别关键业务流程（通过装饰器如 `@BusinessFlow`）
- AI 辅助推断交互顺序

**收益**:
- 生成更丰富的文档（类图 + 序列图）
- 帮助新人理解业务流程
- 支持架构审查（发现异常调用路径）

**优先级**: 🟢 低 (P2) - 功能增强

---

## 3. 实施路线图

### 阶段 1: 基础增强 (1-2 周)
- [ ] 实施分层缓存策略 (建议 3)
- [ ] 添加熔断器模式 (建议 5)
- [ ] 集成基础日志和指标 (建议 6)

### 阶段 2: 架构重构 (2-3 周)
- [ ] 设计并实现插件化架构 (建议 1)
- [ ] 迁移到事件驱动架构 (建议 2)
- [ ] 开发第一个语言插件（TypeScript）

### 阶段 3: 高级特性 (3-4 周)
- [ ] 实现 AI 批处理和流式响应 (建议 4)
- [ ] 扩展 Arch-JSON 支持时序信息 (建议 7)
- [ ] 添加分布式追踪

### 阶段 4: 生态建设 (持续)
- [ ] 编写插件开发文档
- [ ] 发布 Java/Python 语言插件
- [ ] 建立性能基准测试套件

---

## 4. RLM VALIDATION 策略

### 4.1 架构验证方法

#### 静态验证

**架构符合性检查**:
```typescript
// tools/arch-validator.ts

interface ArchitectureRule {
  name: string;
  description: string;
  check: (codebase: ArchJSON) => ValidationResult;
}

const architectureRules: ArchitectureRule[] = [
  {
    name: 'plugin-interface-compliance',
    description: '所有语言插件必须实现 ILanguagePlugin 接口',
    check: (codebase) => {
      const plugins = findPlugins(codebase);
      const violations = plugins.filter(
        p => !implementsInterface(p, 'ILanguagePlugin')
      );
      return {
        passed: violations.length === 0,
        violations: violations.map(v => `${v.name} 未实现 ILanguagePlugin`)
      };
    }
  },
  {
    name: 'no-circular-dependencies',
    description: '模块间不允许循环依赖',
    check: (codebase) => {
      const cycles = detectCycles(codebase.relations);
      return {
        passed: cycles.length === 0,
        violations: cycles.map(c => `循环依赖: ${c.join(' -> ')}`)
      };
    }
  },
  {
    name: 'layering-compliance',
    description: '遵守分层架构：Core -> Plugins -> AI',
    check: (codebase) => {
      const violations = checkLayeringViolations(codebase);
      return {
        passed: violations.length === 0,
        violations
      };
    }
  }
];

// 运行验证
async function validateArchitecture(): Promise<void> {
  const codebase = await parseEntireCodebase();
  const results = architectureRules.map(rule => ({
    rule: rule.name,
    ...rule.check(codebase)
  }));

  const failed = results.filter(r => !r.passed);
  if (failed.length > 0) {
    console.error('架构验证失败:');
    failed.forEach(f => {
      console.error(`- ${f.rule}:`);
      f.violations.forEach(v => console.error(`  * ${v}`));
    });
    process.exit(1);
  }

  console.log('✅ 架构验证通过');
}
```

**集成到 CI/CD**:
```yaml
# .github/workflows/arch-validation.yml
name: Architecture Validation

on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run architecture validation
        run: npm run validate:architecture
```

---

#### 动态验证

**性能回归测试**:
```typescript
// __tests__/performance-regression.test.ts

describe('Performance Regression Tests', () => {
  const baseline = loadBaselineMetrics(); // 从上次发布加载

  it('解析性能不应回退超过 10%', async () => {
    const current = await benchmarkParsing(testFiles);
    const regression = (current.p95 - baseline.parsing.p95) / baseline.parsing.p95;

    expect(regression).toBeLessThan(0.1); // 允许 10% 波动
  });

  it('内存使用不应增长超过 20%', async () => {
    const current = await benchmarkMemory(largeProject);
    const growth = (current.peak - baseline.memory.peak) / baseline.memory.peak;

    expect(growth).toBeLessThan(0.2);
  });
});
```

**集成测试套件**:
```typescript
// __tests__/integration/plugin-system.test.ts

describe('Plugin System Integration', () => {
  let registry: PluginRegistry;

  beforeAll(async () => {
    registry = new PluginRegistry();
    await registry.discoverPlugins('./plugins');
  });

  it('应成功加载所有语言插件', () => {
    const plugins = registry.getAllPlugins();
    expect(plugins.length).toBeGreaterThanOrEqual(2); // TS + Java
  });

  it('插件输出应符合 Arch-JSON schema', async () => {
    const tsPlugin = registry.getPluginForFile('test.ts');
    const result = await tsPlugin.parse('__fixtures__/Sample.ts');

    // 验证 schema
    expect(validateArchJSON(result)).toBe(true);
  });

  it('跨语言一致性：相同逻辑应产生相似结构', async () => {
    const tsResult = await parseFile('__fixtures__/UserService.ts');
    const javaResult = await parseFile('__fixtures__/UserService.java');

    // 比较实体数量和关系
    expect(tsResult.entities.length).toBe(javaResult.entities.length);
    expect(tsResult.relations.length).toBe(javaResult.relations.length);
  });
});
```

---

### 4.2 质量门控 (Quality Gates)

#### 代码合并前检查

| 检查项 | 阈值 | 阻塞级别 |
|--------|------|---------|
| 单元测试覆盖率 | ≥ 80% | 🔴 阻塞 |
| 集成测试通过率 | 100% | 🔴 阻塞 |
| 架构验证 | 0 违规 | 🔴 阻塞 |
| 性能回归 | < 10% | 🟡 警告 |
| 代码重复率 | < 3% | 🟡 警告 |
| 代码异味 | < 5 个 | 🟢 建议 |

**自动化质量门控**:
```typescript
// tools/quality-gate.ts

interface QualityGate {
  name: string;
  check: () => Promise<GateResult>;
  blocking: boolean;
}

const gates: QualityGate[] = [
  {
    name: 'test-coverage',
    blocking: true,
    check: async () => {
      const coverage = await getCoverage();
      return {
        passed: coverage >= 80,
        message: `Coverage: ${coverage}% (required: ≥80%)`
      };
    }
  },
  {
    name: 'performance-regression',
    blocking: false, // 仅警告
    check: async () => {
      const regression = await checkPerformance();
      return {
        passed: regression < 0.1,
        message: `Performance regression: ${(regression * 100).toFixed(1)}%`
      };
    }
  }
];

async function runQualityGates(): Promise<void> {
  const results = await Promise.all(gates.map(g => g.check()));
  const blockingFailures = results.filter((r, i) => !r.passed && gates[i].blocking);

  if (blockingFailures.length > 0) {
    console.error('❌ Quality gates failed:');
    blockingFailures.forEach(f => console.error(`  - ${f.message}`));
    process.exit(1);
  }

  console.log('✅ All quality gates passed');
}
```

---

### 4.3 A/B 测试框架

**架构方案对比**:
```typescript
// __tests__/ab-testing/plugin-vs-monolith.test.ts

describe('A/B Test: Plugin Architecture vs Monolithic', () => {
  it('对比可扩展性', async () => {
    // A: 插件化架构 - 添加新语言
    const pluginTime = await measureTime(async () => {
      const plugin = new PythonPlugin();
      await registry.register(plugin);
    });

    // B: 单体架构 - 添加新语言（模拟）
    const monolithTime = pluginTime * 5; // 预估需要修改多处

    expect(pluginTime).toBeLessThan(monolithTime);
  });

  it('对比性能开销', async () => {
    // 插件化可能有额外开销
    const pluginPerf = await benchmarkPluginSystem();
    const monolithPerf = await benchmarkMonolith();

    // 允许 10% 性能开销，换取可扩展性
    expect(pluginPerf / monolithPerf).toBeLessThan(1.1);
  });
});
```

---

## 5. RLM INTEGRATION 策略

### 5.1 渐进式集成计划

#### Phase 1: 核心基础设施（Week 1-2）

**集成范围**:
- ✅ 插件注册中心
- ✅ Arch-JSON Schema
- ✅ TypeScript 插件

**集成流程**:
1. **Feature Branch**: `feature/plugin-architecture`
2. **开发**: 实现核心接口
3. **自测**: 单元测试 + 集成测试
4. **Code Review**: 至少 2 人审查
5. **Staging 验证**: 部署到测试环境
6. **Merge**: Squash merge 到 main
7. **标签**: 打 tag `v0.1.0-alpha.1`

**验收标准**:
- [ ] 所有 P0 测试通过
- [ ] 架构验证无违规
- [ ] 文档已更新
- [ ] Demo 可运行

---

#### Phase 2: 扩展功能（Week 3-4）

**集成范围**:
- ✅ AI 集成模块
- ✅ 缓存系统
- ✅ 事件总线

**并行开发策略**:
```
main
  ├─ feature/ai-integration      (工程师 A)
  ├─ feature/caching-system      (工程师 B)
  └─ feature/event-bus           (工程师 C)
```

**集成冲突预防**:
- 每日 sync from main
- 接口先行：先定义接口，再并行实现
- 集成测试先行：先写集成测试，确保接口兼容

---

### 5.2 特性开关 (Feature Flags)

**渐进式启用新架构**:
```typescript
// core/config.ts

interface FeatureFlags {
  usePluginArchitecture: boolean;
  useEventBus: boolean;
  enableSemanticCache: boolean;
  enableAIBatching: boolean;
}

const flags: FeatureFlags = {
  usePluginArchitecture: process.env.FEATURE_PLUGIN === 'true',
  useEventBus: process.env.FEATURE_EVENT_BUS === 'true',
  enableSemanticCache: process.env.FEATURE_SEMANTIC_CACHE === 'true',
  enableAIBatching: process.env.FEATURE_AI_BATCHING === 'true'
};

// 使用示例
async function parseProject(): Promise<ArchJSON[]> {
  if (flags.usePluginArchitecture) {
    return await pluginBasedParser.parse(files);
  } else {
    return await legacyParser.parse(files); // 回退方案
  }
}
```

**灰度发布**:
```typescript
// 根据用户百分比启用
function shouldEnableForUser(userId: string, rolloutPercentage: number): boolean {
  const hash = hashUserId(userId);
  return hash % 100 < rolloutPercentage;
}

if (shouldEnableForUser(currentUser.id, 10)) {
  // 10% 用户使用新架构
  flags.usePluginArchitecture = true;
}
```

---

### 5.3 数据迁移策略

**Arch-JSON 版本兼容**:
```typescript
// core/migration/arch-json-migrator.ts

class ArchJSONMigrator {
  migrate(data: any, fromVersion: string, toVersion: string): ArchJSON {
    const migrations = this.getMigrationPath(fromVersion, toVersion);

    return migrations.reduce((current, migration) => {
      return migration.transform(current);
    }, data);
  }

  private getMigrationPath(from: string, to: string): Migration[] {
    // 1.0 -> 1.1: 添加 sequences 字段
    if (from === '1.0' && to === '1.1') {
      return [
        {
          transform: (data) => ({
            ...data,
            sequences: [] // 添加空的序列图数据
          })
        }
      ];
    }
    return [];
  }
}

// 向后兼容读取
async function loadArchJSON(filePath: string): Promise<ArchJSON> {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));

  if (raw.version !== CURRENT_VERSION) {
    return migrator.migrate(raw, raw.version, CURRENT_VERSION);
  }

  return raw;
}
```

---

### 5.4 回滚与应急响应

**快速回滚检查清单**:
- [ ] 关闭特性开关（如适用）
- [ ] 回退到上一稳定版本
- [ ] 验证核心功能
- [ ] 通知受影响用户
- [ ] 记录回滚原因

**回滚决策树**:
```
问题严重度？
├─ P0 (服务不可用)
│  └─ 立即回滚 + 紧急修复
├─ P1 (核心功能受损)
│  └─ 评估修复时间 < 2h ? 修复 : 回滚
└─ P2/P3 (非关键问题)
   └─ 记录 Bug + 计划修复
```

---

## 6. RLM MONITORING 策略

### 6.1 架构健康度监控

#### 依赖健康度

```typescript
// tools/dependency-health.ts

interface DependencyHealth {
  name: string;
  version: string;
  latestVersion: string;
  daysOutdated: number;
  vulnerabilities: number;
  health: 'healthy' | 'warning' | 'critical';
}

async function checkDependencyHealth(): Promise<DependencyHealth[]> {
  const deps = await getDependencies();

  return Promise.all(deps.map(async (dep) => {
    const latest = await getLatestVersion(dep.name);
    const vulns = await checkVulnerabilities(dep.name, dep.version);

    const daysOutdated = daysSince(dep.publishedAt, latest.publishedAt);

    return {
      name: dep.name,
      version: dep.version,
      latestVersion: latest.version,
      daysOutdated,
      vulnerabilities: vulns.length,
      health: calculateHealth(daysOutdated, vulns.length)
    };
  }));
}

function calculateHealth(daysOutdated: number, vulns: number): string {
  if (vulns > 0) return 'critical';
  if (daysOutdated > 180) return 'warning';
  return 'healthy';
}
```

**每周依赖健康报告**:
```markdown
## Dependency Health Report (Week 42)

### 🔴 Critical
- `axios@0.21.1` - 3 vulnerabilities, upgrade to 1.6.0

### 🟡 Warnings
- `ts-morph@15.0.0` - 240 days outdated, latest: 20.0.0

### ✅ Healthy
- `@anthropic-ai/sdk@0.10.0` - up to date
- `pino@8.16.0` - up to date
```

---

#### 架构度量趋势

**每月追踪**:
```typescript
interface ArchitectureMetrics {
  month: string;
  moduleCount: number;
  cyclicDependencies: number;
  averageComplexity: number;
  pluginCount: number;
  apiStability: number; // 0-1, 1 = 完全稳定
}

// Grafana 可视化
const metrics: ArchitectureMetrics[] = [
  { month: '2026-01', moduleCount: 12, cyclicDependencies: 0, ... },
  { month: '2026-02', moduleCount: 15, cyclicDependencies: 0, ... },
  // ...
];
```

---

### 6.2 性能监控仪表盘

参见 `04-performance-monitoring.md` 第 3 章获取详细指标。

**关键监控项**:
- 🔵 解析吞吐量（files/second）
- 🟢 缓存命中率
- 🟡 AI 调用延迟（P50/P95/P99）
- 🔴 错误率
- 💰 月度 AI 成本

**Grafana 仪表盘**:
- 插件性能对比
- 语言解析器基准
- AI 模型性能对比
- 成本趋势分析

---

### 6.3 用户体验监控

**关键用户旅程**:
```typescript
// 跟踪端到端延迟
tracer.startTrace('user-journey-diagram-generation');

const steps = [
  { name: 'file-discovery', target: 100 },   // ms
  { name: 'parsing', target: 1000 },
  { name: 'ai-generation', target: 2000 },
  { name: 'rendering', target: 500 }
];

for (const step of steps) {
  const duration = await tracer.measureStep(step.name, stepFunction);

  if (duration > step.target * 1.5) {
    alerting.warn(`${step.name} exceeded target by 50%`);
  }
}

tracer.endTrace();
```

**用户满意度追踪**:
```typescript
// 在关键操作后收集反馈
interface UserFeedback {
  operation: 'diagram-generation' | 'plugin-install';
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  timestamp: string;
}

// 目标: 平均评分 > 4.0
```

---

### 6.4 告警规则

**Prometheus 告警配置**:
```yaml
# prometheus/alerts.yml

groups:
  - name: archguard-architecture
    interval: 1m
    rules:
      - alert: HighErrorRate
        expr: rate(archguard_errors_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate above 5%"

      - alert: PerformanceRegression
        expr: |
          (archguard_parse_duration_seconds{quantile="0.95"} -
           archguard_parse_duration_seconds{quantile="0.95"} offset 1d) /
          archguard_parse_duration_seconds{quantile="0.95"} offset 1d > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency increased by 20%"

      - alert: CacheHitRateDrop
        expr: archguard_cache_hit_rate < 0.5
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate below 50%"
```

---

### 6.5 持续架构审查

**季度架构审查会议**:

**参与者**: 技术负责人 + 高级工程师

**议程** (2 小时):
1. **架构度量回顾** (30min)
   - 模块增长趋势
   - 依赖健康度
   - 技术债务状态

2. **设计决策复盘** (30min)
   - 评估上季度架构决策效果
   - 识别需要重新审视的决策

3. **未来规划** (30min)
   - 下一季度架构目标
   - 重大重构计划
   - 技术选型更新

4. **知识分享** (30min)
   - 架构最佳实践
   - 行业趋势讨论

**输出物**:
- 架构健康度报告
- ADR 更新
- 技术债务优先级清单

---

## 7. 成功度量指标

| 指标 | 当前目标 | 优化后目标 |
|------|---------|-----------|
| 500 文件项目解析时间 | < 2s | < 0.5s |
| AI 调用成功率 | - | > 99% |
| 单次运行成本 (AI) | - | < $0.01 |
| 插件开发工作量 | - | < 2 人日/语言 |
| 系统可用性 | - | > 99.9% |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 插件化增加复杂度 | 中 | 提供脚手架工具和详细文档 |
| 缓存一致性问题 | 高 | 使用 Git 哈希作为缓存键 |
| 事件总线性能瓶颈 | 中 | 采用内存队列 + 背压控制 |
| AI 成本超预算 | 高 | 实施智能批处理 + 缓存策略 |

---

## 9. 附录

### 6.1 参考架构模式

- **六边形架构 (Hexagonal Architecture)**: 用于隔离核心业务逻辑
- **CQRS (Command Query Responsibility Segregation)**: 分离读写操作
- **Saga 模式**: 处理分布式事务（多步骤流程）

### 6.2 相关技术栈

- **缓存**: node-cache, lru-cache, ioredis
- **可观测性**: pino, prom-client, @opentelemetry/sdk-node
- **弹性工程**: opossum (熔断器), bottleneck (限流)
- **事件总线**: EventEmitter2, BullMQ

---

## 变更历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0 | 2026-01-25 | 初始版本，基于 RLM 方法分析 | Claude Code |

---

**下一步行动**:
1. 团队评审本建议文档
2. 优先级排序和工作量评估
3. 创建详细的技术设计文档（TDD）
4. 启动 POC (Proof of Concept) 验证关键技术点
