/**
 * Integration test for Plan-33: Go import dependency edges
 *
 * Verifies that parseToRawData populates moduleName from go.mod and that
 * passing rawData.moduleName to mapRelations produces correct dependency
 * relations for cross-package imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoPlugin } from '../../../src/plugins/golang/index.js';
import { ArchJsonMapper } from '../../../src/plugins/golang/archjson-mapper.js';

// Mock glob at the module level
vi.mock('glob', () => ({
  glob: vi.fn(),
}));

// Mock fs-extra so no real filesystem access occurs
vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn(),
  },
}));

const WS = '/fake/goroot';

describe('GoPlugin - dependency edges via parseToRawData pipeline', () => {
  let plugin: GoPlugin;

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = new GoPlugin();
    await plugin.initialize({ workspaceRoot: WS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parseToRawData returns moduleName from go.mod', async () => {
    const { glob } = await import('glob');
    const fs = await import('fs-extra');

    const apiFile = `${WS}/internal/api/handler.go`;
    const svcFile = `${WS}/internal/svc/service.go`;
    const goModPath = `${WS}/go.mod`;

    vi.mocked(glob).mockResolvedValue([apiFile, svcFile] as never);
    vi.mocked(fs.default.existsSync).mockImplementation((p) => p === goModPath);
    vi.mocked(fs.default.readFile).mockImplementation(async (p) => {
      if (p === goModPath) return 'module github.com/org/app\n\ngo 1.21\n';
      if (p === apiFile) return `package api\nimport "github.com/org/app/internal/svc"\n`;
      return `package svc\n`;
    });

    const rawData = await plugin.parseToRawData(WS, { workspaceRoot: WS });

    // moduleName must be populated from go.mod
    expect(rawData.moduleName).toBe('github.com/org/app');
  });

  it('mapRelations with rawData.moduleName emits dependency relation for cross-package import', async () => {
    const { glob } = await import('glob');
    const fs = await import('fs-extra');

    const apiFile = `${WS}/internal/api/handler.go`;
    const svcFile = `${WS}/internal/svc/service.go`;
    const goModPath = `${WS}/go.mod`;

    vi.mocked(glob).mockResolvedValue([apiFile, svcFile] as never);
    vi.mocked(fs.default.existsSync).mockImplementation((p) => p === goModPath);
    vi.mocked(fs.default.readFile).mockImplementation(async (p) => {
      if (p === goModPath) return 'module github.com/org/app\n\ngo 1.21\n';
      if (p === apiFile) return `package api\nimport "github.com/org/app/internal/svc"\n`;
      return `package svc\n`;
    });

    const rawData = await plugin.parseToRawData(WS, { workspaceRoot: WS });

    expect(rawData.moduleName).toBe('github.com/org/app');

    // Wire up the same way parseProject does (after Stage 2.1)
    const mapper = new ArchJsonMapper();
    const relations = mapper.mapRelations(rawData.packages, [], rawData.moduleName);

    const depRel = relations.find((r) => r.type === 'dependency');
    expect(depRel).toBeDefined();
    expect(depRel.source).toBe('internal/api');
    expect(depRel.target).toBe('internal/svc');
  });
});
