import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  archGuardMetadataRegistry,
  cliCommandBaseline,
  getMcpToolMetadata,
  mcpToolBaseline,
  queryOptions,
  validateMetadataRegistry,
  workflowDependentMcpTools,
  type ArchGuardMetadataRegistry,
} from '@/cli/metadata';

describe('ArchGuard command metadata registry', () => {
  it('covers the exact CLI command baseline', () => {
    expect(archGuardMetadataRegistry.cliCommands.map((command) => command.cli.command)).toEqual([
      ...cliCommandBaseline,
    ]);
    expect(archGuardMetadataRegistry.cliCommands).toHaveLength(7);
  });

  it('covers the exact MCP tool baseline', () => {
    expect(archGuardMetadataRegistry.mcpTools.map((tool) => tool.mcp.toolName)).toEqual([
      ...mcpToolBaseline,
    ]);
    expect(archGuardMetadataRegistry.mcpTools).toHaveLength(24);
  });

  it('passes registry validation', () => {
    expect(validateMetadataRegistry()).toEqual([]);
  });

  it('records ADR-007 query mappings plus analysis equivalents', () => {
    const mappings = new Map(
      archGuardMetadataRegistry.queryMappings.map((mapping) => [
        mapping.mcpTool,
        mapping.cliEquivalent,
      ])
    );

    expect(mappings.size).toBe(24);
    expect(mappings.get('archguard_summary')).toBe('archguard query --summary');
    expect(mappings.get('archguard_find_callers')).toBe('archguard query --callers <entity>');
    expect(mappings.get('archguard_get_ownership')).toBe('archguard query --ownership <path>');
    expect(mappings.get('archguard_analyze')).toBe('archguard analyze');
    expect(mappings.get('archguard_analyze_git')).toBe('archguard analyze --include-git');
  });

  it('keeps query option MCP mappings aligned with registered MCP tools', () => {
    const toolNames = new Set(archGuardMetadataRegistry.mcpTools.map((tool) => tool.mcp.toolName));
    for (const option of queryOptions.filter((item) => item.mapsToMcpTool)) {
      expect(toolNames.has(option.mapsToMcpTool!)).toBe(true);
    }
  });

  it('provides agent guidance and concrete verification hints for every entry', () => {
    const entries = [
      ...archGuardMetadataRegistry.cliCommands,
      ...archGuardMetadataRegistry.mcpTools,
    ];

    for (const entry of entries) {
      expect(entry.summary.trim(), entry.id).not.toBe('');
      expect(entry.agent.useWhen.length, entry.id).toBeGreaterThan(0);
      expect(entry.agent.failureRecovery.length, entry.id).toBeGreaterThan(0);
      expect(entry.agent.limitations.length, entry.id).toBeGreaterThan(0);
      expect(entry.examples.length, entry.id).toBeGreaterThan(0);
      expect(entry.verification.length, entry.id).toBeGreaterThan(0);
      for (const hint of entry.verification) {
        expect(
          /^(npm |node |archguard |tests\/)/.test(hint.target),
          `${entry.id}: ${hint.target}`
        ).toBe(true);
      }
    }
  });

  it('enumerates callFirst guidance for every workflow-dependent tool', () => {
    for (const toolName of workflowDependentMcpTools) {
      const tool = getMcpToolMetadata(toolName);
      expect(tool, toolName).toBeDefined();
      expect(tool?.agent.callFirst?.length, toolName).toBeGreaterThan(0);
    }

    expect(getMcpToolMetadata('archguard_summary')?.agent.callFirst).toContain('archguard_analyze');
    expect(getMcpToolMetadata('archguard_get_test_metrics')?.agent.callFirst).toEqual([
      'archguard_analyze',
      'archguard_detect_test_patterns',
    ]);
    expect(getMcpToolMetadata('archguard_get_change_context')?.agent.callFirst).toEqual([
      'archguard_analyze_git',
    ]);
    expect(getMcpToolMetadata('archguard_get_package_fanin')?.agent.callFirst).toEqual([
      'archguard_analyze',
    ]);
  });

  it('fails validation when expected baseline metadata is missing', () => {
    const broken: ArchGuardMetadataRegistry = {
      ...archGuardMetadataRegistry,
      mcpTools: archGuardMetadataRegistry.mcpTools.filter(
        (tool) => tool.mcp.toolName !== 'archguard_summary'
      ),
    };

    expect(validateMetadataRegistry(broken)).toContain('Missing MCP tool: archguard_summary');
  });

  it('fails validation for unknown callFirst references', () => {
    const broken: ArchGuardMetadataRegistry = {
      ...archGuardMetadataRegistry,
      mcpTools: archGuardMetadataRegistry.mcpTools.map((tool) =>
        tool.mcp.toolName === 'archguard_summary'
          ? { ...tool, agent: { ...tool.agent, callFirst: ['archguard_missing'] } }
          : tool
      ),
    };

    expect(validateMetadataRegistry(broken)).toContain(
      'archguard_summary callFirst references unknown target: archguard_missing'
    );
  });

  it('does not import Commander or MCP SDK runtime modules', async () => {
    const registryModule = await import('@/cli/metadata');
    expect(registryModule).toHaveProperty('archGuardMetadataRegistry');

    const metadataDir = path.join(process.cwd(), 'src/cli/metadata');
    const sources = fs
      .readdirSync(metadataDir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(path.join(metadataDir, file), 'utf-8'))
      .join('\n');

    expect(sources).not.toContain('commander');
    expect(sources).not.toContain('@modelcontextprotocol');
  });
});
