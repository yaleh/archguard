# ArchGuard 性能优化与监控建议

**文档版本**: 1.0
**创建日期**: 2026-01-25
**关联文档**: 01-architecture-optimization-proposal.md
**分析方法**: RLM (Refactoring Lifecycle Management)

---

## 执行摘要

本文档针对 ArchGuard 的性能目标（500 文件 <2s 解析）和生产可靠性需求，提出系统化的性能优化策略和可观测性方案。涵盖解析加速、并发优化、资源管理和全链路监控。

---

## 1. 性能基准与目标

### 1.1 非功能需求回顾

| 场景 | 当前目标 | 优化目标 | 测量指标 |
|------|---------|---------|---------|
| 小型项目 (< 50 文件) | < 500ms | < 200ms | P95 延迟 |
| 中型项目 (50-200 文件) | < 1s | < 500ms | P95 延迟 |
| 大型项目 (200-500 文件) | < 2s | < 1s | P95 延迟 |
| 超大型项目 (> 1000 文件) | - | < 3s | P95 延迟 |

### 1.2 性能瓶颈预测

基于架构设计，预估性能热点：

```
总耗时 = 文件发现时间 + AST解析时间 + JSON转换时间 + AI调用时间

预估分布（500 文件项目）:
- 文件发现: 100ms (5%)
- AST 解析: 1200ms (60%)  ← 主要瓶颈
- JSON 转换: 200ms (10%)
- 依赖分析: 300ms (15%)
- AI 调用: 200ms (10%)
───────────────────────
总计: 2000ms
```

---

## 2. 性能优化策略

### 2.1 解析加速

#### 建议 1: 并行解析 + Worker Threads

**问题**: 单线程顺序解析，无法利用多核 CPU

**解决方案**: Worker Pool 并行处理

```typescript
// core/parser/parallel-parser.ts

import { Worker } from 'worker_threads';
import os from 'os';

class ParallelParser {
  private workerPool: WorkerPool;
  private maxWorkers = os.cpus().length;

  constructor() {
    this.workerPool = new WorkerPool({
      workerScript: './parse-worker.js',
      maxWorkers: this.maxWorkers
    });
  }

  async parseFiles(filePaths: string[]): Promise<ArchJSON[]> {
    // 分批处理，每个 Worker 处理一批文件
    const batchSize = Math.ceil(filePaths.length / this.maxWorkers);
    const batches = this.chunkArray(filePaths, batchSize);

    const results = await Promise.all(
      batches.map(batch => this.workerPool.exec('parseBatch', batch))
    );

    return results.flat();
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// parse-worker.js
const { parentPort } = require('worker_threads');

parentPort.on('message', async ({ method, args }) => {
  if (method === 'parseBatch') {
    const [filePaths] = args;
    const plugin = new TypeScriptPlugin();
    await plugin.initialize({});

    const results = await Promise.all(
      filePaths.map(fp => plugin.parse(fp))
    );

    parentPort.postMessage({ success: true, data: results });
  }
});
```

**性能提升预估**:
- 4 核 CPU: 3x 加速
- 8 核 CPU: 5-6x 加速（考虑 I/O 瓶颈）

---

#### 建议 2: 增量解析 + 智能缓存

**问题**: 每次触发都重新解析所有文件

**解决方案**: Git-aware 缓存系统

```typescript
// core/cache/git-aware-cache.ts

import { createHash } from 'crypto';
import { execSync } from 'child_process';

class GitAwareCache {
  private cacheDir = '.archguard/cache';
  private indexFile = `${this.cacheDir}/index.json`;
  private index: CacheIndex = new Map();

  async get(filePath: string): Promise<ArchJSON | null> {
    const currentHash = this.getGitHash(filePath);
    const cached = this.index.get(filePath);

    if (cached && cached.hash === currentHash) {
      // 缓存命中，读取缓存文件
      const cachePath = `${this.cacheDir}/${cached.hash}.json`;
      return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    }

    return null; // 缓存未命中
  }

  async set(filePath: string, archJson: ArchJSON): Promise<void> {
    const hash = this.getGitHash(filePath);
    const cachePath = `${this.cacheDir}/${hash}.json`;

    await fs.writeFile(cachePath, JSON.stringify(archJson));
    this.index.set(filePath, { hash, timestamp: Date.now() });
    await this.saveIndex();
  }

  private getGitHash(filePath: string): string {
    try {
      // 使用 Git 的文件哈希（比文件内容哈希更快）
      const hash = execSync(`git hash-object ${filePath}`)
        .toString()
        .trim();
      return hash;
    } catch {
      // 降级到内容哈希
      const content = fs.readFileSync(filePath);
      return createHash('sha256').update(content).digest('hex');
    }
  }

  async getChangedFiles(): Promise<string[]> {
    // 获取 Git 变更的文件列表
    const output = execSync('git diff --name-only HEAD').toString();
    return output.split('\n').filter(Boolean);
  }

  async invalidate(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      this.index.delete(filePath);
    }
    await this.saveIndex();
  }

  private async saveIndex(): Promise<void> {
    const data = JSON.stringify(Array.from(this.index.entries()));
    await fs.writeFile(this.indexFile, data);
  }
}
```

