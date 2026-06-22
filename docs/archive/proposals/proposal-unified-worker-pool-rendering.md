# Proposal: 统一 Worker Pool 渲染路径，废弃主线程渲染路径

## Problem Statement

当前 SVG 渲染存在两条并行路径，职责边界模糊，配置不一致，并有隐性冗余处理：

**主线程路径**（单图或 pool 未激活时）：

```
mermaidCode
  → IsomorphicMermaidRenderer.renderSVG()
      ├─ mermaid.initialize()  [含 maxTextSize:200000, themeVariables, theme]
      ├─ mermaid.render()
      └─ 注入 background-color        ← 后处理 A，在 renderSVG() 内部
  → inlineEdgeStyles(svg)             ← 后处理 B，在 router 层
  → convertSVGToPNG(processedSvg)     ← 内部再次调用 inlineEdgeStyles（冗余）
```

**Worker Pool 路径**（图数 ≥ 2 时激活）：

```
mermaidCode
  → pool.render()
      └─ render-worker.ts
          ├─ mermaid.initialize()  [仅 theme, securityLevel；缺 maxTextSize, themeVariables]
          └─ mermaid.render()      ← 原始 SVG，无后处理
  → injectBackground(svg)             ← 后处理 A，在 router 层补注
  → inlineEdgeStyles(svg)             ← 后处理 B，在 router 层
  → convertSVGToPNG(processedSvg)     ← 内部再次调用 inlineEdgeStyles（冗余）
```

具体问题：

1. **两条路径并存，行为不对称**：单图走主线程（串行），多图走 Worker Pool（并行）。调试时行为不一致；增加后处理步骤时必须改两处。

2. **Worker 初始化配置不完整**：`WorkerInitData` 只有 `theme` 和 `backgroundColor`（后者在 worker 中从未被读取），缺少 `maxTextSize`（worker 默认 50000 vs 主线程 200000）和 `themeVariables`。大型 C++ 类图在 Worker Pool 激活时超出字符限制，自动 fallback 到主线程，并行优化失效。

3. **后处理职责错位**：`injectBackground` 和 `inlineEdgeStyles` 均为纯字符串正则处理，属于 CPU-bound 工作，应在 worker 中完成（业界共识：CPU 密集型后处理属于 worker 职责，I/O 留给主线程）。当前设计将它们拆分在 `renderSVG()` 内部和 router 层，缺乏单一职责。

4. **`inlineEdgeStyles` 执行两次**：router 层调用一次后得到 `processedSvg`，再传入 `convertSVGToPNG(processedSvg)`，后者内部再次调用 `inlineEdgeStyles`。目前幂等无副作用，但是冗余的隐性负担。

5. **Worker OOM 可导致主进程崩溃**：当前 Worker 创建时未设置 `resourceLimits`。根据 Node.js 已知行为，Worker Thread 内的堆 OOM 会导致整个主进程崩溃（nodejs/node#47224），而普通未捕获异常不会。对于大型图渲染这是实际风险。

6. **Worker 崩溃导致 pending Promise 永久挂起**：当前 pool 的 `start()` 未监听 worker `exit` 事件，worker 崩溃后 in-flight job 的 Promise 永远无法 resolve，调用方将无限等待。

## Goals

- 始终使用 Worker Pool 进行 SVG 渲染，废弃 `DiagramOutputRouter` 中的主线程渲染路径。
- 将所有 SVG 后处理（background 注入、edge style inlining）移入 worker，worker 返回完整可用的 SVG。
- 提取 `postProcessSVG` 为独立共享工具，`inlineEdgeStyles` 迁移至此处定义；worker 和主线程 fallback 调用同一实现，逻辑唯一。
- Worker `mermaid.initialize()` 接受完整配置（`maxTextSize`、`themeVariables`）。
- 消除 `convertSVGToPNG()` 内部的冗余 `inlineEdgeStyles()` 调用。
- 在 Worker 创建时设置内存限制，防止 OOM 崩溃主进程。
- Worker 崩溃时：立即 resolve in-flight job（携带 error），驱动 fallback，然后自动重启 worker。
- 保持渲染行为与现有主线程路径完全一致，不引入视觉回归。
- 保持所有现有测试通过。

