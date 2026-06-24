import { archGuardMetadataRegistry, cliCommandBaseline, mcpToolBaseline } from './registry.js';
import { renderAgentInstructions } from './instruction-renderer.js';
import type { ArchGuardMetadataRegistry } from './types.js';

type CliBaselineCommand = (typeof cliCommandBaseline)[number];
type McpBaselineTool = (typeof mcpToolBaseline)[number];

export type MetadataDocsBlockId =
  | 'readme-cli-commands'
  | 'readme-mcp-tools'
  | 'cli-usage-commands'
  | 'mcp-usage-tools'
  | 'agent-surface';

export const metadataDocsBlocks: Record<MetadataDocsBlockId, { filePath: string }> = {
  'readme-cli-commands': { filePath: 'README.md' },
  'readme-mcp-tools': { filePath: 'README.md' },
  'cli-usage-commands': { filePath: 'docs/user-guide/cli-usage.md' },
  'mcp-usage-tools': { filePath: 'docs/user-guide/mcp-usage.md' },
  'agent-surface': { filePath: 'docs/user-guide/agent-surface.md' },
};

export function markerStart(blockId: MetadataDocsBlockId): string {
  return `<!-- ARCHGUARD_METADATA:${blockId}:START -->`;
}

export function markerEnd(blockId: MetadataDocsBlockId): string {
  return `<!-- ARCHGUARD_METADATA:${blockId}:END -->`;
}

export function renderMetadataDocsBlock(
  blockId: MetadataDocsBlockId,
  registry: ArchGuardMetadataRegistry = archGuardMetadataRegistry
): string {
  switch (blockId) {
    case 'readme-cli-commands':
    case 'cli-usage-commands':
      return renderCliCommands(registry);
    case 'readme-mcp-tools':
    case 'mcp-usage-tools':
      return renderMcpTools(registry);
    case 'agent-surface':
      return renderAgentSurface(registry);
  }
}

export function replaceMetadataDocsBlock(
  contents: string,
  blockId: MetadataDocsBlockId,
  nextBlock: string
): string {
  const start = markerStart(blockId);
  const end = markerEnd(blockId);
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Missing metadata docs markers for ${blockId}`);
  }

  return `${contents.slice(0, startIndex + start.length)}\n${nextBlock.trimEnd()}\n${contents.slice(
    endIndex
  )}`;
}

function renderCliCommands(registry: ArchGuardMetadataRegistry): string {
  const baseline = new Set<CliBaselineCommand>(cliCommandBaseline);
  const rows = registry.cliCommands
    .filter((command) => baseline.has(command.cli.command as CliBaselineCommand))
    .map((command) => {
      const mappedTools = command.cli.options
        .map((option) => option.mapsToMcpTool)
        .filter(Boolean).length;
      const mcpColumn = mappedTools > 0 ? `${mappedTools} mapped option(s)` : '-';
      return `| \`archguard ${command.cli.command}\` | ${command.cli.description} | ${mcpColumn} |`;
    });

  return [
    '> Generated from `src/cli/metadata/registry.ts`; run `npm run docs:check` after editing registry metadata.',
    '',
    '| Command | Description | MCP Mapping |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
}

function renderMcpTools(registry: ArchGuardMetadataRegistry): string {
  const baseline = new Set<McpBaselineTool>(mcpToolBaseline);
  const rows = registry.mcpTools
    .filter((tool) => baseline.has(tool.mcp.toolName as McpBaselineTool))
    .map((tool) => {
      const callFirst = tool.agent.callFirst?.join(', ') ?? '-';
      return `| \`${tool.mcp.toolName}\` | ${tool.summary} | \`${tool.mcp.cliEquivalent ?? '-'}\` | ${callFirst} |`;
    });

  return [
    '> Generated from `src/cli/metadata/registry.ts`; run `npm run docs:check` after editing MCP metadata.',
    '',
    '| MCP Tool | Description | CLI Equivalent | Call First |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function renderAgentSurface(registry: ArchGuardMetadataRegistry): string {
  return [
    '# ArchGuard Agent Surface',
    '',
    'This page is generated from `src/cli/metadata/registry.ts`. Run `npm run docs:check` after changing commands, tools, or agent guidance.',
    '',
    '## Setup',
    '',
    'Claude Code project scope:',
    '',
    '```bash',
    'claude mcp add --scope project archguard -- archguard mcp',
    '```',
    '',
    'Codex user scope:',
    '',
    '```bash',
    'codex mcp add archguard -- archguard mcp',
    '```',
    '',
    'Codex config file:',
    '',
    '```toml',
    '[mcp_servers.archguard]',
    'command = "archguard"',
    'args = ["mcp"]',
    '```',
    '',
    renderAgentInstructions(registry, { provider: 'codex', format: 'markdown' }).content,
  ].join('\n');
}
