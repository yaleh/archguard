import { createHash } from 'crypto';
import { archGuardMetadataRegistry } from './registry.js';
import type {
  ArchGuardMetadataEntry,
  ArchGuardMetadataRegistry,
  McpToolMetadata,
} from './types.js';

export type AgentProvider = 'claude' | 'codex';

export interface InstructionRenderInput {
  provider: AgentProvider;
  format: 'markdown' | 'text';
  includeCatalog?: boolean;
}

export interface InstructionRenderResult {
  provider: AgentProvider;
  content: string;
  sourceMetadataHash: string;
  generatedAt: string;
}

const workflowCategories = ['analysis', 'query', 'test-analysis', 'git-history', 'atlas'] as const;

export function renderAgentInstructions(
  registry: ArchGuardMetadataRegistry = archGuardMetadataRegistry,
  input: InstructionRenderInput
): InstructionRenderResult {
  const sourceMetadataHash = hashInstructionMetadata(registry);
  const generatedAt = new Date().toISOString();
  const content =
    input.format === 'text'
      ? renderTextInstructions(registry, input, sourceMetadataHash)
      : renderMarkdownInstructions(registry, input, sourceMetadataHash);

  return {
    provider: input.provider,
    content,
    sourceMetadataHash,
    generatedAt,
  };
}

export function hashInstructionMetadata(registry: ArchGuardMetadataRegistry): string {
  const payload = {
    cliCommands: registry.cliCommands.map((command) => ({
      id: command.id,
      summary: command.summary,
      category: command.category,
      surfaces: command.surfaces,
      agent: command.agent,
      docs: command.docs,
      cli: {
        command: command.cli.command,
        description: command.cli.description,
      },
    })),
    mcpTools: registry.mcpTools.map((tool) => ({
      id: tool.id,
      summary: tool.summary,
      category: tool.category,
      surfaces: tool.surfaces,
      agent: tool.agent,
      docs: tool.docs,
      mcp: {
        toolName: tool.mcp.toolName,
        description: tool.mcp.description,
        cliEquivalent: tool.mcp.cliEquivalent,
      },
    })),
    queryMappings: registry.queryMappings,
  };

  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function renderMarkdownInstructions(
  registry: ArchGuardMetadataRegistry,
  input: InstructionRenderInput,
  sourceMetadataHash: string
): string {
  const lines = [
    `# ArchGuard Instructions for ${providerLabel(input.provider)}`,
    '',
    providerSetup(input.provider),
    '',
    `Source metadata hash: \`${sourceMetadataHash}\``,
    '',
    '## Operating Rules',
    '',
    '- Prefer ArchGuard MCP tools when you need architecture, dependency, test-analysis, git-history, or Go Atlas context.',
    '- Call the listed prerequisite tools before tools that read generated artifacts.',
    '- Treat query, test-analysis, git-history, and Atlas results as snapshots; refresh them when source, tests, or git history changed.',
    '- Use CLI commands when a human-readable terminal workflow is more appropriate than MCP JSON.',
    '',
    '## Core Workflows',
    '',
    ...renderWorkflowSections(registry, 'markdown'),
    '',
    '## Recovery Rules',
    '',
    ...renderRecoveryRules(registry, 'markdown'),
  ];

  if (input.includeCatalog) {
    lines.push('', '## Tool Catalog', '', ...renderCatalog(registry));
  }

  return lines.join('\n');
}

function renderTextInstructions(
  registry: ArchGuardMetadataRegistry,
  input: InstructionRenderInput,
  sourceMetadataHash: string
): string {
  const lines = [
    `ArchGuard Instructions for ${providerLabel(input.provider)}`,
    providerSetup(input.provider),
    `Source metadata hash: ${sourceMetadataHash}`,
    '',
    'Operating Rules:',
    '- Prefer ArchGuard MCP tools for architecture, dependency, test-analysis, git-history, or Go Atlas context.',
    '- Call prerequisite tools before artifact-backed tools.',
    '- Refresh snapshots when project data changes.',
    '',
    'Core Workflows:',
    ...renderWorkflowSections(registry, 'text'),
    '',
    'Recovery Rules:',
    ...renderRecoveryRules(registry, 'text'),
  ];

  if (input.includeCatalog) {
    lines.push('', 'Tool Catalog:', ...renderCatalog(registry));
  }

  return lines.join('\n');
}

function renderWorkflowSections(
  registry: ArchGuardMetadataRegistry,
  format: 'markdown' | 'text'
): string[] {
  const lines: string[] = [];
  for (const category of workflowCategories) {
    const tools = registry.mcpTools.filter((tool) => tool.category === category);
    if (tools.length === 0) continue;
    lines.push(
      format === 'markdown' ? `### ${categoryTitle(category)}` : `${categoryTitle(category)}:`
    );
    lines.push('');
    for (const tool of tools) {
      lines.push(renderToolGuidance(tool, format));
    }
    lines.push('');
  }
  return lines;
}

function renderToolGuidance(tool: McpToolMetadata, format: 'markdown' | 'text'): string {
  const callFirst = tool.agent.callFirst?.length
    ? ` Call first: ${tool.agent.callFirst.join(', ')}.`
    : '';
  const followWith = tool.agent.followWith?.length
    ? ` Follow with: ${tool.agent.followWith.join(', ')}.`
    : '';
  const freshness = tool.agent.freshness ? ` Freshness: ${tool.agent.freshness}` : '';
  const recovery = ` Recovery: ${tool.agent.failureRecovery[0]}`;
  const prefix = format === 'markdown' ? `- \`${tool.mcp.toolName}\`` : `- ${tool.mcp.toolName}`;
  return `${prefix}: ${tool.summary}${callFirst}${followWith}${freshness}${recovery}`;
}

function renderRecoveryRules(
  registry: ArchGuardMetadataRegistry,
  format: 'markdown' | 'text'
): string[] {
  return registry.mcpTools
    .filter((tool) => tool.agent.callFirst?.length)
    .map((tool) => {
      const name = format === 'markdown' ? `\`${tool.mcp.toolName}\`` : tool.mcp.toolName;
      return `- ${name}: ${tool.agent.failureRecovery[0]}`;
    });
}

function renderCatalog(registry: ArchGuardMetadataRegistry): string[] {
  return registry.mcpTools.map((tool) => {
    const cli = tool.mcp.cliEquivalent ? ` CLI: ${tool.mcp.cliEquivalent}.` : '';
    return `- ${tool.mcp.toolName}: ${tool.summary}${cli}`;
  });
}

function providerLabel(provider: AgentProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code';
}

function providerSetup(provider: AgentProvider): string {
  if (provider === 'codex') {
    return 'Codex MCP config uses `~/.codex/config.toml` with `[mcp_servers.archguard]` running `archguard mcp`.';
  }
  return 'Claude Code MCP config can use project scope `.mcp.json` or user scope `~/.claude/mcp.json` running `archguard mcp`.';
}

function categoryTitle(category: (typeof workflowCategories)[number]): string {
  const titles: Record<(typeof workflowCategories)[number], string> = {
    analysis: 'Analysis',
    query: 'Query Artifacts',
    'test-analysis': 'Test Analysis',
    'git-history': 'Git History',
    atlas: 'Go Atlas',
  };
  return titles[category];
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)])
    );
  }
  return value;
}

export function agentFacingEntries(
  registry: ArchGuardMetadataRegistry = archGuardMetadataRegistry
): ArchGuardMetadataEntry[] {
  return [...registry.cliCommands, ...registry.mcpTools].filter((entry) =>
    entry.surfaces.includes('agent')
  );
}