**使用示例**:

```typescript
class SmartParser {
  private cache = new GitAwareCache();

  async parseProject(): Promise<ArchJSON[]> {
    const allFiles = await this.discoverFiles();
    const changedFiles = await this.cache.getChangedFiles();

    const results: ArchJSON[] = [];

    // 1. 变更的文件：重新解析
    for (const file of changedFiles) {
      const archJson = await this.plugin.parse(file);
      await this.cache.set(file, archJson);
      results.push(archJson);
    }

    // 2. 未变更的文件：读取缓存
    const unchangedFiles = allFiles.filter(f => !changedFiles.includes(f));
    for (const file of unchangedFiles) {
      const cached = await this.cache.get(file);
      if (cached) {
        results.push(cached);
      } else {
        // 首次解析
        const archJson = await this.plugin.parse(file);
        await this.cache.set(file, archJson);
        results.push(archJson);
      }
    }

    return results;
  }
}
```

**性能提升预估**:
- 首次运行: 0% (建立缓存)
- 小改动 (5% 文件): 95% 加速
- 中等改动 (20% 文件): 80% 加速

---

### 2.2 内存优化

#### 建议 3: 流式处理 + 内存池

**问题**: 大项目一次性加载所有 AST 到内存，可能 OOM

**解决方案**: 流式处理架构

```typescript
// core/parser/streaming-parser.ts

import { Readable } from 'stream';

class StreamingParser {
  async *parseFilesStream(filePaths: string[]): AsyncGenerator<ArchJSON> {
    for (const filePath of filePaths) {
      try {
        const archJson = await this.plugin.parse(filePath);
        yield archJson;

        // 主动触发垃圾回收（仅在必要时）
        if (global.gc && this.shouldGC()) {
          global.gc();
        }
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error);
      }
    }
  }

  private shouldGC(): boolean {
    const used = process.memoryUsage();
    const threshold = 500 * 1024 * 1024; // 500MB
    return used.heapUsed > threshold;
  }
}

// 使用示例
const parser = new StreamingParser();
const entities: Entity[] = [];

for await (const archJson of parser.parseFilesStream(filePaths)) {
  entities.push(...archJson.entities);

  // 可以立即处理，无需等待所有文件
  if (entities.length > 100) {
    await this.processBatch(entities.splice(0, 100));
  }
}
```

**收益**:
- 内存峰值降低 60-80%
- 支持超大型项目（> 5000 文件）
- 更早产出部分结果（增量式体验）

---

### 2.3 AI 调用优化

#### 建议 4: 请求批处理 + 响应缓存

参见 `02-ai-integration-strategy.md` 建议 5-6。

**额外优化**: 预测式预热

```typescript
class PredictiveAIPreheater {
  async preheat(recentChanges: string[]): Promise<void> {
    // 分析常被一起修改的文件模式
    const relatedFiles = await this.predictRelatedFiles(recentChanges);

    // 后台预先生成架构文档
    this.backgroundGenerate(relatedFiles);
  }

  private async predictRelatedFiles(files: string[]): Promise<string[]> {
    // 基于历史 Git 提交记录，找出经常一起变更的文件
    const coChangePatterns = await this.mineGitHistory();
    return coChangePatterns.getRelated(files);
  }
}
```

---

## 3. 可观测性设计

### 3.1 指标收集

#### 建议 5: Prometheus 指标导出

