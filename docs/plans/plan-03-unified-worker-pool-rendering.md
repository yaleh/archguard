# Plan 03: 统一 Worker Pool 渲染路径

## Overview

本计划落实 [proposal-unified-worker-pool-rendering.md](../proposals/proposal-unified-worker-pool-rendering.md) 中定义的渲染路径统一方案，目标是：

- 将 SVG 后处理（background 注入、edge style inlining）从 router 层迁入 worker
- 提取 `postProcessSVG` 为唯一共享实现，`inlineEdgeStyles` 迁移至此处定义
- 补齐 Worker 的 `mermaid.initialize()` 配置（`maxTextSize`、`themeVariables`）
- 始终创建 Worker Pool（poolSize 最小为 1），废弃 router 中的条件性双路径
- 添加 Worker OOM 保护（`resourceLimits`）、in-flight job 追踪和异常退出自动重启
- 新增 `IsomorphicMermaidRenderer.renderSVGRaw()` 供 fallback 路径使用
- 消除 `convertSVGToPNG()` 内部的冗余 `inlineEdgeStyles` 调用

实现范围覆盖五个层次：

- `src/mermaid/post-process-svg.ts`（新建，迁移 `inlineEdgeStyles` + 定义 `postProcessSVG`）
- `src/mermaid/renderer.ts`（新增 `renderSVGRaw()`，重导出 `inlineEdgeStyles`，移除 `convertSVGToPNG` 内冗余调用）
- `src/mermaid/render-worker-pool.ts`（扩展 `WorkerInitData`，添加 OOM 保护 + in-flight 追踪 + 崩溃重启）
- `src/mermaid/render-worker.ts`（补齐初始化配置，后处理移入 worker）
- `src/cli/processors/diagram-processor.ts`（pool 始终创建，json format 跳过 start）
- `src/cli/processors/diagram-output-router.ts`（统一走 pool，fallback 改用 `renderSVGRaw()`）

## Phases

### Phase A: 新增 `post-process-svg.ts` + 迁移 `inlineEdgeStyles` + 新增 `renderSVGRaw()`

Objectives

- 建立 `postProcessSVG` 和 `inlineEdgeStyles` 的单一定义位置
- `renderer.ts` 重新导出 `inlineEdgeStyles`，保持现有调用方兼容
- 新增 `renderSVGRaw()` 供 fallback 路径使用（纯渲染，不做后处理）
- 本 Phase 不改变任何运行时行为（纯重构）

Stages

1. 先补失败测试
   - 新增 `tests/unit/mermaid/post-process-svg.test.ts`
     - `postProcessSVG(svg, false)`：SVG 根元素含 `background-color: white`，且 flowchart-link/relation/background rect/node rect/text-anchor 的 inline style 已修复
     - `postProcessSVG(svg, true)`：不注入 background-color，但 edge styles 仍处理
     - 幂等性：对已处理 SVG 重复调用结果不变
     - `inlineEdgeStyles` 从 `post-process-svg` 直接导出，可独立测试
   - 修改 `tests/unit/mermaid/renderer.test.ts`
     - 验证 `inlineEdgeStyles` 仍可从 `renderer.ts` import（重导出兼容性）
     - 新增 `renderSVGRaw()` 测试：返回未注入 background 的原始 SVG；调用失败时抛出错误
   - 确认以上测试当前均失败

2. 新建 `src/mermaid/post-process-svg.ts`
   - 将 `inlineEdgeStyles` 完整实现从 `renderer.ts` 原样迁移至此文件（含 5 类修复：flowchart-link、relation、background rect、node rect、text-anchor）
   - 在同文件定义私有 `injectBackground(svg: string): string`
   - 导出 `postProcessSVG(rawSvg: string, transparentBackground: boolean): string`
   - 导出 `inlineEdgeStyles` 供外部直接使用

