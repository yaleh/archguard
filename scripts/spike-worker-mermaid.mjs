/**
 * Spike: isomorphic-mermaid in Node.js Worker Threads
 *
 * Tests whether isomorphic-mermaid can be instantiated and used to render
 * Mermaid diagrams inside a Worker Thread independently of the main thread.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

// ─── Worker Thread Logic ──────────────────────────────────────────────────────

if (!isMainThread) {
  (async () => {
    try {
      // Step 1: Import isomorphic-mermaid inside the worker
      const { default: mermaid } = await import('isomorphic-mermaid');

      // Step 2: Initialize mermaid
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
      });

      // Step 3: Render a simple diagram
      const diagramCode = workerData?.diagramCode ?? 'graph LR; A --> B';
      const { svg } = await mermaid.render('spike', diagramCode);

      // Step 4: Post result back to main thread
      parentPort.postMessage({
        success: true,
        svgLength: svg.length,
        svgPreview: svg.slice(0, 120),
        threadId: (await import('worker_threads')).threadId,
      });
    } catch (err) {
      parentPort.postMessage({
        success: false,
        error: err?.message ?? String(err),
        stack: err?.stack ?? '',
        code: err?.code ?? '',
      });
    }
  })();
}

// ─── Main Thread Logic ────────────────────────────────────────────────────────

if (isMainThread) {
  console.log('=== isomorphic-mermaid Worker Thread Spike ===\n');
  console.log(`Node.js version : ${process.version}`);
  console.log(`Platform        : ${process.platform}`);
  console.log(`Working dir     : ${process.cwd()}`);
  console.log('');

  const diagramCode = 'graph LR; A --> B';
  console.log(`Diagram code    : "${diagramCode}"`);
  console.log('');
  console.log('Spawning Worker thread...\n');

  const worker = new Worker(__filename, {
    workerData: { diagramCode },
  });

  const timeout = setTimeout(() => {
    console.error('RESULT: FAILURE');
    console.error('Reason: Worker thread timed out after 30 seconds');
    worker.terminate();
    process.exit(1);
  }, 30_000);

  worker.on('message', (msg) => {
    clearTimeout(timeout);

    if (msg.success) {
      console.log('RESULT: SUCCESS');
      console.log('');
      console.log(`  SVG length  : ${msg.svgLength} characters`);
      console.log(`  Worker TID  : ${msg.threadId}`);
      console.log(`  SVG preview : ${msg.svgPreview}...`);
      console.log('');
      console.log('isomorphic-mermaid works inside Node.js Worker Threads.');
      process.exit(0);
    } else {
      console.error('RESULT: FAILURE');
      console.error('');
      console.error(`  Error       : ${msg.error}`);
      if (msg.code) console.error(`  Code        : ${msg.code}`);
      if (msg.stack) {
        console.error('');
        console.error('Stack trace:');
        console.error(msg.stack);
      }
      console.error('');
      console.error('isomorphic-mermaid CANNOT be used inside Node.js Worker Threads.');
      process.exit(1);
    }
  });

  worker.on('error', (err) => {
    clearTimeout(timeout);
    console.error('RESULT: FAILURE');
    console.error('');
    console.error(`  Worker error : ${err.message}`);
    if (err.code) console.error(`  Code         : ${err.code}`);
    console.error('');
    console.error('Stack trace:');
    console.error(err.stack);
    process.exit(1);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      clearTimeout(timeout);
      console.error(`RESULT: FAILURE`);
      console.error(`Worker exited with non-zero code: ${code}`);
      process.exit(1);
    }
  });
}
