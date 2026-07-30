import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workers: FakeWorker[] = [];

class FakeWorker extends EventEmitter {
  readonly posted: unknown[] = [];
  terminated = false;
  constructor(
    _file: string,
    readonly options: unknown
  ) {
    super();
    workers.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  async terminate(): Promise<number> {
    this.terminated = true;
    this.emit('exit', 1);
    return 1;
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

describe('ParseWorkerPool', () => {
  beforeEach(() => workers.splice(0));

  it('bounds workers and propagates the parent-selected runtime', async () => {
    const { ParseWorkerPool } = await import('@/parser/parse-worker-pool.js');
    const pool = new ParseWorkerPool(2, { language: 'python', runtime: 'wasm' });
    pool.start();
    expect(workers).toHaveLength(2);
    expect(workers[0].options).toMatchObject({
      workerData: { language: 'python', runtime: 'wasm' },
    });
    await pool.terminate();
  });

  it('queues work, returns results, and drains on termination', async () => {
    const { ParseWorkerPool } = await import('@/parser/parse-worker-pool.js');
    const pool = new ParseWorkerPool(1, { language: 'typescript', runtime: 'native' });
    pool.start();
    const first = pool.parse({ code: 'const a = 1', filePath: 'a.ts' });
    const second = pool.parse({ code: 'const b = 2', filePath: 'b.ts' });
    const firstJob = workers[0].posted[0] as { jobId: string };
    workers[0].emit('message', {
      jobId: firstJob.jobId,
      success: true,
      archJson: { entities: [] },
    });
    await expect(first).resolves.toMatchObject({ success: true });
    expect(workers[0].posted).toHaveLength(2);
    await pool.terminate();
    await expect(second).resolves.toMatchObject({ success: false, error: 'Pool terminated' });
  });
});
