import {
  archGuardMetadataRegistry,
  cliCommandBaseline,
  mcpToolBaseline,
  workflowDependentMcpTools,
} from './registry.js';
import type { ArchGuardMetadataRegistry, McpToolMetadata } from './types.js';

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
  const rows = registry.cliCommands
    .filter((command) => cliCommandBaseline.includes(command.cli.command as any))
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
  const rows = registry.mcpTools
    .filter((tool) => mcpToolBaseline.includes(tool.mcp.toolName as any))
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
  const analysisTools = toolsByCategory(registry, 'analysis');
  const queryTools = toolsByCategory(registry, 'query');
  const testTools = toolsByCategory(registry, 'test-analysis');
  const gitTools = toolsByCategory(registry, 'git-history');
  const atlasTools = toolsByCategory(registry, 'atlas');

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
    '## Workflows',
    '',
    '- Architecture orientation: call `archguard_analyze`, then `archguard_summary`, then query tools such as `archguard_find_entity`, `archguard_get_dependencies`, or `archguard_get_dependents`.',
    '- Test analysis: call `archguard_analyze` with `includeTests: true`, then `archguard_detect_test_patterns`, then `archguard_get_test_metrics`, `archguard_get_test_issues`, or `archguard_get_entity_coverage`.',
    '- Git history: run `archguard analyze --include-git` in CLI workflows or call `archguard_analyze_git` in MCP workflows, then use change context, co-change, risk, or ownership tools.',
    '- Go Atlas: call `archguard_analyze` on a Go project, then inspect `archguard_get_atlas_layer`, `archguard_get_package_fanin`, `archguard_get_package_fanout`, or `archguard_detect_god_packages`.',
    '',
    '## Analysis Tools',
    '',
    renderAgentToolList(analysisTools),
    '',
    '## Query Tools',
    '',
    renderAgentToolList(queryTools),
    '',
    '## Test Analysis Tools',
    '',
    renderAgentToolList(testTools),
    '',
    '## Git History Tools',
    '',
    renderAgentToolList(gitTools),
    '',
    '## Atlas Tools',
    '',
    renderAgentToolList(atlasTools),
    '',
    '## Recovery Rules',
    '',
    ...workflowDependentMcpTools.map((toolName) => {
      const tool = registry.mcpTools.find((entry) => entry.mcp.toolName === toolName);
      return `- \`${toolName}\`: call ${tool?.agent.callFirst?.join(', ') ?? 'the prerequisite tool'} first. ${tool?.agent.failureRecovery[0] ?? 'Retry after refreshing analysis data.'}`;
    }),
  ].join('\n');
}

function toolsByCategory(
  registry: ArchGuardMetadataRegistry,
  category: McpToolMetadata['category']
): McpToolMetadata[] {
  return registry.mcpTools.filter((tool) => tool.category === category);
}

function renderAgentToolList(tools: McpToolMetadata[]): string {
  return tools
    .map((tool) => {
      const callFirst = tool.agent.callFirst?.length
        ? ` Call first: ${tool.agent.callFirst.join(', ')}.`
        : '';
      return `- \`${tool.mcp.toolName}\`: ${tool.summary}${callFirst}`;
    })
    .join('\n');
}
