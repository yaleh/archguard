import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ArchJSON } from '@/types/index.js';
import type { ParserRuntimeKind } from '@/plugins/shared/syntax-tree.js';
import type { ParserLanguage } from '@/plugins/shared/parser-backend.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';

export type ParseWorkerLanguage = 'typescript' | ParserLanguage;

export interface ParseWorkerInitData {
  language: ParseWorkerLanguage;
  runtime: ParserRuntimeKind;
  workspaceRoot?: string;
}

export interface ParseJob {
  jobId: string;
  kind: 'file';
  code: string;
  filePath: string;
}

export interface ParseProjectJob {
  jobId: string;
  kind: 'project';
  workspaceRoot: string;
  config: ParseConfig;
}

export type ParseWorkerJob = ParseJob | ParseProjectJob;

export interface ParseResult {
  jobId: string;
  success: boolean;
  archJson?: ArchJSON;
  error?: string;
}

const adjacentWorkerFile = fileURLToPath(new URL('./parse-worker.js', import.meta.url));
// Vitest executes source TS while real workers require built JS.
const WORKER_FILE = existsSync(adjacentWorkerFile)
  ? adjacentWorkerFile
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/parser/parse-worker.js');

function sanitizeWorkerExecArgv(execArgv: string[]): string[] {
  return execArgv.filter((argument) => !argument.startsWith('--input-type='));
}

export class ParseWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: ParseWorkerJob[] = [];
  private readonly pending = new Map<string, (result: ParseResult) => void>();
  private readonly inFlight = new Map<Worker, string>();
  private readonly failedWorkers = new WeakSet<Worker>();
  private started = false;
  private terminating = false;
  private dispatched = 0;

  constructor(
    private readonly poolSize: number,
    private readonly initData: ParseWorkerInitData
  ) {
    if (!Number.isInteger(poolSize) || poolSize < 1) {
      throw new Error('Parse worker pool size must be a positive integer');
    }
  }

  get size(): number {
    return this.workers.length;
  }

  get dispatchCount(): number {
    return this.dispatched;
  }

  get workerIds(): readonly number[] {
    return this.workers.map((worker) => worker.threadId);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (let index = 0; index < this.poolSize; index++) this.spawnWorker();
  }

  parseProject(job: Omit<ParseProjectJob, 'jobId'>): Promise<ParseResult> {
    return this.enqueue(job);
  }

  parse(job: Omit<ParseJob, 'jobId' | 'kind'>): Promise<ParseResult> {
    return this.enqueue({ ...job, kind: 'file' });
  }

  private enqueue(job: Omit<ParseWorkerJob, 'jobId'>): Promise<ParseResult> {
    if (this.terminating) {
      return Promise.resolve({ jobId: '', success: false, error: 'Pool terminated' });
    }
    if (!this.started) this.start();
    const fullJob = { ...job, jobId: randomUUID() } as ParseWorkerJob;
    return new Promise((resolve) => {
      this.pending.set(fullJob.jobId, resolve);
      this.dispatch(fullJob);
    });
  }

  async terminate(): Promise<void> {
    if (this.terminating) return;
    this.terminating = true;
    this.drain('Pool terminated');
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers.length = 0;
    this.idle.length = 0;
    this.inFlight.clear();
  }

  private spawnWorker(): void {
    const worker = new Worker(WORKER_FILE, {
      workerData: this.initData,
      execArgv: sanitizeWorkerExecArgv(process.execArgv),
    });
    worker.on('message', (result: ParseResult) => this.onResult(worker, result));
    worker.on('error', (error) => this.onWorkerFailure(worker, error.message));
    worker.on('exit', (code) => {
      if (!this.terminating && code !== 0) {
        this.onWorkerFailure(worker, `Worker exited unexpectedly (code=${code})`);
      }
    });
    this.workers.push(worker);
    this.idle.push(worker);
  }

  private dispatch(job: ParseWorkerJob): void {
    const worker = this.idle.pop();
    if (!worker) {
      this.queue.push(job);
      return;
    }
    this.inFlight.set(worker, job.jobId);
    this.dispatched++;
    worker.postMessage(job);
  }

  private onResult(worker: Worker, result: ParseResult): void {
    this.inFlight.delete(worker);
    const resolve = this.pending.get(result.jobId);
    if (resolve) {
      this.pending.delete(result.jobId);
      resolve(result);
    }
    const next = this.queue.shift();
    if (next) this.dispatchTo(worker, next);
    else this.idle.push(worker);
  }

  private dispatchTo(worker: Worker, job: ParseWorkerJob): void {
    this.inFlight.set(worker, job.jobId);
    this.dispatched++;
    worker.postMessage(job);
  }

  private onWorkerFailure(worker: Worker, message: string): void {
    if (this.failedWorkers.has(worker)) return;
    this.failedWorkers.add(worker);
    const jobId = this.inFlight.get(worker);
    if (jobId) {
      this.inFlight.delete(worker);
      const resolve = this.pending.get(jobId);
      if (resolve) {
        this.pending.delete(jobId);
        resolve({ jobId, success: false, error: message });
      }
    }
    const idleIndex = this.idle.indexOf(worker);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex >= 0) this.workers.splice(workerIndex, 1);
    if (!this.terminating) {
      this.spawnWorker();
      const replacement = this.idle.pop();
      const next = this.queue.shift();
      if (replacement && next) this.dispatchTo(replacement, next);
      else if (replacement) this.idle.push(replacement);
    }
  }

  private drain(error: string): void {
    for (const [jobId, resolve] of this.pending) {
      resolve({ jobId, success: false, error });
    }
    this.pending.clear();
    this.queue.length = 0;
  }
}
