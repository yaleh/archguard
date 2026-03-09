import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

export interface WorkerInitData {
  theme: string;
  maxTextSize: number;
  transparentBackground: boolean;
  themeVariables?: Record<string, string>;
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
  private workerInFlight = new Map<Worker, string>(); // worker → jobId
  private workerRestarts = new Map<Worker, number>(); // restart count per slot
  private terminating = false;
  private readonly MAX_RESTARTS = 3;

  constructor(
    private readonly poolSize: number,
    private readonly initData: WorkerInitData
  ) {}

  private spawnWorker(): Worker {
    const w = new Worker(WORKER_FILE, {
      workerData: this.initData,
      execArgv: sanitizeWorkerExecArgv(process.execArgv),
      resourceLimits: { maxOldGenerationSizeMb: 2048 },
    });
    w.on('message', (result: RenderResult) => this.onResult(w, result));
    w.on('error', (err) => {
      console.error(`[render-worker] worker error: ${err.message}`);
    });
    w.on('exit', (code) => this.onWorkerExit(w, code));
    this.idle.push(w);
    return w;
  }

  start(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this.spawnWorker());
    }
  }

  private onWorkerExit(w: Worker, code: number): void {
    if (code === 0 || this.terminating) return; // Normal/intentional exit

    // Resolve in-flight job immediately to prevent Promise hanging
    const jobId = this.workerInFlight.get(w);
    if (jobId) {
      const resolve = this.pending.get(jobId);
      if (resolve) {
        this.pending.delete(jobId);
        resolve({ jobId, success: false, error: `Worker exited unexpectedly (code=${code})` });
      }
      this.workerInFlight.delete(w);
    }

    // Remove from idle if present
    const idleIdx = this.idle.indexOf(w);
    if (idleIdx !== -1) this.idle.splice(idleIdx, 1);

    // Respawn (up to MAX_RESTARTS)
    const restarts = this.workerRestarts.get(w) ?? 0;
    if (restarts < this.MAX_RESTARTS) {
      console.warn(
        `[render-worker] worker exited (code=${code}), respawning (${restarts + 1}/${this.MAX_RESTARTS})`
      );
      const replacement = this.spawnWorker();
      this.workerRestarts.set(replacement, restarts + 1);
      const idx = this.workers.indexOf(w);
      if (idx !== -1) this.workers[idx] = replacement;
    } else {
      console.error(
        `[render-worker] worker reached max restarts (${this.MAX_RESTARTS}), not respawning`
      );
      const idx = this.workers.indexOf(w);
      if (idx !== -1) this.workers.splice(idx, 1);
    }
    this.workerRestarts.delete(w);
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
      this.workerInFlight.set(worker, job.jobId);
      worker.postMessage(job);
    } else {
      this.queue.push({ job });
    }
  }

  private onResult(worker: Worker, result: RenderResult): void {
    this.workerInFlight.delete(worker);
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

  async terminate(): Promise<void> {
    this.terminating = true;
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
