/**
 * Phase 107 — Integration test: Go MCP server fixture
 *
 * Verifies that the Atlas Flow layer correctly detects MCP server entry points
 * registered via github.com/mark3labs/mcp-go's AddTool API.
 *
 * This test uses real tree-sitter parsing on the fixture files but mocks:
 * - goModResolver (to avoid requiring real go module downloads)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { GoPlugin } from '../../../src/plugins/golang/index.js';

const FIXTURE_PATH = path.resolve('tests/fixtures/go-mcp-server');

describe('Go MCP server — Atlas Flow integration', () => {
  let plugin: GoPlugin;

  beforeEach(async () => {
    plugin = new GoPlugin();
    await plugin.initialize({ workspaceRoot: FIXTURE_PATH });

    // The fixture has a real go.mod; let the resolver read it normally.
    // We don't need to mock - the go.mod contains the mcp-go require.
    // No network access needed: tree-sitter parses AST without downloading modules.
  });

  it('detects 2 AddTool calls as mcp entry points', async () => {
    const result = await plugin.parseProject(FIXTURE_PATH, {
      languageSpecific: { atlas: { excludeTests: false } },
    });

    const atlas = (result as any).extensions?.goAtlas;
    expect(atlas).toBeDefined();
    expect(atlas.layers.flow).toBeDefined();

    const mcpEntries = atlas.layers.flow.entryPoints.filter(
      (e: any) => e.protocol === 'mcp'
    );
    expect(mcpEntries).toHaveLength(2);
  });

  it('entry points have framework: mcp-go', async () => {
    const result = await plugin.parseProject(FIXTURE_PATH, {
      languageSpecific: { atlas: { excludeTests: false } },
    });

    const flow = (result as any).extensions?.goAtlas?.layers?.flow;
    const mcpEntries = flow?.entryPoints?.filter((e: any) => e.protocol === 'mcp') ?? [];

    expect(mcpEntries.every((e: any) => e.framework === 'mcp-go')).toBe(true);
  });

  it('entry point handlers reference the handler functions', async () => {
    const result = await plugin.parseProject(FIXTURE_PATH, {
      languageSpecific: { atlas: { excludeTests: false } },
    });

    const flow = (result as any).extensions?.goAtlas?.layers?.flow;
    const handlers = flow?.entryPoints
      ?.filter((e: any) => e.protocol === 'mcp')
      .map((e: any) => e.handler) ?? [];

    expect(handlers).toContain('listFilesHandler');
    expect(handlers).toContain('readFileHandler');
  });

  it('call chains are built for detected entry points', async () => {
    const result = await plugin.parseProject(FIXTURE_PATH, {
      languageSpecific: { atlas: { excludeTests: false } },
    });

    const flow = (result as any).extensions?.goAtlas?.layers?.flow;
    const mcpChains = flow?.callChains?.filter((c: any) =>
      flow.entryPoints.find(
        (e: any) => e.id === c.entryPoint && e.protocol === 'mcp'
      )
    ) ?? [];

    expect(mcpChains).toHaveLength(2);
  });
});
