import { vi, describe, it, expect } from 'vitest';
import type { RenderJob, RenderResult } from '@/mermaid/render-worker-pool.js';
import { EventEmitter } from 'events';

// Mock worker_threads at top level
vi.mock('worker_threads', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: EE } = require('events') as { EventEmitter: typeof EventEmitter };
  class MockWorker extends EE {
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(undefined);
  }
  return { Worker: vi.fn(() => new MockWorker()) };
});

// Local type used in tests — mirrors the mock above
class MockWorker extends EventEmitter {
  postMessage = vi.fn();
  terminate = vi.fn().mockResolvedValue(undefined);
}

describe('MermaidRenderWorkerPool', () => {
  it('start() creates poolSize workers', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();
    const pool = new MermaidRenderWorkerPool(3, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();
    expect(Worker).toHaveBeenCalledTimes(3);
    await pool.terminate();
  });

  it('render() dispatches job to idle worker via postMessage', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();
    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    const renderPromise = pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });

    // Simulate worker response
    const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
    const sentJob: RenderJob = workerInstance.postMessage.mock.calls[0]?.[0] as RenderJob;
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
    vi.mocked(Worker).mockClear();
    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    const failPromise = pool.render({ mermaidCode: 'invalid' });

    const worker = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
    const firstCall = worker.postMessage.mock.calls[0]?.[0] as RenderJob;

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
    const secondCall = worker.postMessage.mock.calls[1]?.[0] as RenderJob;
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
    vi.mocked(Worker).mockClear();
    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

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
    vi.mocked(Worker).mockClear();
    const pool = new MermaidRenderWorkerPool(0, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();
    expect(Worker).not.toHaveBeenCalled();
    await pool.terminate();
  });

  it('filters unsupported execArgv flags inherited from wrapper node processes', async () => {
    const originalExecArgv = process.execArgv;
    process.execArgv = ['--input-type=module', '-e', 'console.log("wrapper")'];

    try {
      const { Worker } = await import('worker_threads');
      const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
      vi.mocked(Worker).mockClear();

      const pool = new MermaidRenderWorkerPool(1, {
        theme: 'default',
        maxTextSize: 200000,
        transparentBackground: false,
      });
      pool.start();

      expect(Worker).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          execArgv: ['-e', 'console.log("wrapper")'],
        })
      );

      await pool.terminate();
    } finally {
      process.execArgv = originalExecArgv;
    }
  });

  // --- New tests for Phase B ---

  it('WorkerInitData uses maxTextSize, transparentBackground, themeVariables (no backgroundColor)', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();

    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    expect(Worker).toHaveBeenCalledWith(
      expect.any(String),

      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        workerData: expect.objectContaining({
          maxTextSize: 200000,
          transparentBackground: false,
        }),
      })
    );

    // Ensure backgroundColor is NOT present
    const workerData = vi.mocked(Worker).mock.calls[0]?.[1] as {
      workerData: Record<string, unknown>;
    };
    expect(workerData.workerData).not.toHaveProperty('backgroundColor');

    await pool.terminate();
  });

  it('Worker is created with resourceLimits.maxOldGenerationSizeMb', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();

    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    expect(Worker).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        resourceLimits: { maxOldGenerationSizeMb: 2048 },
      })
    );

    await pool.terminate();
  });

  it('worker crash (exit code != 0) resolves in-flight job with error immediately', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();

    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    // Submit a job (it will be dispatched to the worker)
    const renderPromise = pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });

    // Get the worker instance and simulate crash before it responds
    const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;

    // Simulate worker crash
    workerInstance.emit('exit', 1);

    // The render promise should resolve (not hang) with an error
    const timeoutPromise = new Promise<RenderResult>((resolve) =>
      setTimeout(() => resolve({ jobId: '', success: false, error: 'timeout' }), 1000)
    );

    const result = await Promise.race([renderPromise, timeoutPromise]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exited unexpectedly/i);

    await pool.terminate();
  });

  it('worker crash triggers respawn (replacement worker created)', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();

    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    // Worker constructor was called once
    expect(Worker).toHaveBeenCalledTimes(1);

    // Get the original worker and simulate crash
    const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
    workerInstance.emit('exit', 1);

    // Give microtasks a chance to run
    await Promise.resolve();

    // Worker constructor should have been called a second time (replacement spawned)
    expect(Worker).toHaveBeenCalledTimes(2);

    await pool.terminate();
  });

  it('worker normal exit (code=0) does NOT trigger respawn', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();

    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    // Worker constructor called once
    expect(Worker).toHaveBeenCalledTimes(1);

    // Simulate clean normal exit
    const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
    workerInstance.emit('exit', 0);

    // Give microtasks a chance to run
    await Promise.resolve();

    // Worker constructor should NOT have been called again
    expect(Worker).toHaveBeenCalledTimes(1);

    await pool.terminate();
  });

  it('worker exit after terminate() does NOT trigger respawn', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    vi.mocked(Worker).mockClear();

    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();

    expect(Worker).toHaveBeenCalledTimes(1);

    // Terminate the pool (sets terminating=true), then simulate exit code=1 (as node.js does)
    await pool.terminate();
    const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
    workerInstance.emit('exit', 1);

    await Promise.resolve();

    // Worker constructor should NOT have been called again
    expect(Worker).toHaveBeenCalledTimes(1);
  });
});