3. 修改 `src/mermaid/renderer.ts`
   - 删除 `inlineEdgeStyles` 原始定义
   - 在文件顶部 import 并 re-export：`export { inlineEdgeStyles } from './post-process-svg.js'`
   - 新增 `renderSVGRaw(mermaidCode: string): Promise<string>`
     - 调用 `this.ensureInitialized()`（保证 mermaid 已初始化）
     - 调用 `mermaid.render()` 返回原始 SVG，不做任何后处理
     - 抛出错误时包装为带描述的 Error

Acceptance Criteria

- `post-process-svg.test.ts` 全部通过
- `inlineEdgeStyles` 可同时从 `post-process-svg` 和 `renderer` 正确 import
- `renderSVGRaw()` 返回不含 background-color 的原始 SVG
- 现有 `renderer.test.ts`、`diagram-output-router.test.ts` 全部通过（行为不变）
- `npm run type-check` 无新增错误

Dependencies

- 无外部依赖，可独立实施

---

### Phase B: 增强 Worker Pool（OOM 保护 + in-flight 追踪 + 崩溃重启）+ 更新 Worker

Objectives

- Worker 内部调用完整 `mermaid.initialize()`（含 `maxTextSize`、`themeVariables`）
- Worker 完成 `postProcessSVG` 后返回完整 SVG
- Pool 添加 `workerInFlight` 追踪，确保崩溃 worker 的 in-flight job 立即 resolve with error
- Worker 创建时携带 `resourceLimits.maxOldGenerationSizeMb: 512` 防止 OOM 崩溃主进程
- 崩溃 worker 自动重启（上限 3 次）

Stages

1. 先补失败测试
   - 修改 `tests/unit/mermaid/render-worker-pool.test.ts`
     - `WorkerInitData` 包含 `maxTextSize`、`transparentBackground`、`themeVariables`；不含 `backgroundColor`
     - Worker 创建时携带 `resourceLimits`（mock Worker 构造参数验证）
     - Worker 崩溃（`exit` 事件 code≠0）时：in-flight job Promise resolve with `success:false`，不永久挂起
     - 崩溃后自动创建 replacement worker 并加入 idle
     - 连续崩溃超过 MAX_RESTARTS 次时，不再重启，pool size 收缩
   - 扩展 render-worker 行为测试（可通过 integration test 验证）
     - Worker 返回的 `svg` 字段已包含 background-color（`transparentBackground=false`）
     - Worker 返回的 `svg` 字段不含 background-color（`transparentBackground=true`）

2. 修改 `src/mermaid/render-worker-pool.ts`
   - 扩展 `WorkerInitData`：删 `backgroundColor`，加 `maxTextSize: number`、`transparentBackground: boolean`、`themeVariables?: Record<string, string>`
   - 在 class 中添加 `workerInFlight = new Map<Worker, string>()` 和 `workerRestarts = new Map<Worker, number>()`
   - 提取 `spawnWorker(): Worker` 私有方法
     - 创建 Worker 时加 `resourceLimits: { maxOldGenerationSizeMb: 512 }`
     - 注册 `message`、`error`、`exit` 三个事件
     - 新 worker 自动加入 `this.idle`
   - `start()` 改为调用 `spawnWorker()` N 次
   - 新增 `onWorkerExit(w, code)` 私有方法（见 proposal Design §4）
   - `dispatch()` 中在 `worker.postMessage(job)` 前记录 `workerInFlight.set(worker, job.jobId)`
   - `onResult()` 中在 resolve 前清除 `workerInFlight.delete(worker)`；分发下一个 job 时也记录 in-flight
   - `terminate()` 现有逻辑不变（exit code=0 时 `onWorkerExit` 直接 return，不触发重启）

3. 修改 `src/mermaid/render-worker.ts`
   - import `postProcessSVG` from `./post-process-svg.js`
   - `mermaid.initialize()` 补加 `maxTextSize: initData.maxTextSize ?? 200000` 和 `themeVariables: initData.themeVariables`
   - `message` 处理器中：`mermaid.render()` 后调用 `postProcessSVG(rawSvg, initData.transparentBackground)`，返回完整处理后的 SVG

Acceptance Criteria

