export type ArchGuardSurface = 'cli' | 'mcp' | 'docs' | 'agent';

export type MetadataCategory =
  | 'analysis'
  | 'query'
  | 'test-analysis'
  | 'git-history'
  | 'atlas'
  | 'cache'
  | 'configuration'
  | 'fitness'
  | 'metrics'
  | 'mcp'
  | 'docs';

export interface AgentGuidance {
  useWhen: string[];
  callFirst?: string[];
  followWith?: string[];
  failureRecovery: string[];
  limitations: string[];
}

export interface UsageExample {
  surface: ArchGuardSurface;
  command: string;
  description: string;
}

export interface VerificationHint {
  kind: 'command' | 'test' | 'source';
  target: string;
  description: string;
}

export interface CliOptionMetadata {
  flags: string;
  description: string;
  defaultValue?: string | number | boolean;
  allowedValues?: string[];
  mapsToMcpTool?: string;
}

export interface CliCommandMetadata extends ArchGuardMetadataEntry {
  cli: {
    command: string;
    description: string;
    options: CliOptionMetadata[];
  };
}

export interface McpParameterMetadata {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpToolMetadata extends ArchGuardMetadataEntry {
  mcp: {
    toolName: string;
    description: string;
    inputSchemaId: string;
    cliEquivalent?: string;
    parameters: McpParameterMetadata[];
  };
}

export interface QueryMappingMetadata {
  mcpTool: string;
  cliEquivalent: string;
  kind: 'query' | 'analyze';
}

export interface ArchGuardMetadataEntry {
  id: string;
  title: string;
  summary: string;
  category: MetadataCategory;
  surfaces: ArchGuardSurface[];
  agent: AgentGuidance;
  examples: UsageExample[];
  verification: VerificationHint[];
}

export interface ArchGuardMetadataRegistry {
  cliCommands: CliCommandMetadata[];
  mcpTools: McpToolMetadata[];
  queryMappings: QueryMappingMetadata[];
}
