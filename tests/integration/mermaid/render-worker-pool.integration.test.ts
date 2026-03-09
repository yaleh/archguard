import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerFile = path.resolve(__dirname, '../../../dist/mermaid/render-worker.js');

const hasBuilt = existsSync(workerFile);
// Under Vitest, import.meta.url in render-worker-pool.ts resolves to the TS source tree,
// so the Worker spawns from src/mermaid/render-worker.js (missing) rather than dist/.
// Opt-in via ARCH_TEST_WORKERS=true to run this test after a manual build.
const runIntegration = hasBuilt && process.env.ARCH_TEST_WORKERS === 'true';

describe.skipIf(!runIntegration)('MermaidRenderWorkerPool integration (real workers)', () => {
  it('renders a simple diagram via worker thread', async () => {
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    const pool = new MermaidRenderWorkerPool(1, {
      theme: 'default',
      maxTextSize: 200000,
      transparentBackground: false,
    });
    pool.start();
    try {
      const result = await pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });
      expect(result.success).toBe(true);
      expect(result.svg).toMatch(/<svg/);
    } finally {
      await pool.terminate();
    }
  }, 30000);
});
