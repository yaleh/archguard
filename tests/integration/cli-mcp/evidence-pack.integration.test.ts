/**
 * Integration tests for archguard_get_evidence_pack MCP tool.
 *
 * Uses InMemoryTransport + createMcpServer pattern with tmp fixture dirs.
 */
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';
import type {
  GitHistoryManifest,
  PackageHistoryMetrics,
  FileHistoryMetrics,
} from '@/types/git-history.js';

function makeManifest(): GitHistoryManifest {
  return {
    version: '2',
    generatedAt: '2026-01-01T00:00:00.000Z',
    headRef: 'abc1234',
    analyzedBranch: 'master',
    sinceDays: 90,
    maxCommits: 500,
    totalCommits: 42,
    includeMerges: false,
    granularities: ['package', 'file'],
    packageDepth: 1,
  };
}

function makeRiskFactors() {
  return {
    churn: 0.5,
    authorCount: 0.3,
    ownerConcentration: 0.4,
    cochangeBreadth: 0.2,
    recency: 0.6,
  };
}

function makePackageMetrics(overrides?: Partial<PackageHistoryMetrics>): PackageHistoryMetrics {
  return {
    path: 'src/cli',
    commitCount: 30,
    activeDays: 20,
    addedLines: 500,
    deletedLines: 100,
    authorCount: 2,
    primaryOwner: 'dev@example.com',
    primaryOwnerShare: 0.8,
    lastChangedAt: '2026-01-01',
    topCochangeNeighbors: [],
    riskFactors: makeRiskFactors(),
    ...overrides,
  };
}

function makeFileMetrics(overrides?: Partial<FileHistoryMetrics>): FileHistoryMetrics {
  return {
    path: 'src/cli/index.ts',
    packagePath: 'src/cli',
    commitCount: 15,
    activeDays: 10,
    addedLines: 200,
    deletedLines: 40,
    authorCount: 2,
    primaryOwner: 'dev@example.com',
    primaryOwnerShare: 0.75,
    lastChangedAt: '2026-01-01',
    topCochangeNeighbors: [],
    riskFactors: makeRiskFactors(),
    ...overrides,
  };
}

describe('archguard_get_evidence_pack — integration', () => {
  let tmpRoot: string;
  let client: Client;

  beforeAll(async () => {
    tmpRoot = path.join(
      os.tmpdir(),
      `archguard-evidence-pack-test-${Math.floor(Math.random() * 1e9)}`
    );
    const historyDir = path.join(tmpRoot, '.archguard', 'query', 'git-history');
    await fs.mkdirp(historyDir);

    await fs.writeJson(path.join(historyDir, 'manifest.json'), makeManifest(), { spaces: 2 });
    await fs.writeJson(path.join(historyDir, 'package-metrics.json'), [makePackageMetrics()], {
      spaces: 2,
    });
    await fs.writeJson(path.join(historyDir, 'file-metrics.json'), [makeFileMetrics()], {
      spaces: 2,
    });

    const server = createMcpServer(tmpRoot);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'evidence-pack-test', version: '1.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await fs.remove(tmpRoot);
  });

  it('file target: response contains ## Evidence Pack header', async () => {
    const result = await client.callTool({
      name: 'archguard_get_evidence_pack',
      arguments: {
        projectRoot: tmpRoot,
        targets: [{ targetType: 'file', target: 'src/cli/index.ts' }],
      },
    });
    const text = result.content[0].text as string;
    expect(text).toContain('## Evidence Pack');
  });

  it('package target: response contains riskScore, riskLevel, topFactor in JSON block', async () => {
    const result = await client.callTool({
      name: 'archguard_get_evidence_pack',
      arguments: {
        projectRoot: tmpRoot,
        targets: [{ targetType: 'package', target: 'src/cli' }],
      },
    });
    const text = result.content[0].text as string;

    // Extract JSON block
    const jsonMatch = text.match(/```json\n([\s\S]+?)```/);
    expect(jsonMatch).not.toBeNull();
    const pack = JSON.parse(jsonMatch[1]);
    expect(pack).toHaveProperty('results');
    expect(Array.isArray(pack.results)).toBe(true);
    if (pack.results.length > 0) {
      const entry = pack.results[0];
      expect(entry).toHaveProperty('riskScore');
      expect(entry).toHaveProperty('riskLevel');
      expect(entry).toHaveProperty('topFactor');
    }
  });

  it('response contains ## Hotspots section', async () => {
    const result = await client.callTool({
      name: 'archguard_get_evidence_pack',
      arguments: {
        projectRoot: tmpRoot,
        targets: [{ targetType: 'file', target: 'src/cli/index.ts' }],
      },
    });
    const text = result.content[0].text as string;
    expect(text).toContain('## Hotspots');
  });

  it('unknown target: response contains ## Not Found section', async () => {
    const result = await client.callTool({
      name: 'archguard_get_evidence_pack',
      arguments: {
        projectRoot: tmpRoot,
        targets: [{ targetType: 'file', target: 'src/nonexistent/file.ts' }],
      },
    });
    const text = result.content[0].text as string;
    expect(text).toContain('## Not Found');
  });

  it('no git history data: response contains archguard_analyze_git prompt', async () => {
    const emptyRoot = path.join(
      os.tmpdir(),
      `archguard-evidence-pack-empty-${Math.floor(Math.random() * 1e9)}`
    );
    await fs.mkdirp(emptyRoot);

    try {
      const server2 = createMcpServer(emptyRoot);
      const [ct2, st2] = InMemoryTransport.createLinkedPair();
      const client2 = new Client({ name: 'evidence-pack-empty-test', version: '1.0.0' });
      await Promise.all([server2.connect(st2), client2.connect(ct2)]);

      const result = await client2.callTool({
        name: 'archguard_get_evidence_pack',
        arguments: {
          projectRoot: emptyRoot,
          targets: [{ targetType: 'file', target: 'src/anything.ts' }],
        },
      });
      const text = result.content[0].text as string;
      expect(text).toContain('archguard_analyze_git');
    } finally {
      await fs.remove(emptyRoot);
    }
  });
});