- `render-worker-pool.test.ts` 新增测试全部通过
- Worker 崩溃（模拟 exit code≠0）时 in-flight job Promise 立即 resolve with error，不挂起
- 崩溃后有 replacement worker 加入 idle，pool 可继续处理后续 job
- Worker 返回的 SVG 已含 background-color（非 transparent 场景）
- Worker 使用 `maxTextSize: 200000`，不再 fallback 至默认 50000
- 全量测试不回归

Dependencies

- 依赖 Phase A（`post-process-svg.ts` 和 `postProcessSVG` 已就绪，worker 才能 import）

---

### Phase C: Pool 始终创建 + Router 路径统一

Objectives

- `diagram-processor.ts` 始终创建 Worker Pool（poolSize ≥ 1），废弃 `effectiveDiagramCount >= 2` 激活条件
- json-only format 跳过 `pool.start()`（按每图 format 判断，不只看全局 format）
- `DiagramOutputRouter` 四个 `generate*` 方法统一走 pool；fallback 改用 `renderSVGRaw()` + `postProcessSVG()`
- 删除 router 中的 `injectBackground()` 和 `inlineEdgeStyles()` 直接调用

Stages

1. 先补失败测试
   - 修改 `tests/unit/cli/processors/diagram-processor.test.ts`
     - 单图场景：pool 也被创建，poolSize = 1
     - Go Atlas 单图（4 层）：poolSize = min(cpus-1, 4)，`effectiveDiagramCount` 计算逻辑保留
     - 所有 diagrams 为 json format：pool 创建但 `start()` 不被调用
     - 混合 format（部分 mermaid 部分 json）：`start()` 被调用
   - 修改 `tests/unit/cli/processors/diagram-output-router.test.ts`
     - `pool` 参数改为非 null mock（删除 `pool = null` 场景）
     - 成功路径：`poolResult.svg` 直接用于写入（不再经过 router 的 `inlineEdgeStyles`）
     - fallback 路径：`pool.render` 返回 `success: false` → 调用 `mermaidRenderer.renderSVGRaw()` + `postProcessSVG()`（不调用 `renderSVG()`）
     - 验证 `injectBackground` 不再被 router 调用（方法已删除）

2. 修改 `src/cli/processors/diagram-processor.ts`
   - 保留 Go Atlas 特殊处理（`atlasLayerCount`、`effectiveDiagramCount` 计算逻辑原样不变）
   - pool 创建改为无条件：`poolSize = Math.max(1, Math.min(os.cpus().length - 1, effectiveDiagramCount, 4))`
   - 删除 `effectiveDiagramCount >= 2` 条件判断
   - pool 构造参数改为新 `WorkerInitData` 格式（`maxTextSize`、`transparentBackground`、`themeVariables`；删 `backgroundColor`）
   - `pool.start()` 前判断：`const needsRendering = this.diagrams.some(d => (d.format ?? this.globalConfig.format ?? 'mermaid') !== 'json')`

3. 修改 `src/cli/processors/diagram-output-router.ts`
   - `route()` 及四个 `generate*` 方法的 `pool` 参数类型改为 `MermaidRenderWorkerPool`（非 nullable）
   - 删除 `injectBackground()` 私有方法
   - 四个方法渲染分支统一为：
     - pool 成功：`processedSvg = poolResult.svg!`（worker 已后处理，直接使用）
     - pool 失败：`const rawSvg = await mermaidRenderer.renderSVGRaw(code)` + `processedSvg = postProcessSVG(rawSvg, transparentBackground)`
   - 删除所有 `mermaidRenderer.renderSVG()` 调用
   - 删除所有 router 层直接调用的 `inlineEdgeStyles(svg)`
   - `IsomorphicMermaidRenderer` 实例保留，用于 `renderSVGRaw()` fallback 和 `convertSVGToPNG()`

Acceptance Criteria

