import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '@/cli/mcp/mcp-server';
import { workflowDependentMcpTools } from '@/cli/metadata';

interface ListedTool {
  name: string;
  description?: string;
}

async function listToolsFromMcpServer(): Promise<ListedTool[]> {
  const server = createMcpServer('/workspace');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-agent-descriptions-e2e', version: '1.0.0' });

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.listTools();
    return result.tools;
  } finally {
    await clientTransport.close();
    await server.close();
  }
}

describe('MCP agent descriptions E2E', () => {
  it('exposes call-first and recovery guidance on workflow-dependent tools', async () => {
    const tools = await listToolsFromMcpServer();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const toolName of workflowDependentMcpTools) {
      const description = byName.get(toolName)?.description ?? '';

      expect(description, toolName).toContain('Use when:');
      expect(description, toolName).toContain('Call first:');
      expect(description, toolName).toContain('Recovery:');
    }
  });

  it('gives agents category-specific prerequisites for query, test, git, and Atlas workflows', async () => {
    const tools = await listToolsFromMcpServer();
    const byName = new Map(tools.map((tool) => [tool.name, tool.description ?? '']));

    expect(byName.get('archguard_summary')).toContain('Call first: archguard_analyze');
    expect(byName.get('archguard_get_test_metrics')).toContain(
      'Call first: archguard_analyze, archguard_detect_test_patterns'
    );
    expect(byName.get('archguard_get_change_context')).toContain(
      'Call first: archguard_analyze_git'
    );
    expect(byName.get('archguard_get_package_fanin')).toContain('Call first: archguard_analyze');
  });
});
