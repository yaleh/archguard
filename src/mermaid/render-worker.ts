import { workerData, parentPort } from 'worker_threads';
import mermaid from 'isomorphic-mermaid';
import { postProcessSVG } from './post-process-svg.js';
import type { WorkerInitData, RenderJob, RenderResult } from './render-worker-pool.js';

const initData = workerData as WorkerInitData;

mermaid.initialize({
  startOnLoad: false,
  theme: (initData.theme ?? 'default') as
    | 'default'
    | 'base'
    | 'dark'
    | 'forest'
    | 'neutral'
    | 'null',
  securityLevel: 'loose',
  maxTextSize: initData.maxTextSize ?? 200000,
  themeVariables: initData.themeVariables,
});

const handleMessage = async (job: RenderJob): Promise<void> => {
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
};

parentPort.on('message', (job: RenderJob) => {
  handleMessage(job).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    parentPort.postMessage({
      jobId: job.jobId,
      success: false,
      error: `Worker unhandled: ${msg}`,
    } satisfies RenderResult);
  });
});