## Non-Goals

- 不迁移到第三方 worker pool 库（如 piscina）——这是后续独立改进。
- 不修改 `renderAndSave()` / `diagram-generator.ts` 中未经 router 的旧式渲染调用（独立遗留路径，后续单独清理）。
- 不更改 Worker Pool 的并发调度逻辑（idle queue、dispatch、terminate）。
- 不更改对外 CLI 接口、配置项或输出格式。
- 不更改 `IsomorphicMermaidRenderer.renderSVG()` 对现有内部调用的行为（`renderAndSave` 仍通过它运作）。

## Background: isomorphic-mermaid 的 Worker Thread 适用性

`isomorphic-mermaid` 使用 `svgdom` + `jsdom` 作为 DOM shim，直接调用 mermaid 的 Node.js 兼容层，**不依赖 Playwright 或任何浏览器进程**：

```javascript
// node_modules/isomorphic-mermaid/dist/main.js
import { createHTMLWindow } from "svgdom";
import { JSDOM } from "jsdom";
const svgWindow = createHTMLWindow();
Object.assign(globalThis, { window: svgWindow, document: svgWindow.document });
```

每个 Worker Thread 拥有独立的 V8 isolate 和 `globalThis`，因此 `svgdom` 的全局 `window` 赋值在线程间完全隔离，无竞争风险。可行性已由 `scripts/spike-worker-mermaid.mjs` 验证。

## Design

### 1. 新增 `src/mermaid/post-process-svg.ts`，迁移 `inlineEdgeStyles`

将 `inlineEdgeStyles` 从 `renderer.ts` 迁移至新文件，并在此基础上定义 `postProcessSVG`。`renderer.ts` 改为从新文件重新导出，保持现有 import 不破坏。

```typescript
// src/mermaid/post-process-svg.ts  ← 新建，是后处理的唯一真相来源

/**
 * Inlines fill:none on flowchart edge paths to work around librsvg's
 * limited CSS class-selector support (sharp uses librsvg for SVG→PNG).
 * (原 renderer.ts 中的完整实现，原样迁移)
 */
export function inlineEdgeStyles(svg: string): string {
  // ... 原 renderer.ts 实现（5 类修复：flowchart-link, relation, background rect, node rect, text-anchor）
}

/**
 * Full SVG post-processing pipeline: background injection + edge style inlining.
 * Single source of truth used by both the worker and the main-thread fallback.
 */
export function postProcessSVG(rawSvg: string, transparentBackground: boolean): string {
  const svg = transparentBackground ? rawSvg : injectBackground(rawSvg);
  return inlineEdgeStyles(svg);
}

function injectBackground(svg: string): string {
  const bg = 'white';
  if (/<svg[^>]*style="[^"]*"/.test(svg)) {
    return svg.replace(/(<svg[^>]*style=")([^"]*)(")/g, `$1$2; background-color: ${bg};$3`);
  }
  return svg.replace(/<svg/, `<svg style="background-color: ${bg};"`);
}
```

```typescript
// src/mermaid/renderer.ts  ← 修改：删除 inlineEdgeStyles 原定义，改为重新导出
export { inlineEdgeStyles } from './post-process-svg.js';  // 保持对现有 import 方的兼容
```

此设计使依赖方向正确：`post-process-svg` 是基础层，`renderer` 和 `worker` 都依赖它；`renderer` 不依赖 `post-process-svg`（只是重新导出），不存在循环依赖。

### 2. 为 `IsomorphicMermaidRenderer` 新增 `renderSVGRaw()`

在 `src/mermaid/renderer.ts` 中新增一个 **package-internal** 方法，专供 router 的 fallback path 使用：

