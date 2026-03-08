import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

export interface WorkerInitData {
  theme: string;
  backgroundColor: string;
}

export interface RenderJob {
  jobId: string;
  mermaidCode: string;
}

export interface RenderResult {
  jobId: string;
  success: boolean;
  svg?: string;
  error?: string;
}

const WORKER_FILE = fileURLToPath(new URL('./render-worker.js', import.meta.url));

function sanitizeWorkerExecArgv(execArgv: string[]): string[] {
  return execArgv.filter((arg) => !arg.startsWith('--input-type='));
}

export class MermaidRenderWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ job: RenderJob }> = [];
  private pending = new Map<string, (r: RenderResult) => void>();

  constructor(
    private readonly poolSize: number,
    private readonly initData: WorkerInitData
  ) {}

  async start(): Promise<void> {
    for (let i = 0; i < this.poolSize; i++) {
      const w = new Worker(WORKER_FILE, {
        workerData: this.initData,
        execArgv: sanitizeWorkerExecArgv(process.execArgv),
      });
      w.on('message', (result: RenderResult) => this.onResult(w, result));
      w.on('error', (err) => {
        console.error(`[render-worker] worker error: ${err.message}`);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  render(job: Omit<RenderJob, 'jobId'>): Promise<RenderResult> {
    const fullJob: RenderJob = { ...job, jobId: randomUUID() };
    return new Promise((resolve) => {
      this.pending.set(fullJob.jobId, resolve);
      this.dispatch(fullJob);
    });
  }

  private dispatch(job: RenderJob): void {
    const worker = this.idle.pop();
    if (worker) {
      worker.postMessage(job);
    } else {
      this.queue.push({ job });
    }
  }

  private onResult(worker: Worker, result: RenderResult): void {
    const resolve = this.pending.get(result.jobId);
    if (resolve) {
      this.pending.delete(result.jobId);
      resolve(result);
    }
    const next = this.queue.shift();
    if (next) {
      worker.postMessage(next.job);
    } else {
      this.idle.push(worker);
    }
  }

  async terminate(): Promise<void> {
    // 1. Terminate all workers in parallel
    await Promise.all(this.workers.map((w) => w.terminate()));

    // 2. Drain queued jobs (not yet dispatched)
    for (const { job } of this.queue) {
      const resolve = this.pending.get(job.jobId);
      if (resolve) {
        this.pending.delete(job.jobId);
        resolve({ jobId: job.jobId, success: false, error: 'Pool terminated' });
      }
    }
    this.queue = [];

    // 3. Drain in-flight jobs (dispatched but no response received)
    for (const [jobId, resolve] of this.pending) {
      resolve({ jobId, success: false, error: 'Pool terminated' });
    }
    this.pending.clear();
  }
}
