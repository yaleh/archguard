import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerFile = path.resolve(__dirname, '../../../dist/mermaid/render-worker.js');

const hasBuilt = existsSync(workerFile);

describe.skipIf(!hasBuilt)('MermaidRenderWorkerPool integration (real workers)', () => {
  it('renders a simple diagram via worker thread', async () => {
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();
    try {
      const result = await pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });
      expect(result.success).toBe(true);
      expect(result.svg).toMatch(/<svg/);
    } finally {
      await pool.terminate();
    }
  }, 30000);
});
