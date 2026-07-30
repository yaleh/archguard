import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const created: FakeWorker[] = [];
class FakeWorker extends EventEmitter {
  constructor(_file: string, _options: unknown) {
    super();
    created.push(this);
  }
  postMessage(): void {}
  terminate(): Promise<number> {
    return Promise.resolve(0);
  }
}
vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

describe('ProcessParseWorkerPools', () => {
  it('reuses an exact language/runtime/workspace pool and bounds threads', async () => {
    const { ProcessParseWorkerPools } = await import('@/parser/process-parse-worker-pools.js');
    const pools = new ProcessParseWorkerPools();
    const first = pools.get({
      language: 'python',
      runtime: 'wasm',
      workspaceRoot: '/tmp/a',
      concurrency: 9,
    });
    const second = pools.get({
      language: 'python',
      runtime: 'wasm',
      workspaceRoot: '/tmp/a',
      concurrency: 9,
    });
    expect(first).toBe(second);
    expect(first.size).toBe(0);
    first.start();
    expect(first.size).toBe(4);
    expect(created).toHaveLength(4);
    expect(pools.size).toBe(1);
    await pools.terminate();
    expect(pools.size).toBe(0);
  });

  it('does not mix parent-selected languages or runtimes', async () => {
    const { ProcessParseWorkerPools } = await import('@/parser/process-parse-worker-pools.js');
    const pools = new ProcessParseWorkerPools();
    const native = pools.get({
      language: 'go',
      runtime: 'native',
      workspaceRoot: '/tmp/a',
      concurrency: 1,
    });
    const wasm = pools.get({
      language: 'go',
      runtime: 'wasm',
      workspaceRoot: '/tmp/a',
      concurrency: 1,
    });
    const python = pools.get({
      language: 'python',
      runtime: 'wasm',
      workspaceRoot: '/tmp/a',
      concurrency: 1,
    });
    expect(new Set([native, wasm, python]).size).toBe(3);
    await pools.terminate();
  });
});
