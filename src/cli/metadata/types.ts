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

export type SurfacePolicy = 'both' | 'cli-only' | 'mcp-only' | 'docs-only' | 'internal';

export type Lifecycle = 'stable' | 'experimental' | 'deprecated';

export interface AgentGuidance {
  useWhen: string[];
  avoidWhen?: string[];
  callFirst?: string[];
  followWith?: string[];
  failureRecovery: string[];
  limitations: string[];
  freshness?: string;
}

export interface DocsContract {
  includeInReadme?: boolean;
  includeInCliGuide?: boolean;
  includeInMcpGuide?: boolean;
  includeInAgentSurface?: boolean;
}

export interface ArtifactContract {
  reads?: string[];
  writes?: string[];
  requiresAnalyze?: boolean;
  requiresGitAnalyze?: boolean;
  requiresTestAnalyze?: boolean;
}

export interface InstallContract {
  provider?: 'claude' | 'codex' | 'all';
  configScope?: 'user' | 'project';
  writesConfig?: boolean;
  writesInstructions?: boolean;
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
  surfacePolicy?: SurfacePolicy;
  lifecycle?: Lifecycle;
  agent: AgentGuidance;
  artifacts?: ArtifactContract;
  docs?: DocsContract;
  install?: InstallContract;
  examples: UsageExample[];
  verification: VerificationHint[];
}

export interface ArchGuardMetadataRegistry {
  cliCommands: CliCommandMetadata[];
  stagedCliCommands?: CliCommandMetadata[];
  mcpTools: McpToolMetadata[];
  queryMappings: QueryMappingMetadata[];
}