```typescript
/**
 * Render Mermaid code to raw SVG without any post-processing.
 * Used by the worker fallback path in DiagramOutputRouter so that
 * postProcessSVG() can be applied uniformly to both pool and fallback results.
 */
async renderSVGRaw(mermaidCode: string): Promise<string> {
  this.ensureInitialized();
  try {
    const { svg } = await mermaid.render(this.generateId(), mermaidCode);
    return svg;
  } catch (error) {
    throw new Error(
      `Failed to render SVG: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
```

保留现有 `renderSVG()`（含 background 注入）供 `renderAndSave()` 等旧式路径使用，不改变其行为。

### 3. 扩展 `WorkerInitData`，补齐完整初始化配置

```typescript
// src/mermaid/render-worker-pool.ts
export interface WorkerInitData {
  theme: string;
  maxTextSize: number;
  transparentBackground: boolean;
  themeVariables?: Record<string, string>;
  // 删除：backgroundColor（worker 中从未读取，由 postProcessSVG 替代）
}
```

### 4. 增强 Worker Pool：OOM 保护 + in-flight 追踪 + 崩溃重启

核心问题：worker 崩溃时，已 dispatch 的 in-flight job 的 Promise 会永久挂起，因为 `onResult()` 永远不会被调用。修复方案：在 pool 中维护 `workerInFlight: Map<Worker, string>`（worker → jobId 映射）。

```typescript
// src/mermaid/render-worker-pool.ts
export class MermaidRenderWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ job: RenderJob }> = [];
  private pending = new Map<string, (r: RenderResult) => void>();
  private workerInFlight = new Map<Worker, string>(); // NEW: track in-flight job per worker
  private workerRestarts = new Map<Worker, number>();  // NEW: track restart count per slot

  private readonly MAX_RESTARTS = 3;

  async start(): Promise<void> {
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this.spawnWorker());
    }
  }

  private spawnWorker(): Worker {
    const w = new Worker(WORKER_FILE, {
      workerData: this.initData,
      execArgv: sanitizeWorkerExecArgv(process.execArgv),
      resourceLimits: { maxOldGenerationSizeMb: 512 },  // OOM 保护
    });
    w.on('message', (result: RenderResult) => this.onResult(w, result));
    w.on('error', (err) => {
      console.error(`[render-worker] worker error: ${err.message}`);
    });
    w.on('exit', (code) => this.onWorkerExit(w, code));
    this.idle.push(w);
    return w;
  }

  private onWorkerExit(w: Worker, code: number): void {
    if (code === 0) return; // 正常退出（terminate() 触发），不需要处理

    // Step 1: resolve in-flight job with error（防止 Promise 永久挂起）
    const jobId = this.workerInFlight.get(w);
    if (jobId) {
      const resolve = this.pending.get(jobId);
      if (resolve) {
        this.pending.delete(jobId);
        resolve({ jobId, success: false, error: `Worker exited unexpectedly (code=${code})` });
      }
      this.workerInFlight.delete(w);
    }

    // Step 2: 替换崩溃的 worker（上限 MAX_RESTARTS 次）
    const restarts = this.workerRestarts.get(w) ?? 0;
    if (restarts < this.MAX_RESTARTS) {
      console.warn(`[render-worker] worker exited (code=${code}), respawning (${restarts + 1}/${this.MAX_RESTARTS})`);
      const replacement = this.spawnWorker();
      this.workerRestarts.set(replacement, restarts + 1);
      const idx = this.workers.indexOf(w);
      if (idx !== -1) this.workers[idx] = replacement;
      // replacement 已在 spawnWorker() 中加入 idle，无需再 push
    } else {
      console.error(`[render-worker] worker reached max restarts (${this.MAX_RESTARTS}), not respawning`);
      const idx = this.workers.indexOf(w);
      if (idx !== -1) this.workers.splice(idx, 1); // 从 pool 中永久移除
    }
    this.workerRestarts.delete(w);
  }

  private dispatch(job: RenderJob): void {
    const worker = this.idle.pop();
    if (worker) {
      this.workerInFlight.set(worker, job.jobId); // 记录 in-flight
      worker.postMessage(job);
    } else {
      this.queue.push({ job });
    }
  }

  private onResult(worker: Worker, result: RenderResult): void {
    this.workerInFlight.delete(worker); // 清除 in-flight 记录
    const resolve = this.pending.get(result.jobId);
    if (resolve) {
      this.pending.delete(result.jobId);
      resolve(result);
    }
    const next = this.queue.shift();
    if (next) {
      this.workerInFlight.set(worker, next.job.jobId);
      worker.postMessage(next.job);
    } else {
      this.idle.push(worker);
    }
  }
}
```

### 5. 将后处理移入 Worker

```typescript
// src/mermaid/render-worker.ts
import { postProcessSVG } from './post-process-svg.js';

