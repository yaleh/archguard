import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server';
import { mcpParamDescription, mcpToolDescription } from '@/cli/mcp/metadata';
import {
  archGuardMetadataRegistry,
  mcpToolBaseline,
  workflowDependentMcpTools,
} from '@/cli/metadata';

interface ToolShape {
  name: string;
  description?: string;
  inputSchema: {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
}

async function listRegisteredTools(): Promise<ToolShape[]> {
  const server = createMcpServer('/workspace');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'metadata-test', version: '1.0.0' });

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.listTools();
    return result.tools;
  } finally {
    await clientTransport.close();
    await server.close();
  }
}

function schemaShape(tool: ToolShape): { fields: string[]; required: string[] } {
  return {
    fields: Object.keys(tool.inputSchema.properties ?? {}).sort(),
    required: [...(tool.inputSchema.required ?? [])].sort(),
  };
}

describe('MCP metadata drift', () => {
  it('renders registry-derived descriptions for all MCP tools', () => {
    for (const toolName of mcpToolBaseline) {
      const description = mcpToolDescription(toolName);

      expect(description, toolName).toContain('Use when:');
      expect(description, toolName).toContain('Recovery:');
      expect(description.length, toolName).toBeGreaterThan(40);
      expect(description.length, toolName).toBeLessThan(900);
      expect(description, toolName).not.toMatch(/when (return|analyze|detect|find|list|get)\b/i);
    }
  });

  it('renders call-first guidance for every workflow-dependent MCP tool', () => {
    for (const toolName of workflowDependentMcpTools) {
      const description = mcpToolDescription(toolName);

      expect(description, toolName).toContain('Call first:');
      expect(description, toolName).toContain('Recovery:');
      expect(description, toolName).not.toContain(' first. Use when:');
    }
  });

  it('preserves high-value agent guidance from the registry in MCP descriptions', () => {
    expect(mcpToolDescription('archguard_summary')).toContain(
      'do not enumerate other tool outputs to count manually'
    );
    expect(mcpToolDescription('archguard_get_dependencies')).toContain(
      'Call graph edges are not included'
    );
    expect(mcpToolDescription('archguard_get_dependencies')).toContain(
      'prefer archguard_get_atlas_layer'
    );
    expect(mcpToolDescription('archguard_find_callers')).toContain(
      'TypeScript about 85%, Go about 90%, Java about 60%, Python about 40%'
    );
    expect(mcpToolDescription('archguard_analyze')).toContain(
      'Use the lang parameter to override code-language plugin detection'
    );
  });

  it('exposes the same 24 tool names over in-process MCP listTools', async () => {
    const tools = await listRegisteredTools();

    expect(new Set(tools.map((tool) => tool.name))).toEqual(new Set(mcpToolBaseline));
    expect(tools).toHaveLength(24);
  });

  it('keeps in-process MCP descriptions aligned with registry renderer', async () => {
    const tools = await listRegisteredTools();

    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(mcpToolDescription(tool.name));
    }
  });

  it('keeps exposed schema field names aligned with registry parameter metadata', async () => {
    const tools = await listRegisteredTools();
    const metadataByTool = new Map(
      archGuardMetadataRegistry.mcpTools.map((tool) => [tool.mcp.toolName, tool])
    );

    for (const tool of tools) {
      const metadata = metadataByTool.get(tool.name);
      expect(metadata, tool.name).toBeDefined();

      const exposed = schemaShape(tool).fields;
      const documented = metadata!.mcp.parameters.map((param) => param.name).sort();
      expect(exposed, tool.name).toEqual(documented);
    }
  });

  it('keeps exposed schema required fields aligned with registry parameter metadata', async () => {
    const tools = await listRegisteredTools();
    const metadataByTool = new Map(
      archGuardMetadataRegistry.mcpTools.map((tool) => [tool.mcp.toolName, tool])
    );
    const mismatches: string[] = [];

    for (const tool of tools) {
      const metadata = metadataByTool.get(tool.name);
      expect(metadata, tool.name).toBeDefined();

      const exposed = schemaShape(tool).required;
      const documented = metadata!.mcp.parameters
        .filter((parameter) => parameter.required)
        .map((parameter) => parameter.name)
        .sort();
      if (JSON.stringify(exposed) !== JSON.stringify(documented)) {
        mismatches.push(
          `${tool.name}\n  exposed required: ${exposed.join(',') || 'none'}\n  registry required: ${documented.join(',') || 'none'}`
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('keeps exposed schema parameter descriptions aligned with registry metadata', async () => {
    const tools = await listRegisteredTools();
    const metadataByTool = new Map(
      archGuardMetadataRegistry.mcpTools.map((tool) => [tool.mcp.toolName, tool])
    );
    const mismatches: string[] = [];

    for (const tool of tools) {
      const metadata = metadataByTool.get(tool.name);
      expect(metadata, tool.name).toBeDefined();
      const documentedByParam = new Map(
        metadata!.mcp.parameters.map((parameter) => [parameter.name, parameter.description])
      );

      for (const [field, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        const expected = documentedByParam.get(field);
        if (schema.description !== expected) {
          mismatches.push(
            `${tool.name}.${field}\n  exposed: ${schema.description}\n  registry: ${expected}`
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('can read registry parameter descriptions through the MCP helper', () => {
    expect(mcpParamDescription('archguard_summary', 'projectRoot')).toContain('Root directory');
    expect(mcpParamDescription('archguard_get_change_context', 'targetType')).toContain('file');
    expect(() => mcpParamDescription('archguard_summary', 'missing')).toThrow(
      'Missing MCP metadata parameter'
    );
  });
});
