/**
 * Integration tests for CCB documentation signals (meta-cc gate).
 *
 * These tests are skip-gated until meta-cc proposal-doc-session-signals.md ships
 * and query_edit_sequences returns DocVoid/SpecPrecisionGap fields.
 *
 * To un-gate:
 * 1. Confirm meta-cc proposal-doc-session-signals.md has shipped.
 * 2. Remove .skip from both tests below.
 * 3. Run: npm test -- --run tests/integration/cli/cognitive/ccb-doc-integration.test.ts
 * 4. Verify both tests pass, then set TASK-7 status → Basic: Done.
 */

import { describe, it, expect } from 'vitest';

describe('CCB documentation signals integration (meta-cc gate)', () => {
  it.skip('flow-graph-builder.ts CCB has docVoid:true (requires meta-cc gate)', async () => {
    // When meta-cc gate clears: remove .skip and verify
    // const bundle = await assembleCcb(
    //   filePathToId('src/plugins/golang/atlas/flow-graph-builder.ts'),
    //   'src/plugins/golang/atlas/flow-graph-builder.ts',
    //   '.archguard',
    //   { forceRefresh: true }
    // );
    // expect(bundle.documentation?.docVoid).toBe(true);
    expect(true).toBe(false); // Force fail if accidentally un-skipped without meta-cc
  });

  it.skip('flow-graph-builder.ts CCB has cognitiveLoad >= 0.90', async () => {
    // When meta-cc gate clears: remove .skip and verify
    // const bundle = await assembleCcb(...);
    // expect(bundle.guidance?.cognitiveLoad).toBeGreaterThanOrEqual(0.90);
    expect(true).toBe(false); // Force fail if accidentally un-skipped without meta-cc
  });
});
