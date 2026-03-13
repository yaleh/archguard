/**
 * Unit tests for test-coverage-writer.ts
 *
 * Tests generateTestCoverageHeatmap in isolation, with fs-extra and
 * TestCoverageRenderer fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';
import type { ArchJSON } from '@/types/index.js';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock TestCoverageRenderer
vi.mock('@/mermaid/test-coverage-renderer.js', () => ({
  TestCoverageRenderer: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockReturnValue('graph TD\n  A --> B'),
  })),
}));

// Import the module under test AFTER mocks are set up
import { generateTestCoverageHeatmap } from '@/cli/processors/test-coverage-writer.js';
import fs from 'fs-extra';
import { TestCoverageRenderer } from '@/mermaid/test-coverage-renderer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnalysis(): TestAnalysis {
  return {
    version: '1.0',
    patternConfigSource: 'auto',
    testFiles: [],
    coverageMap: [],
    issues: [],
    metrics: {
      totalTestFiles: 0,
      byType: {
        unit: 0,
        integration: 0,
        e2e: 0,
        performance: 0,
        debug: 0,
        unknown: 0,
      },
      entityCoverageRatio: 0,
      assertionDensity: 0,
      skipRatio: 0,
      issueCount: {
        zero_assertion: 0,
        orphan_test: 0,
        skip_accumulation: 0,
        assertion_poverty: 0,
      },
    },
  };
}

function makeArchJson(): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateTestCoverageHeatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock return values after clearAllMocks
    (fs.ensureDir as any).mockResolvedValue(undefined);
    (fs.writeFile as any).mockResolvedValue(undefined);
    const RendererMock = TestCoverageRenderer as any;
    RendererMock.mockImplementation(() => ({
      render: vi.fn().mockReturnValue('graph TD\n  A --> B'),
    }));
  });

  it('calls TestCoverageRenderer.render with correct analysis and archJson args', async () => {
    const analysis = makeAnalysis();
    const archJson = makeArchJson();
    const outputDir = '/out';

    await generateTestCoverageHeatmap(analysis, archJson, outputDir);

    const instance = (TestCoverageRenderer as any).mock.results[0].value;
    expect(instance.render).toHaveBeenCalledOnce();
    expect(instance.render).toHaveBeenCalledWith(analysis, archJson);
  });

  it('writes the file at <outputDir>/test/coverage-heatmap.md', async () => {
    const analysis = makeAnalysis();
    const archJson = makeArchJson();
    const outputDir = '/my/output';

    await generateTestCoverageHeatmap(analysis, archJson, outputDir);

    const expectedPath = '/my/output/test/coverage-heatmap.md';
    expect(fs.writeFile).toHaveBeenCalledWith(expectedPath, expect.any(String), 'utf-8');
  });

  it('file content has "# Test Coverage Heatmap" heading and fenced mermaid block', async () => {
    const analysis = makeAnalysis();
    const archJson = makeArchJson();
    const mermaidCode = 'graph TD\n  A --> B';

    const RendererMock = TestCoverageRenderer as any;
    RendererMock.mockImplementation(() => ({
      render: vi.fn().mockReturnValue(mermaidCode),
    }));

    await generateTestCoverageHeatmap(analysis, archJson, '/out');

    const writtenContent = (fs.writeFile as any).mock.calls[0][1] as string;
    expect(writtenContent).toContain('# Test Coverage Heatmap');
    expect(writtenContent).toContain('```mermaid');
    expect(writtenContent).toContain(mermaidCode);
    expect(writtenContent).toContain('```');
  });

  it('calls fs.ensureDir on <outputDir>/test before writing', async () => {
    const analysis = makeAnalysis();
    const archJson = makeArchJson();
    const outputDir = '/base/dir';

    await generateTestCoverageHeatmap(analysis, archJson, outputDir);

    expect(fs.ensureDir).toHaveBeenCalledWith('/base/dir/test');
    // ensureDir should be called before writeFile
    const ensureDirOrder = (fs.ensureDir as any).mock.invocationCallOrder[0];
    const writeFileOrder = (fs.writeFile as any).mock.invocationCallOrder[0];
    expect(ensureDirOrder).toBeLessThan(writeFileOrder);
  });

  it('does not throw when render returns an empty string', async () => {
    const analysis = makeAnalysis();
    const archJson = makeArchJson();

    const RendererMock = TestCoverageRenderer as any;
    RendererMock.mockImplementation(() => ({
      render: vi.fn().mockReturnValue(''),
    }));

    await expect(generateTestCoverageHeatmap(analysis, archJson, '/out')).resolves.toBeUndefined();
  });
});