```typescript
// core/metrics/metrics.ts

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

class ArchGuardMetrics {
  private registry = new Registry();

  // 计数器: 已解析文件数
  private filesProcessed = new Counter({
    name: 'archguard_files_processed_total',
    help: 'Total number of files processed',
    labelNames: ['language', 'status'],
    registers: [this.registry]
  });

  // 直方图: 解析耗时分布
  private parseLatency = new Histogram({
    name: 'archguard_parse_duration_seconds',
    help: 'File parsing latency',
    labelNames: ['language'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [this.registry]
  });

  // 直方图: AI 调用耗时
  private aiCallLatency = new Histogram({
    name: 'archguard_ai_call_duration_seconds',
    help: 'AI API call latency',
    labelNames: ['model', 'complexity'],
    buckets: [0.5, 1, 2, 5, 10, 30],
    registers: [this.registry]
  });

  // 仪表盘: 缓存命中率
  private cacheHitRate = new Gauge({
    name: 'archguard_cache_hit_rate',
    help: 'Cache hit rate (0-1)',
    registers: [this.registry]
  });

  // 计数器: AI 成本累计
  private aiCostTotal = new Counter({
    name: 'archguard_ai_cost_usd_total',
    help: 'Total AI API cost in USD',
    labelNames: ['model'],
    registers: [this.registry]
  });

  // 工具方法
  recordParsing(language: string, durationSeconds: number, success: boolean) {
    this.filesProcessed.inc({ language, status: success ? 'success' : 'error' });
    if (success) {
      this.parseLatency.observe({ language }, durationSeconds);
    }
  }

  recordAICall(model: string, complexity: string, durationSeconds: number, cost: number) {
    this.aiCallLatency.observe({ model, complexity }, durationSeconds);
    this.aiCostTotal.inc({ model }, cost);
  }

  updateCacheStats(hits: number, total: number) {
    this.cacheHitRate.set(hits / total);
  }

  // HTTP 端点：供 Prometheus 抓取
  getMetricsEndpoint(): string {
    return this.registry.metrics();
  }
}
```

**Grafana 仪表盘示例配置**:

```yaml
# grafana-dashboard.json
{
  "dashboard": {
    "title": "ArchGuard Performance",
    "panels": [
      {
        "title": "Parse Throughput",
        "targets": [{
          "expr": "rate(archguard_files_processed_total[5m])"
        }]
      },
      {
        "title": "P95 Parse Latency",
        "targets": [{
          "expr": "histogram_quantile(0.95, archguard_parse_duration_seconds)"
        }]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [{
          "expr": "archguard_cache_hit_rate"
        }]
      },
      {
        "title": "Daily AI Cost",
        "targets": [{
          "expr": "increase(archguard_ai_cost_usd_total[24h])"
        }]
      }
    ]
  }
}
```

---

### 3.2 分布式追踪

#### 建议 6: OpenTelemetry 集成

```typescript
// core/telemetry/tracing.ts

import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

class ArchGuardTracer {
  private tracer = trace.getTracer('archguard', '1.0.0');

  async traceOperation<T>(
    name: string,
    operation: () => Promise<T>,
    attributes?: Record<string, any>
  ): Promise<T> {
    const span = this.tracer.startSpan(name, { attributes });

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        operation
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }
}

// 使用示例
const tracer = new ArchGuardTracer();

async function processProject() {
  return tracer.traceOperation('processProject', async () => {
    const files = await tracer.traceOperation('discoverFiles', discoverFiles);

    const archJsons = await tracer.traceOperation(
      'parseFiles',
      () => parser.parseFiles(files),
      { fileCount: files.length }
    );

    const diagram = await tracer.traceOperation(
      'generateDiagram',
      () => aiConnector.generate(archJsons),
      { entityCount: archJsons.reduce((sum, a) => sum + a.entities.length, 0) }
    );

    return diagram;
  });
}
```

**追踪视图示例**:

```
Span: processProject [2341ms]
  ├─ Span: discoverFiles [127ms]
  ├─ Span: parseFiles [1802ms]
  │  ├─ Span: parseFile (UserService.ts) [45ms]
  │  ├─ Span: parseFile (OrderService.ts) [52ms]
  │  └─ ...
  └─ Span: generateDiagram [412ms]
     ├─ Span: aiRequest [398ms]
     │  ├─ Span: buildPrompt [8ms]
     │  └─ Span: httpCall [390ms]
     └─ Span: validateOutput [14ms]
```

---

### 3.3 结构化日志

#### 建议 7: 高性能日志系统

