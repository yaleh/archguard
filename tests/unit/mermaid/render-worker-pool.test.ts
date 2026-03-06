import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RenderJob, RenderResult } from '@/mermaid/render-worker-pool.js';

// Mock worker_threads at top level
vi.mock('worker_threads', () => {
  const { EventEmitter } = require('events');
  class MockWorker extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(undefined);
  }
  return { Worker: vi.fn(() => new MockWorker()) };
});

describe('MermaidRenderWorkerPool', () => {
  it('start() creates poolSize workers', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    (Worker as any).mockClear();
    const pool = new MermaidRenderWorkerPool(3, { theme: 'default', backgroundColor: 'white' });
    await pool.start();
    expect(Worker).toHaveBeenCalledTimes(3);
    await pool.terminate();
  });

  it('render() dispatches job to idle worker via postMessage', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    (Worker as any).mockClear();
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();

    const renderPromise = pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });

    // Simulate worker response
    const workerInstance = (Worker as any).mock.results[0].value;
    const sentJob: RenderJob = workerInstance.postMessage.mock.calls[0][0];
    workerInstance.emit('message', {
      jobId: sentJob.jobId,
      success: true,
      svg: '<svg/>',
    } satisfies RenderResult);

    const result = await renderPromise;
    expect(result.success).toBe(true);
    expect(result.svg).toBe('<svg/>');
    await pool.terminate();
  });

  it('isolates errors: failed job does not terminate pool', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    (Worker as any).mockClear();
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();

    const failPromise = pool.render({ mermaidCode: 'invalid' });

    const worker = (Worker as any).mock.results[0].value;
    const firstCall = worker.postMessage.mock.calls[0][0] as RenderJob;

    // Respond to first job with failure - worker becomes idle again
    worker.emit('message', {
      jobId: firstCall.jobId,
      success: false,
      error: 'parse error',
    } satisfies RenderResult);

    const failResult = await failPromise;
    expect(failResult.success).toBe(false);
    expect(failResult.error).toBe('parse error');

    // Pool should still be usable - submit a second job
    const successPromise = pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });
    const secondCall = worker.postMessage.mock.calls[1][0] as RenderJob;
    worker.emit('message', {
      jobId: secondCall.jobId,
      success: true,
      svg: '<svg/>',
    } satisfies RenderResult);

    const successResult = await successPromise;
    expect(successResult.success).toBe(true);
    await pool.terminate();
  });

  it('terminate() resolves all pending promises (queued and in-flight)', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    (Worker as any).mockClear();
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();

    // Submit 2 jobs to a 1-worker pool: one in-flight, one queued
    const p1 = pool.render({ mermaidCode: 'A' });
    const p2 = pool.render({ mermaidCode: 'B' });

    await pool.terminate();

    // Both promises must settle (not hang)
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/terminated/i);
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/terminated/i);
  });

  it('does not start workers when poolSize === 0', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    (Worker as any).mockClear();
    const pool = new MermaidRenderWorkerPool(0, { theme: 'default', backgroundColor: 'white' });
    await pool.start();
    expect(Worker).not.toHaveBeenCalled();
    await pool.terminate();
  });
});
