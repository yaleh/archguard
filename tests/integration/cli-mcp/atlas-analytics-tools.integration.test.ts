/**
 * Phase 120-C integration tests for Atlas Package Analytics MCP tools.
 *
 * Gated on META_CC_ARCH_DIR existing (requires a real Go Atlas project).
 * Uses InMemoryTransport + createMcpServer pattern.
 */
import fs from 'fs-extra';
import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';

const META_CC_ROOT = '/home/yale/work/meta-cc';
const META_CC_ARCH_DIR = `${META_CC_ROOT}/.archguard/query`;

const hasAtlasData = fs.existsSync(META_CC_ARCH_DIR);

describe.skipIf(!hasAtlasData)('Atlas analytics MCP tools — integration (meta-cc Go project)', () => {
  let client: Client;
  let clientTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[0];

  beforeAll(async () => {
    const server = createMcpServer(META_CC_ROOT);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    clientTransport = ct;
    client = new Client({ name: 'integration-test', version: '1.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  it('archguard_get_package_fanin: returns non-empty packages sorted descending by fanIn', async () => {
    const result = await client.callTool({
      name: 'archguard_get_package_fanin',
      arguments: { projectRoot: META_CC_ROOT },
    });
    const text = result.content[0].text as string;
    const parsed = JSON.parse(text);

    expect(Array.isArray(parsed.packages)).toBe(true);
    expect(parsed.packages.length).toBeGreaterThan(0);

    // Each entry must have required fields
    for (const pkg of parsed.packages) {
      expect(pkg).toHaveProperty('id');
      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('fanIn');
      expect(pkg).toHaveProperty('fanOut');
      expect(pkg).toHaveProperty('fileCount');
    }

    // Must be sorted descending by fanIn
    const fanIns = parsed.packages.map((p: { fanIn: number }) => p.fanIn);
    for (let i = 1; i < fanIns.length; i++) {
      expect(fanIns[i]).toBeLessThanOrEqual(fanIns[i - 1]);
    }
  });

  it('archguard_get_package_fanout: returns non-empty packages sorted descending by fanOut', async () => {
    const result = await client.callTool({
      name: 'archguard_get_package_fanout',
      arguments: { projectRoot: META_CC_ROOT },
    });
    const text = result.content[0].text as string;
    const parsed = JSON.parse(text);

    expect(Array.isArray(parsed.packages)).toBe(true);
    expect(parsed.packages.length).toBeGreaterThan(0);

    // Must be sorted descending by fanOut
    const fanOuts = parsed.packages.map((p: { fanOut: number }) => p.fanOut);
    for (let i = 1; i < fanOuts.length; i++) {
      expect(fanOuts[i]).toBeLessThanOrEqual(fanOuts[i - 1]);
    }
  });

  it('archguard_detect_god_packages: returns godPackages array; flagged entries have non-empty reasons', async () => {
    // Use very low thresholds to ensure at least some packages are flagged in meta-cc
    const result = await client.callTool({
      name: 'archguard_detect_god_packages',
      arguments: { projectRoot: META_CC_ROOT, minFanIn: 2, minStructs: 2, minFunctions: 5, minFiles: 2 },
    });
    const text = result.content[0].text as string;
    const parsed = JSON.parse(text);

    expect(Array.isArray(parsed.godPackages)).toBe(true);

    // All entries must have non-empty reasons
    for (const pkg of parsed.godPackages) {
      expect(Array.isArray(pkg.reasons)).toBe(true);
      expect(pkg.reasons.length).toBeGreaterThan(0);
      expect(pkg).toHaveProperty('fanIn');
      expect(pkg).toHaveProperty('fanOut');
      expect(pkg).toHaveProperty('fileCount');
    }
  });
});