```typescript
// core/logging/logger.ts

import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  },
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});

// 使用示例
logger.info({
  event: 'parsing.started',
  fileCount: 42,
  language: 'typescript'
});

logger.warn({
  event: 'cache.miss',
  file: 'UserService.ts',
  reason: 'file_modified'
});

logger.error({
  event: 'ai.call.failed',
  model: 'claude-3-5-sonnet',
  error: error.message,
  retryCount: 2
});

// 性能敏感路径：使用子 logger
const parseLogger = logger.child({ component: 'parser' });

parseLogger.debug({
  event: 'ast.built',
  file: 'Service.ts',
  nodeCount: 342,
  duration: 45
});
```

**日志查询示例** (使用 Loki/Elasticsearch):

```logql
# 查找解析失败的文件
{component="parser"} |= "parsing.failed"

# 查看 AI 调用成本趋势
sum by (model) (
  rate({event="ai.call.completed"}[1h])
  * on() group_left() ai_cost_per_call
)

# 分析慢解析文件（> 1s）
{event="parsing.completed"} | json | duration > 1000
```

---

## 4. 性能测试框架

### 4.1 基准测试套件

```typescript
// __benchmarks__/parsing.bench.ts

import { Suite } from 'benchmark';
import { TypeScriptPlugin } from '../plugins/typescript';

const suite = new Suite();

// 测试场景 1: 小文件
suite.add('Parse small file (100 LOC)', async () => {
  await plugin.parse('__fixtures__/SmallClass.ts');
});

// 测试场景 2: 中等文件
suite.add('Parse medium file (500 LOC)', async () => {
  await plugin.parse('__fixtures__/MediumClass.ts');
});

// 测试场景 3: 大文件
suite.add('Parse large file (2000 LOC)', async () => {
  await plugin.parse('__fixtures__/LargeClass.ts');
});

// 测试场景 4: 批量解析
suite.add('Parse 100 files in parallel', async () => {
  const files = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
  await parallelParser.parseFiles(files);
});

suite
  .on('cycle', (event: any) => {
    console.log(String(event.target));
  })
  .on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
  })
  .run({ async: true });
```

### 4.2 负载测试

```typescript
// __tests__/load/stress-test.ts

import { expect } from 'chai';

describe('Load Testing', () => {
  it('should handle 1000 files without crashing', async () => {
    const files = generateTestFiles(1000);

    const startMem = process.memoryUsage().heapUsed;
    const startTime = Date.now();

    await parser.parseFiles(files);

    const endMem = process.memoryUsage().heapUsed;
    const endTime = Date.now();

    const duration = endTime - startTime;
    const memIncrease = (endMem - startMem) / 1024 / 1024; // MB

    expect(duration).to.be.lessThan(5000); // < 5s
    expect(memIncrease).to.be.lessThan(500); // < 500MB
  });

  it('should maintain performance under sustained load', async () => {
    const results: number[] = [];

    // 连续运行 10 次
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await parser.parseFiles(testFiles);
      results.push(Date.now() - start);
    }

    // 检查性能退化（最后一次不应比第一次慢 20% 以上）
    const degradation = results[9] / results[0];
    expect(degradation).to.be.lessThan(1.2);
  });
});
```

---

## 5. 实施路线图

### Phase 1: 性能基础 (Week 1-2)
- [ ] 实现并行解析（Worker Threads）
- [ ] 集成 Git-aware 缓存
- [ ] 建立基准测试套件

### Phase 2: 可观测性 (Week 3-4)
- [ ] 集成 Prometheus 指标
- [ ] 添加结构化日志（pino）
- [ ] 配置 Grafana 仪表盘

### Phase 3: 高级优化 (Week 5-6)
- [ ] 实现流式处理
- [ ] 添加分布式追踪（OpenTelemetry）
- [ ] 开发性能分析工具

### Phase 4: 持续优化 (Ongoing)
- [ ] 定期运行负载测试
- [ ] 分析性能回归
- [ ] 优化热点代码路径

---

## 6. 成功指标

| 指标 | 当前 | 目标 | 测量方法 |
|------|------|------|---------|
| 500 文件解析时间 | - | < 1s | 基准测试 |
| 内存峰值（1000 文件）| - | < 500MB | 负载测试 |
| 缓存命中率 | - | > 70% | Prometheus |
| P95 AI 延迟 | - | < 3s | 追踪数据 |
| 月度可观测性覆盖率 | - | > 90% | 代码审查 |

---

**下一步行动**:
1. 搭建性能测试环境
2. 建立性能基线数据
3. 实施 Worker Threads 并行解析
4. 部署 Prometheus + Grafana 监控栈
