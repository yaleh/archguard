import { workerData, parentPort } from 'worker_threads';
import mermaid from 'isomorphic-mermaid';
import type { WorkerInitData, RenderJob, RenderResult } from './render-worker-pool.js';

const initData = workerData as WorkerInitData;

mermaid.initialize({
  startOnLoad: false,
  theme: (initData.theme ?? 'default') as any,
  securityLevel: 'loose',
});

parentPort!.on('message', async (job: RenderJob) => {
  try {
    const { svg } = await mermaid.render(job.jobId, job.mermaidCode);
    parentPort!.postMessage({ jobId: job.jobId, success: true, svg } satisfies RenderResult);
  } catch (e) {
    parentPort!.postMessage({
      jobId: job.jobId,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies RenderResult);
  }
});