- 单图和多图场景 pool 均被创建
- json-only 模式 pool 不 start（无 worker 启动日志）
- `diagram-output-router.test.ts` 所有路径均通过 pool，无 `pool = null` 分支
- fallback 路径（`success: false`）通过 `renderSVGRaw()` + `postProcessSVG()` 产生与 worker 路径等价的 SVG
- `injectBackground` / router 层 `inlineEdgeStyles` 已删除，无残留
- 全量测试不回归

Dependencies

- 依赖 Phase A（`postProcessSVG` 可用）
- 依赖 Phase B（worker 已返回完整处理后的 SVG，pool 行为已稳定）

---

### Phase D: 消除 `convertSVGToPNG` 内部冗余后处理

Objectives

- `convertSVGToPNG()` 不再内部调用 `inlineEdgeStyles`，接收已处理 SVG 直接转 PNG
- `renderAndSave()` 旧式路径行为不变（它在调用前已自行执行 `inlineEdgeStyles`）

Stages

1. 先补失败测试
   - 修改 `tests/unit/mermaid/renderer.test.ts`
     - spy 验证 `convertSVGToPNG()` 内部不再调用 `inlineEdgeStyles`（调用次数 = 0）
     - 验证传入已处理 SVG 时 PNG 输出正常（sharp pipeline 不受影响）
   - 确认 `renderAndSave()` 相关测试不变（它自行处理 SVG）

2. 修改 `src/mermaid/renderer.ts`
   - `convertSVGToPNG()` 删除 `const processed = inlineEdgeStyles(svg)` 及相关引用
   - 后续 `sharp()` 直接使用传入的 `svg` 参数
   - 方法 JSDoc 注明：调用方须确保 SVG 已通过 `postProcessSVG()` 处理
   - `renderAndSave()` 保持不变；在其 JSDoc 注明：独立遗留调用链，内部自行调用 `inlineEdgeStyles`

Acceptance Criteria

- `convertSVGToPNG` 内部不调用 `inlineEdgeStyles` 的 spy 断言通过
- `renderAndSave()` 行为不变，其测试全部通过
- 全量测试不回归

Dependencies

- 依赖 Phase C 完成：Phase C 后 router 传入 `convertSVGToPNG` 的 SVG 已由 `postProcessSVG` 处理过；若先于 Phase C 实施，router 尚未确保传入已处理 SVG，会导致 PNG 边框渲染错误

---

### Phase E: 回归验证

Objectives

- 证明四个 Phase 合并后不破坏现有 CLI 分析主流程
- 验证 SVG 输出质量（background、edge styles）在单图/多图/Go Atlas 场景下一致

Stages

1. 全量测试
   - `npm test`，确认全部测试通过，无新增失败

2. 类型检查与 Lint
   - `npm run type-check` 无新增类型错误
   - `npm run lint` 无新增警告；`npm run format:check` 通过

3. 构建与自分析
   - `npm run build`
   - `node dist/cli/index.js cache clear`
   - 多图场景（Worker Pool）：`node dist/cli/index.js analyze -v`
   - 单图场景（poolSize=1）：`node dist/cli/index.js analyze -v --diagrams package`
   - json format（pool 不 start）：`node dist/cli/index.js analyze -f json`
   - 检查：
     - 生成的 `.svg` 文件根元素含 `background-color: white`（grep 验证）
     - flowchart-link / relation path 的 fill/stroke 已 inline（grep 验证）
     - `.png` 渲染正常，边框非黑色填充（人工检查）
     - json format 无 worker 启动日志

4. 边界场景验证
   - fallback 路径：临时在 worker 中注入 `throw new Error('simulated crash')`，确认 fallback 路径产出正确 SVG 且输出 `console.warn`
   - OOM 保护：确认 `resourceLimits` 出现在 Worker 构造调用中（单元测试已覆盖，此处确认 build 后行为）

Acceptance Criteria

- 全量测试通过，lint/type-check 无新增问题
- 自分析产出的 SVG 背景为白色，PNG 箭头线条渲染正确
- json format 无 worker 启动日志
- fallback 路径日志可见且 SVG 输出正确
- `background-color: white` 在生成的 SVG 中可 grep 到

Dependencies

- 依赖 Phase A、B、C、D 全部完成
