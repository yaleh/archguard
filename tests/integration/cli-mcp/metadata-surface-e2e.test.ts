import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server';
import {
  archGuardMetadataRegistry,
  cliCommandBaseline,
  mcpToolBaseline,
  workflowDependentMcpTools,
} from '@/cli/metadata';
import {
  metadataDocsBlocks,
  renderMetadataDocsBlock,
  replaceMetadataDocsBlock,
  type MetadataDocsBlockId,
} from '@/cli/metadata/docs-renderer';

interface ListedTool {
  name: string;
  description?: string;
}

const builtCliPath = path.resolve(process.cwd(), 'dist/cli/index.js');
const describeIfBuilt = fs.existsSync(builtCliPath) ? describe : describe.skip;

describeIfBuilt('metadata surface E2E', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.remove(dir);
    }
    tmpDirs.length = 0;
  });

  it('aligns registry data across CLI structured help, MCP metadata, and docs blocks', async () => {
    const cliHelp = JSON.parse(
      (await execa('node', [builtCliPath, 'help', '--json'], { cwd: process.cwd() })).stdout
    );
    const mcpTools = await listToolsFromMcpServer();
    const docsCheck = await execa('npm', ['run', 'docs:check'], { cwd: process.cwd() });

    expect(docsCheck.stdout).toContain('Metadata docs are up to date.');
    expect(cliHelp.commands.map((command: any) => command.name)).toEqual([...cliCommandBaseline]);
    expect(mcpTools.map((tool) => tool.name).sort()).toEqual([...mcpToolBaseline].sort());

    const cliMappedTools = new Set(
      cliHelp.commands.flatMap((command: any) =>
        command.options
          .map((option: any) => option.mapsToMcpTool)
          .filter((toolName: string | undefined) => toolName)
      )
    );
    for (const mapping of archGuardMetadataRegistry.queryMappings) {
      if (mapping.kind === 'query') {
        expect(cliMappedTools.has(mapping.mcpTool), mapping.mcpTool).toBe(true);
      }
    }

    const mcpToolNames = new Set(mcpTools.map((tool) => tool.name));
    for (const mapping of archGuardMetadataRegistry.queryMappings) {
      expect(mcpToolNames.has(mapping.mcpTool), mapping.mcpTool).toBe(true);
      expect(mapping.cliEquivalent, mapping.mcpTool).toMatch(/^archguard /);
    }
    expect(
      archGuardMetadataRegistry.queryMappings.find(
        (mapping) => mapping.mcpTool === 'archguard_analyze_git'
      )?.cliEquivalent
    ).toBe('archguard analyze --include-git');

    const byToolName = new Map(mcpTools.map((tool) => [tool.name, tool.description ?? '']));
    for (const toolName of workflowDependentMcpTools) {
      expect(byToolName.get(toolName), toolName).toContain('Call first:');
    }

    for (const blockId of Object.keys(metadataDocsBlocks) as MetadataDocsBlockId[]) {
      const { filePath } = metadataDocsBlocks[blockId];
      const contents = await fs.readFile(path.resolve(process.cwd(), filePath), 'utf8');
      expect(contents, filePath).toContain(renderMetadataDocsBlock(blockId));
    }

    const agentSurface = await fs.readFile(
      path.resolve(process.cwd(), metadataDocsBlocks['agent-surface'].filePath),
      'utf8'
    );
    for (const toolName of mcpToolBaseline) {
      expect(agentSurface, toolName).toContain(`\`${toolName}\``);
    }
  });

  it('fails docs check when a generated docs block is stale', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-docs-check-'));
    tmpDirs.push(tempRoot);
    await copyDocsFiles(tempRoot);

    const readme = path.join(tempRoot, 'README.md');
    const stale = replaceMetadataDocsBlock(
      await fs.readFile(readme, 'utf8'),
      'readme-cli-commands',
      'stale generated block'
    );
    await fs.writeFile(readme, stale);

    const result = await execa('npm', ['run', 'docs:check'], {
      cwd: process.cwd(),
      env: { ARCHGUARD_DOCS_ROOT: tempRoot },
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Metadata docs are stale.');
    expect(result.stderr).toContain('README.md');
  });
});

async function listToolsFromMcpServer(): Promise<ListedTool[]> {
  const server = createMcpServer('/workspace');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'metadata-surface-e2e', version: '1.0.0' });

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.listTools();
    return result.tools;
  } finally {
    await clientTransport.close();
    await server.close();
  }
}

async function copyDocsFiles(tempRoot: string): Promise<void> {
  const files = new Set(Object.values(metadataDocsBlocks).map((block) => block.filePath));
  for (const file of files) {
    await fs.ensureDir(path.dirname(path.join(tempRoot, file)));
    await fs.copy(path.resolve(process.cwd(), file), path.join(tempRoot, file));
  }
}