const initData = workerData as WorkerInitData;

mermaid.initialize({
  startOnLoad: false,
  theme: (initData.theme ?? 'default') as any,
  securityLevel: 'loose',
  maxTextSize: initData.maxTextSize ?? 200000,
  themeVariables: initData.themeVariables,
});

parentPort.on('message', async (job: RenderJob) => {
  try {
    const { svg: rawSvg } = await mermaid.render(job.jobId, job.mermaidCode);
    const svg = postProcessSVG(rawSvg, initData.transparentBackground);
    parentPort.postMessage({ jobId: job.jobId, success: true, svg } satisfies RenderResult);
  } catch (e) {
    parentPort.postMessage({
      jobId: job.jobId,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies RenderResult);
  }
});
```

### 6. 修改 Pool 创建：始终启动，大小最小为 1；json format 跳过 start()

```typescript
// src/cli/processors/diagram-processor.ts

// 保留 Atlas 特殊处理（原有逻辑不变）
const diagramCount = this.diagrams.length;
const isGoAtlas = diagramCount === 1 && this.diagrams[0].language === 'go';
const atlasLayerCount = isGoAtlas
  ? ((this.diagrams[0].languageSpecific?.atlas as { layers?: string[] } | undefined)?.layers?.length ?? 4)
  : 0;
const effectiveDiagramCount = Math.max(diagramCount, atlasLayerCount);

// 始终创建 pool，预留 1 核给主线程 I/O（新）
const poolSize = Math.max(1, Math.min(os.cpus().length - 1, effectiveDiagramCount, 4));

const pool = new MermaidRenderWorkerPool(poolSize, {
  theme: poolTheme,
  maxTextSize: 200000,
  transparentBackground: this.globalConfig.mermaid?.transparentBackground ?? false,
  themeVariables: typeof this.globalConfig.mermaid?.theme === 'object'
    ? (this.globalConfig.mermaid.theme as any).variables
    : undefined,
});

// json format 时跳过 start()：检查所有图的有效 format（新：逐图检查，非仅看全局）
const needsRendering = this.diagrams.some(
  (d) => (d.format ?? this.globalConfig.format ?? 'mermaid') !== 'json'
);
if (needsRendering) await pool.start();
```

> **注**：`MermaidConfig` 当前无 `maxTextSize` 字段，此处硬编码 200000 与主线程保持一致。若后续需要用户可配置，在 `MermaidConfig` 新增 `maxTextSize?: number` 并从 `globalConfig` 读取即可。

### 7. 简化 `DiagramOutputRouter`：统一走 pool，fallback 使用 `renderSVGRaw()`

`pool` 参数类型改为 `MermaidRenderWorkerPool`（非 nullable）。

四个 `generate*` 方法的 SVG 渲染部分统一为：

```typescript
const poolResult = await pool.render({ mermaidCode: code });
let processedSvg: string;
if (!poolResult.success) {
  // Fallback: worker 失败时退回主线程
  // renderSVGRaw() 内部调用 ensureInitialized()，保证 mermaid 正确初始化
  console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
  const rawSvg = await mermaidRenderer.renderSVGRaw(code);
  processedSvg = postProcessSVG(rawSvg, this.globalConfig.mermaid?.transparentBackground ?? false);
} else {
  processedSvg = poolResult.svg!;  // worker 已完成 postProcessSVG，直接使用
}
```

`IsomorphicMermaidRenderer` 实例（`mermaidRenderer`）在 router 中仍然保留，用途：
1. `renderSVGRaw()` —— fallback 路径的 mermaid 渲染（含 ensureInitialized）
2. `convertSVGToPNG()` —— PNG 转换

删除：
- `injectBackground()` 私有方法（逻辑移入 `post-process-svg.ts`）
- 所有 `mermaidRenderer.renderSVG()` 调用（改用 `renderSVGRaw()` 仅在 fallback 中）
- router 层所有 `inlineEdgeStyles(svg)` 直接调用（worker 已处理）

### 8. 消除 `convertSVGToPNG()` 内部的冗余 `inlineEdgeStyles`

```typescript
// src/mermaid/renderer.ts
async convertSVGToPNG(svg: string, outputPath: string): Promise<void> {
  // svg 由调用方保证已经过 postProcessSVG 处理（router 路径）
  // 注意：renderAndSave() 是独立遗留路径，自行在调用前执行 inlineEdgeStyles，不受影响
  const svgBuffer = Buffer.from(svg);
  // ... 其余 sharp 逻辑不变
}
```

## 最终数据流

```
mermaidCode
  → pool.render()
      └─ Worker Thread:
          ├─ mermaid.initialize()  [完整 config: theme, maxTextSize, themeVariables]
          ├─ mermaid.render()      → rawSvg
          └─ postProcessSVG()     → processedSvg  [background + inlineEdgeStyles]
  → poolResult.svg                 [已完整处理，直接写入 .svg]

  fallback（仅 worker 失败时）:
  → mermaidRenderer.renderSVGRaw() [ensureInitialized + mermaid.render]
  → postProcessSVG()               [同一实现]
  → processedSvg

  → write .svg (processedSvg)
  → convertSVGToPNG(processedSvg)  [sharp，内部不再调用 inlineEdgeStyles]
  → write .png
```

`postProcessSVG` 是唯一后处理实现，worker path 和 fallback path 共用同一函数。

## Alternatives

### Alternative A: 提取统一后处理层，保留主线程路径

在 router 层建立 `postProcessSVG()`，保留主线程 fallback 路径，两条路径都走同一后处理管道。

不采用原因：后处理依然在主线程执行，违反"CPU-bound 工作属于 worker"的架构原则；两条路径依然并存，单图 vs 多图行为仍不对称。

### Alternative B: 保持现状，只补齐 Worker 配置

只把 `maxTextSize` 和 `themeVariables` 加入 `WorkerInitData`，不做路径统一。

不采用原因：两条路径并存问题未解决；`inlineEdgeStyles` 冗余调用未消除；后处理仍分散在 router 和 worker 中；未来每次增加后处理步骤都需要同步两处实现。

### Alternative C: 迁移到 piscina

使用成熟的 worker pool 库替换自定义实现，获得 worker 崩溃自动重试、idle timeout、backpressure 等能力。

不在本 proposal 范围内，但推荐作为后续改进。当前自定义实现足够满足需求；迁移可在路径统一完成后以独立 PR 推进。

## Open Questions

1. **`renderSVG()` 与 `renderSVGRaw()` 的长期共存**：两者职责差异：`renderSVGRaw()` 纯渲染（无后处理），`renderSVG()` 渲染+background（供 `renderAndSave()` 使用）。长期来看，`renderAndSave()` 也应迁移到 `postProcessSVG` 管道，届时 `renderSVG()` 可被废弃。但本次不在范围内。

2. **`maxTextSize` 用户可配置**：当前 `MermaidConfig` 无此字段，worker 使用硬编码 200000。若未来需要用户配置，在 `MermaidConfig` 中新增 `maxTextSize?: number` 并在 pool 创建时读取即可，不影响本次方案结构。

3. **single-cpus 机器的 poolSize**：`Math.max(1, Math.min(os.cpus().length - 1, ...))` 在单核机器（cpus=1）上 `cpus-1=0`，`Math.max(1, 0)` = 1。仍然创建 pool，但 worker 和主线程共享同一核，没有并行收益，会有上下文切换开销。可考虑在单核时跳过 pool，但这会引入另一个条件分支，不建议。
