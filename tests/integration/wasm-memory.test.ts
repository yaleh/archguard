/**
 * Integration: repeated WASM parses in one long-lived process must not show
 * unbounded heap growth (trees/parsers are disposed explicitly).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';

const fixture = path.resolve(__dirname, '../fixtures/go/sample.go');

describe('WASM backend memory bounds', () => {
  it('repeated parse/dispose cycles do not grow memory unboundedly', async () => {
    const code = readFileSync(fixture, 'utf8');
    const session = await wasmParserBackend.createSession('go');

    const rss = () => process.memoryUsage().rss;
    const parseOnce = () => {
      const tree = session.parse(code);
      tree.dispose();
    };

    try {
      // Warm-up: grammar/runtime allocations and JIT settle here.
      for (let i = 0; i < 20; i++) parseOnce();
      globalThis.gc?.();
      const baseline = rss();

      for (let i = 0; i < 200; i++) parseOnce();
      globalThis.gc?.();
      const growth = rss() - baseline;

      // Generous bound to avoid flake; an undisposed tree leak of this fixture
      // size would grow by tens of MB per dozen iterations.
      expect(growth).toBeLessThan(64 * 1024 * 1024);
    } finally {
      session.dispose();
    }
  }, 120_000);
});
