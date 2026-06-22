import type {
  AgentGuidance,
  ArchGuardMetadataRegistry,
  CliCommandMetadata,
  CliOptionMetadata,
  DocsContract,
  McpParameterMetadata,
  McpToolMetadata,
  MetadataCategory,
  QueryMappingMetadata,
  UsageExample,
  VerificationHint,
} from './types.js';

const queryArtifactCallFirst = ['archguard_analyze'];
const testAnalysisCallFirst = ['archguard_analyze', 'archguard_detect_test_patterns'];
const gitHistoryCallFirst = ['archguard_analyze_git'];
const atlasCallFirst = ['archguard_analyze'];

export const cliCommandBaseline = [
  'analyze',
  'agent',
  'cache',
  'check',
  'config',
  'diff',
  'help',
  'init',
  'install',
  'mcp',
  'query',
  'update',
] as const;

export const mcpToolBaseline = [
  'archguard_find_entity',
  'archguard_get_dependencies',
  'archguard_get_dependents',
  'archguard_find_implementers',
  'archguard_find_subclasses',
  'archguard_get_file_entities',
  'archguard_detect_cycles',
  'archguard_summary',
  'archguard_get_atlas_layer',
  'archguard_get_package_stats',
  'archguard_analyze',
  'archguard_detect_test_patterns',
  'archguard_get_test_issues',
  'archguard_get_test_metrics',
  'archguard_get_entity_coverage',
  'archguard_analyze_git',
  'archguard_get_change_context',
  'archguard_get_cochange',
  'archguard_get_change_risk',
  'archguard_get_ownership',
  'archguard_find_callers',
  'archguard_get_package_fanin',
  'archguard_get_package_fanout',
  'archguard_detect_god_packages',
] as const;

export const workflowDependentMcpTools = [
  'archguard_summary',
  'archguard_find_entity',
  'archguard_get_dependencies',
  'archguard_get_dependents',
  'archguard_find_implementers',
  'archguard_find_subclasses',
  'archguard_get_file_entities',
  'archguard_detect_cycles',
  'archguard_get_atlas_layer',
  'archguard_get_package_stats',
  'archguard_find_callers',
  'archguard_detect_test_patterns',
  'archguard_get_test_metrics',
  'archguard_get_test_issues',
  'archguard_get_entity_coverage',
  'archguard_get_change_context',
  'archguard_get_cochange',
  'archguard_get_change_risk',
  'archguard_get_ownership',
  'archguard_get_package_fanin',
  'archguard_get_package_fanout',
  'archguard_detect_god_packages',
] as const;

function guidance(args: {
  useWhen: string[];
  avoidWhen?: string[];
  callFirst?: string[];
  followWith?: string[];
  recovery?: string[];
  limitations?: string[];
  freshness?: string;
}): AgentGuidance {
  return {
    useWhen: args.useWhen,
    avoidWhen: args.avoidWhen,
    callFirst: args.callFirst,
    followWith: args.followWith,
    failureRecovery: args.recovery ?? [
      'If data is missing or stale, run the listed prerequisite command and retry the same request.',
    ],
    limitations: args.limitations ?? [
      'Results reflect static ArchGuard analysis artifacts and may be stale until analysis is rerun.',
    ],
    freshness: args.freshness,
  };
}

function docsForSurfaces(surfaces: readonly string[]): DocsContract {
  return {
    includeInReadme: surfaces.includes('cli') || surfaces.includes('mcp'),
    includeInCliGuide: surfaces.includes('cli'),
    includeInMcpGuide: surfaces.includes('mcp'),
    includeInAgentSurface: surfaces.includes('agent'),
  };
}

function freshnessForCategory(category: MetadataCategory): string | undefined {
  switch (category) {
    case 'analysis':
      return 'Refreshes source-derived ArchGuard artifacts for the current project when it runs.';
    case 'query':
      return 'Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes.';
    case 'test-analysis':
      return 'Reads the last test-analysis artifacts; rerun archguard_analyze with includeTests and archguard_detect_test_patterns after test changes.';
    case 'git-history':
      return 'Reads the last git-history analysis snapshot; rerun archguard_analyze_git after new commits or when changing the history window.';
    case 'atlas':
      return 'Reads the last Go Atlas artifacts; rerun archguard_analyze on the Go project after source changes.';
    case 'docs':
      return 'Reflects generated documentation blocks from the metadata registry; rerun npm run docs:check after metadata changes.';
    case 'cache':
    case 'configuration':
    case 'fitness':
    case 'metrics':
    case 'mcp':
      return undefined;
  }
}

function examples(command: string, description: string): UsageExample[] {
  return [{ surface: 'cli', command, description }];
}

function mcpExample(toolName: string, description: string): UsageExample[] {
  return [{ surface: 'mcp', command: toolName, description }];
}

function verify(target: string, description = 'Covered by project validation'): VerificationHint[] {
  return [
    {
      kind: target.startsWith('tests/') ? 'test' : 'command',
      target,
      description,
    },
  ];
}

function commonParams(names: string[]): McpParameterMetadata[] {
  const descriptions: Record<string, string> = {
    projectRoot: 'Root directory of the target project. Defaults to the MCP server startup cwd.',
    scope:
      'Query scope key, label fragment, or the synthetic alias "global". Omit to use manifest.globalScopeKey resolution.',
    outputScope:
      'Output granularity: "package" (package-level only), "class" (entity-level, no members, default), "method" (full entity with method signatures). edge-list format recommended for LLM reasoning (+38pp vs mermaid, format-encoding experiment, n=14 tasks).',
    queryFormat:
      'Output format: "structured" (nested JSON objects, default) or "edge-list" (flat { entities[], relations[] } — best for LLM reasoning).',
    verbose: 'Return full entities with members. Default false returns summary only.',
    name: 'Entity name',
    depth: 'BFS traversal depth (1-5)',
    target: 'Package path or file path to query.',
    targetType: 'Whether the target is a package path or a file path.',
    attrFilter:
      'Attribute key-value pairs (AND-composed). Values can be string, number, or boolean.',
    entityType: 'Filter by entity type (e.g. lock_domain, class)',
    filePath: 'Source file path (e.g. "cli/query/query-engine.ts")',
    layer: 'Atlas layer to retrieve',
    format: 'Output artifact format. Use json for query/index refresh without Mermaid rendering.',
    sortBy:
      'Primary sort key, descending. Falls back to fileCount when loc is unavailable (Go Atlas and TypeScript projects).',
    minFileCount: 'Exclude packages with fewer than this many files.',
    minLoc:
      'Exclude packages with loc below this threshold. Has no effect on Go or TypeScript (loc unavailable for these languages).',
    topN: 'Limit output to the top N packages after sorting and filtering.',
    sources: 'Source paths relative to the target project root. Omit to analyze the project root.',
    lang: 'Source code language plugin to use. Supported values: typescript, go, java, python, cpp, kotlin. This is not a natural-language locale.',
    diagrams:
      'Diagram levels to generate. Omit to use the detected/default set for the target sources.',
    noCache: 'Disable analysis caches for this run.',
    includeTests:
      'Run test analysis after parsing. Required before calling test analysis tools (get_test_metrics, get_test_coverage, get_test_issues).',
    testsOnly: 'Run test analysis only, without generating architecture diagrams.',
    includeGit:
      'Also analyze git commit history (writes artifacts to <work-dir>/query/git-history/). Required before calling git history tools (get_change_context, get_cochange, get_change_risk, get_ownership).',
    patternConfig:
      'Pattern config for detection (informational only — analysis data was produced at archguard_analyze time; changing this field at query time does not re-analyze or alter the stored results).',
    severity: 'Filter by severity',
    includePackageBreakdown:
      'When true, includes per-package coverage breakdown sorted ascending by coverageRatio.',
    entityId:
      'Dotted-path entity ID as reported by archguard_find_entity or archguard_get_test_coverage (e.g. "lmdeploy.pytorch.models.LlamaModel").',
    sinceDays: 'How many days of git history to include (default: 90).',
    maxCommits: 'Maximum number of commits to process (default: 500).',
    includeMerges: 'Whether to include merge commits (default: false).',
    granularities: "Which granularities to include in the output (default: ['package', 'file']).",
    packageDepth:
      'Number of path segments to use for package grouping (default: 1). Use 2 for sub-package depth (e.g. src/mermaid instead of src).',
    entityName:
      'Entity name to find callers for. Use "ClassName" or "ClassName.methodName" for method-level filtering.',
    limit: 'Maximum number of packages to return (default: 20).',
    minFanIn: 'Exclude packages with fan-in below this threshold.',
    minFanOut: 'Exclude packages with fan-out below this threshold.',
    minStructs: 'Struct count threshold (default: 20). Ignored when node has no stats.',
    minFunctions: 'Function count threshold (default: 50). Ignored when node has no stats.',
    minFiles: 'File count threshold (default: 20).',
  };
  return names.map((name) => ({ name, description: descriptions[name] ?? `${name} parameter.` }));
}

function mcpParams(
  names: string[],
  overrides: Record<string, string> = {},
  required: string[] = []
): McpParameterMetadata[] {
  const requiredSet = new Set(required);
  return commonParams(names).map((parameter) => ({
    ...parameter,
    description: overrides[parameter.name] ?? parameter.description,
    required: requiredSet.has(parameter.name) ? true : undefined,
  }));
}

const analyzeOptions: CliOptionMetadata[] = [
  { flags: '--config <path>', description: 'Config file path.' },
  {
    flags: '--diagrams <levels...>',
    description: 'Filter by diagram level.',
    allowedValues: ['package', 'class', 'method'],
  },
  { flags: '-s, --sources <paths...>', description: 'Source directories to analyze.' },
  {
    flags: '--lang <language>',
    description: 'Language plugin override.',
    allowedValues: ['typescript', 'go', 'java', 'python', 'cpp', 'kotlin'],
  },
  {
    flags: '-f, --format <type>',
    description: 'Output format.',
    allowedValues: ['mermaid', 'json'],
  },
  { flags: '--work-dir <dir>', description: 'ArchGuard work directory.' },
  { flags: '--cache-dir <dir>', description: 'Cache directory.' },
  { flags: '--output-dir <dir>', description: 'Output directory.' },
  { flags: '-e, --exclude <patterns...>', description: 'Exclude patterns.' },
  { flags: '--no-cache', description: 'Disable cache.' },
  { flags: '-c, --concurrency <num>', description: 'Parallel parsing concurrency.' },
  { flags: '-v, --verbose', description: 'Verbose output.' },
  { flags: '--mermaid-theme <theme>', description: 'Mermaid theme.' },
  { flags: '--mermaid-renderer <renderer>', description: 'Mermaid renderer.' },
  { flags: '--cli-command <command>', description: 'Claude CLI command.' },
  { flags: '--cli-args <args>', description: 'Additional CLI arguments.' },
  { flags: '--include-tests', description: 'Include test analysis.' },
  { flags: '--tests-only', description: 'Run only test analysis.' },
  {
    flags: '--include-git',
    description: 'Also analyze git commit history.',
    mapsToMcpTool: 'archguard_analyze_git',
  },
  { flags: '--atlas-layers <layers>', description: 'Atlas layers to generate.' },
  { flags: '--atlas-strategy <strategy>', description: 'Function body extraction strategy.' },
  { flags: '--atlas-no-tests', description: 'Deprecated Atlas test exclusion flag.' },
  { flags: '--atlas-include-tests', description: 'Include test packages in Atlas extraction.' },
  { flags: '--atlas-protocols <protocols>', description: 'Protocols to include in flow graph.' },
  { flags: '--atlas-entry-pattern <pattern>', description: 'Custom entry point regex.' },
];

export const queryOptions: CliOptionMetadata[] = [
  { flags: '--arch-dir <dir>', description: 'ArchGuard work directory.' },
  { flags: '--scope <key>', description: 'Query scope key.' },
  {
    flags: '--format <type>',
    description: 'Output format.',
    defaultValue: 'text',
    allowedValues: ['json', 'text'],
  },
  { flags: '--verbose', description: 'Return full entities in JSON output.' },
  {
    flags: '--entity <name>',
    description: 'Find entity by name.',
    mapsToMcpTool: 'archguard_find_entity',
  },
  {
    flags: '--deps-of <name>',
    description: 'Find dependencies of entity.',
    mapsToMcpTool: 'archguard_get_dependencies',
  },
  {
    flags: '--used-by <name>',
    description: 'Find dependents of entity.',
    mapsToMcpTool: 'archguard_get_dependents',
  },
  {
    flags: '--implementers-of <name>',
    description: 'Find implementers of interface.',
    mapsToMcpTool: 'archguard_find_implementers',
  },
  {
    flags: '--subclasses-of <name>',
    description: 'Find subclasses of class.',
    mapsToMcpTool: 'archguard_find_subclasses',
  },
  {
    flags: '--file <path>',
    description: 'Find entities in file.',
    mapsToMcpTool: 'archguard_get_file_entities',
  },
  { flags: '--depth <n>', description: 'BFS depth for dependency queries.', defaultValue: '1' },
  {
    flags: '--cycles',
    description: 'Show dependency cycles.',
    mapsToMcpTool: 'archguard_detect_cycles',
  },
  { flags: '--summary', description: 'Show scope summary.', mapsToMcpTool: 'archguard_summary' },
  { flags: '--list-scopes', description: 'List available query scopes.' },
  {
    flags: '--type <entityType>',
    description: 'Filter entities by type.',
    mapsToMcpTool: 'archguard_find_entity',
  },
  { flags: '--high-coupling', description: 'Find high-coupling entities.' },
  { flags: '--threshold <n>', description: 'Coupling threshold.', defaultValue: '8' },
  { flags: '--orphans', description: 'Find orphan entities.' },
  { flags: '--in-cycles', description: 'Find entities participating in cycles.' },
  {
    flags: '--attr <keyOrPair...>',
    description: 'Filter by attribute key or key=value pair.',
    mapsToMcpTool: 'archguard_find_entity',
  },
  {
    flags: '--package-stats [depth]',
    description: 'Show package statistics.',
    mapsToMcpTool: 'archguard_get_package_stats',
  },
  {
    flags: '--package-stats-sort-by <key>',
    description: 'Sort package statistics.',
    allowedValues: ['loc', 'fileCount', 'entityCount', 'methodCount'],
  },
  {
    flags: '--package-stats-min-files <n>',
    description: 'Exclude packages with fewer than N files.',
  },
  { flags: '--package-stats-min-loc <n>', description: 'Exclude packages with loc below N.' },
  { flags: '--package-stats-top <n>', description: 'Limit package statistics output.' },
  {
    flags: '--output-scope <scope>',
    description: 'Output granularity.',
    allowedValues: ['package', 'class', 'method'],
  },
  {
    flags: '--query-format <format>',
    description: 'Structured or edge-list output.',
    allowedValues: ['structured', 'edge-list'],
  },
  {
    flags: '--callers <entity>',
    description: 'Find callers of entity.',
    mapsToMcpTool: 'archguard_find_callers',
  },
  { flags: '--callers-depth <n>', description: 'BFS depth for callers.', defaultValue: '1' },
  {
    flags: '--atlas-layer <layer>',
    description: 'Show Go Atlas layer data.',
    mapsToMcpTool: 'archguard_get_atlas_layer',
  },
  {
    flags: '--test-patterns',
    description: 'Show detected test pattern config.',
    mapsToMcpTool: 'archguard_detect_test_patterns',
  },
  {
    flags: '--test-issues',
    description: 'Show static test quality issues.',
    mapsToMcpTool: 'archguard_get_test_issues',
  },
  {
    flags: '--severity <level>',
    description: 'Filter test issues by severity.',
    allowedValues: ['warning', 'info'],
  },
  {
    flags: '--test-metrics',
    description: 'Show test suite metrics.',
    mapsToMcpTool: 'archguard_get_test_metrics',
  },
  {
    flags: '--entity-coverage <entityId>',
    description: 'Show coverage for an entity.',
    mapsToMcpTool: 'archguard_get_entity_coverage',
  },
  {
    flags: '--package-fanin',
    description: 'List packages ranked by fan-in.',
    mapsToMcpTool: 'archguard_get_package_fanin',
  },
  {
    flags: '--package-fanout',
    description: 'List packages ranked by fan-out.',
    mapsToMcpTool: 'archguard_get_package_fanout',
  },
  {
    flags: '--god-packages',
    description: 'Detect god packages.',
    mapsToMcpTool: 'archguard_detect_god_packages',
  },
  {
    flags: '--target-type <type>',
    description: 'Target type for git history queries.',
    defaultValue: 'file',
    allowedValues: ['file', 'package'],
  },
  {
    flags: '--change-context <path>',
    description: 'Show change context for a path.',
    mapsToMcpTool: 'archguard_get_change_context',
  },
  {
    flags: '--cochange <path>',
    description: 'Show co-change neighbors for a path.',
    mapsToMcpTool: 'archguard_get_cochange',
  },
  {
    flags: '--change-risk <path>',
    description: 'Show change risk score for a path.',
    mapsToMcpTool: 'archguard_get_change_risk',
  },
  {
    flags: '--ownership <path>',
    description: 'Show maintainer ownership for a path.',
    mapsToMcpTool: 'archguard_get_ownership',
  },
];

function cliCommand(
  command: string,
  title: string,
  summary: string,
  category: MetadataCategory,
  options: CliOptionMetadata[],
  extraGuidance?: Partial<AgentGuidance>
): CliCommandMetadata {
  const surfaces = ['cli', 'docs', 'agent'] as const;
  const freshness = extraGuidance?.freshness ?? freshnessForCategory(category);
  return {
    id: command,
    title,
    summary,
    category,
    surfaces: [...surfaces],
    surfacePolicy: 'both',
    lifecycle: 'stable',
    agent: {
      ...guidance({
        useWhen: [`Use ${command} when ${summary.toLowerCase()}.`],
        avoidWhen: ['Use MCP tools instead when an agent needs structured architecture data.'],
        recovery: ['Run with --help for valid flags; fix missing project artifacts, then retry.'],
        freshness,
      }),
      ...extraGuidance,
    },
    docs: docsForSurfaces(surfaces),
    examples: examples(`archguard ${command}`, summary),
    verification: verify('npm test -- tests/unit/cli/command.test.ts'),
    cli: { command, description: summary, options },
  };
}

function cliOnlyCommand(
  command: string,
  title: string,
  summary: string,
  category: MetadataCategory,
  options: CliOptionMetadata[],
  extraGuidance?: Partial<AgentGuidance>
): CliCommandMetadata {
  return {
    ...cliCommand(command, title, summary, category, options, extraGuidance),
    surfaces: ['cli', 'docs', 'agent'],
    surfacePolicy: 'cli-only',
    verification: verify('npm test -- tests/unit/cli/help-command.test.ts'),
  };
}

const onboardingOptions: CliOptionMetadata[] = [
  { flags: '--scope <scope>', description: 'Config scope: user or project.', defaultValue: 'user' },
  { flags: '--home <dir>', description: 'Home directory override for user-scope config.' },
  { flags: '--project-root <dir>', description: 'Project root override for project-scope config.' },
  { flags: '--dry-run', description: 'Show planned changes without writing files.' },
  { flags: '--json', description: 'Emit operation result as JSON.' },
];

function onboardingCliCommand(args: {
  command: string;
  title: string;
  summary: string;
  options: CliOptionMetadata[];
  install: NonNullable<CliCommandMetadata['install']>;
  extraGuidance?: Partial<AgentGuidance>;
}): CliCommandMetadata {
  return {
    ...cliCommand(
      args.command,
      args.title,
      args.summary,
      'configuration',
      args.options,
      args.extraGuidance
    ),
    lifecycle: 'experimental',
    install: args.install,
    verification: verify('npm test -- tests/unit/cli/onboarding-cli.test.ts'),
  };
}

export const cliCommands: CliCommandMetadata[] = [
  cliCommand(
    'analyze',
    'Analyze Project',
    'Analyze source code and generate architecture diagrams and query artifacts',
    'analysis',
    analyzeOptions,
    {
      followWith: ['archguard query --summary'],
      limitations: ['Analysis artifacts are static snapshots; rerun analyze after code changes.'],
    }
  ),
  cliCommand(
    'agent',
    'Agent Instructions',
    'Generate registry-derived instructions for Claude Code and Codex agents',
    'docs',
    [],
    {
      callFirst: ['archguard help --json'],
      freshness:
        'Reflects the current metadata registry in the installed ArchGuard build; rebuild after metadata changes.',
      limitations: [
        'This command is read-only and does not write Claude Code or Codex configuration files.',
      ],
    }
  ),
  cliCommand('cache', 'Cache Management', 'Manage ArchGuard cache operations', 'cache', []),
  cliCommand(
    'check',
    'Fitness Check',
    'Check architecture fitness rules against snapshots',
    'fitness',
    [
      {
        flags: '--config <path>',
        description: 'Config file path.',
        defaultValue: 'archguard.config.json',
      },
      {
        flags: '--output-dir <dir>',
        description: 'Snapshots directory.',
        defaultValue: '.archguard',
      },
    ]
  ),
  onboardingCliCommand({
    command: 'config',
    title: 'Agent Config Management',
    summary: 'Show and remove ArchGuard agent configuration',
    options: [
      {
        flags: '--scope <scope>',
        description: 'Config scope: user or project.',
        defaultValue: 'user',
      },
      { flags: '--home <dir>', description: 'Home directory override for user-scope config.' },
      {
        flags: '--project-root <dir>',
        description: 'Project root override for project-scope config.',
      },
      { flags: '--dry-run', description: 'Show planned removals without writing files.' },
      { flags: '--force', description: 'Required for non-dry-run removal.' },
      { flags: '--json', description: 'Emit config state or operation result as JSON.' },
    ],
    install: {
      provider: 'all',
      configScope: 'user',
      writesConfig: true,
      writesInstructions: false,
    },
    extraGuidance: {
      useWhen: ['Use config when inspecting or removing ArchGuard agent configuration.'],
      freshness: 'Reads Claude Code and Codex config files from disk at command runtime.',
      limitations: [
        'Use config doctor for MCP handshake validation after that command is available.',
      ],
    },
  }),
  cliCommand('diff', 'Metric Diff', 'Compare two architecture metric snapshots', 'metrics', [
    { flags: '--from <sha>', description: 'Source snapshot SHA prefix.' },
    { flags: '--to <sha>', description: 'Target snapshot SHA prefix.' },
    {
      flags: '--output-dir <dir>',
      description: 'Snapshots directory.',
      defaultValue: '.archguard',
    },
  ]),
  cliOnlyCommand(
    'help',
    'Structured Help',
    'Show registry-backed structured ArchGuard CLI help for agents',
    'docs',
    [{ flags: '--json', description: 'Emit structured help as JSON.' }],
    {
      useWhen: ['Use help when an agent needs the current ArchGuard CLI catalog.'],
      freshness:
        'Reflects the current metadata registry in the installed ArchGuard build; rebuild after metadata changes.',
      limitations: ['Structured help reports top-level commands and registry metadata.'],
    }
  ),
  cliCommand(
    'init',
    'Initialize Configuration',
    'Initialize an ArchGuard configuration file',
    'configuration',
    [
      {
        flags: '-f, --format <type>',
        description: 'Config file format.',
        defaultValue: 'json',
        allowedValues: ['json', 'js'],
      },
    ]
  ),
  onboardingCliCommand({
    command: 'install',
    title: 'Install Agent Integration',
    summary: 'Install ArchGuard MCP config and generated instructions for Claude Code or Codex',
    options: [
      ...onboardingOptions,
      { flags: '--force', description: 'Overwrite an existing divergent ArchGuard entry.' },
      { flags: '--mcp-only', description: 'Only write MCP server config.' },
      { flags: '--instructions-only', description: 'Only write generated instructions.' },
    ],
    install: {
      provider: 'all',
      configScope: 'user',
      writesConfig: true,
      writesInstructions: true,
    },
    extraGuidance: {
      useWhen: ['Use install when setting up ArchGuard for Claude Code or Codex.'],
      freshness:
        'Writes the current ArchGuard executable command and metadata-generated instructions.',
      limitations: ['Use --dry-run first when auditing planned changes.'],
    },
  }),
  cliCommand('mcp', 'MCP Server', 'Start the ArchGuard MCP server over stdio', 'mcp', []),
  cliCommand(
    'query',
    'Query Architecture',
    'Query architecture entities, relationships, metrics, tests, git history, and Atlas data',
    'query',
    queryOptions,
    {
      callFirst: ['archguard analyze'],
      limitations: ['Most query flags require existing .archguard/query artifacts.'],
    }
  ),
  onboardingCliCommand({
    command: 'update',
    title: 'Update Agent Integration',
    summary: 'Refresh existing ArchGuard agent configuration and generated instructions',
    options: [
      ...onboardingOptions,
      { flags: '--mcp-only', description: 'Only refresh MCP server config.' },
      { flags: '--instructions-only', description: 'Only refresh generated instructions.' },
    ],
    install: {
      provider: 'all',
      configScope: 'user',
      writesConfig: true,
      writesInstructions: true,
    },
    extraGuidance: {
      useWhen: ['Use update when an existing ArchGuard agent integration should be refreshed.'],
      freshness: 'Regenerates instructions from current metadata and refreshes config entries.',
      limitations: ['Use --instructions-only to avoid changing MCP server config.'],
    },
  }),
];

export const stagedCliCommands: CliCommandMetadata[] = [];

const queryMappings: QueryMappingMetadata[] = [
  ['archguard_summary', 'archguard query --summary'],
  ['archguard_find_entity', 'archguard query --entity <name>'],
  ['archguard_get_file_entities', 'archguard query --file <path>'],
  ['archguard_get_package_stats', 'archguard query --package-stats'],
  ['archguard_get_dependencies', 'archguard query --deps-of <name>'],
  ['archguard_get_dependents', 'archguard query --used-by <name>'],
  ['archguard_find_implementers', 'archguard query --implementers-of <name>'],
  ['archguard_find_subclasses', 'archguard query --subclasses-of <name>'],
  ['archguard_detect_cycles', 'archguard query --cycles'],
  ['archguard_get_atlas_layer', 'archguard query --atlas-layer <layer>'],
  ['archguard_detect_test_patterns', 'archguard query --test-patterns'],
  ['archguard_get_test_issues', 'archguard query --test-issues'],
  ['archguard_get_test_metrics', 'archguard query --test-metrics'],
  ['archguard_get_entity_coverage', 'archguard query --entity-coverage <entityId>'],
  ['archguard_get_package_fanin', 'archguard query --package-fanin'],
  ['archguard_get_package_fanout', 'archguard query --package-fanout'],
  ['archguard_detect_god_packages', 'archguard query --god-packages'],
  ['archguard_find_callers', 'archguard query --callers <entity>'],
  ['archguard_get_change_context', 'archguard query --change-context <path>'],
  ['archguard_get_cochange', 'archguard query --cochange <path>'],
  ['archguard_get_change_risk', 'archguard query --change-risk <path>'],
  ['archguard_get_ownership', 'archguard query --ownership <path>'],
].map(([mcpTool, cliEquivalent]) => ({ mcpTool, cliEquivalent, kind: 'query' }));

queryMappings.push(
  { mcpTool: 'archguard_analyze', cliEquivalent: 'archguard analyze', kind: 'analyze' },
  {
    mcpTool: 'archguard_analyze_git',
    cliEquivalent: 'archguard analyze --include-git',
    kind: 'analyze',
  }
);

function mappingFor(toolName: string): string | undefined {
  return queryMappings.find((mapping) => mapping.mcpTool === toolName)?.cliEquivalent;
}

const testAnalysisParameterDescriptions = {
  projectRoot: 'Project root (default: server startup cwd)',
  scope: 'Analysis scope key. Omit to use the widest available scope containing test data.',
};

const atlasAnalyticsParameterDescriptions = {
  scope: 'Query scope key. Omit to use manifest.globalScopeKey.',
};

function mcpTool(args: {
  toolName: string;
  title: string;
  summary: string;
  category: MetadataCategory;
  callFirst?: string[];
  followWith?: string[];
  limitations?: string[];
  parameters?: string[];
  parameterDescriptions?: Record<string, string>;
  requiredParameters?: string[];
  verification?: string;
  freshness?: string;
}): McpToolMetadata {
  const surfaces = ['mcp', 'docs', 'agent'] as const;
  const freshness = args.freshness ?? freshnessForCategory(args.category);
  return {
    id: args.toolName,
    title: args.title,
    summary: args.summary,
    category: args.category,
    surfaces: [...surfaces],
    agent: guidance({
      useWhen: [`Use ${args.toolName} to ${lowercaseFirst(args.summary)}`],
      avoidWhen: ['Use the CLI equivalent when a human needs terminal output instead of MCP JSON.'],
      callFirst: args.callFirst,
      followWith: args.followWith,
      recovery: [
        args.callFirst && args.callFirst.length > 0
          ? `If prerequisite data is missing, call ${args.callFirst.join(' and ')} and retry.`
          : 'If the result is empty, verify the target path/name and rerun analysis if code changed.',
      ],
      limitations: args.limitations,
      freshness,
    }),
    docs: docsForSurfaces(surfaces),
    examples: mcpExample(args.toolName, args.summary),
    verification: verify(args.verification ?? 'npm test -- tests/unit/cli/mcp/mcp-server.test.ts'),
    mcp: {
      toolName: args.toolName,
      description: args.summary,
      inputSchemaId: `${args.toolName}.input`,
      cliEquivalent: mappingFor(args.toolName),
      parameters: mcpParams(
        args.parameters ?? ['projectRoot'],
        args.parameterDescriptions,
        args.requiredParameters
      ),
    },
  };
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export const mcpTools: McpToolMetadata[] = [
  mcpTool({
    toolName: 'archguard_find_entity',
    title: 'Find Entity',
    summary: 'Find entities by name, type, or attribute filters.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    parameters: [
      'projectRoot',
      'scope',
      'name',
      'entityType',
      'attrFilter',
      'outputScope',
      'queryFormat',
      'verbose',
    ],
    parameterDescriptions: {
      name: 'Entity name to search for (exact match)',
    },
  }),
  mcpTool({
    toolName: 'archguard_get_dependencies',
    title: 'Get Dependencies',
    summary: 'Return direct and transitive dependencies for an entity.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    limitations: [
      'Call graph edges are not included; this tool reports structural dependencies only.',
      'For Go package-level dependencies, prefer archguard_get_atlas_layer.',
    ],
    parameters: ['projectRoot', 'scope', 'name', 'depth', 'outputScope', 'queryFormat', 'verbose'],
    requiredParameters: ['name'],
  }),
  mcpTool({
    toolName: 'archguard_get_dependents',
    title: 'Get Dependents',
    summary: 'Return entities that depend on a named entity.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    parameters: ['projectRoot', 'scope', 'name', 'depth', 'outputScope', 'queryFormat', 'verbose'],
    requiredParameters: ['name'],
  }),
  mcpTool({
    toolName: 'archguard_find_implementers',
    title: 'Find Implementers',
    summary: 'Find classes or structs implementing an interface.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    parameters: ['projectRoot', 'scope', 'name', 'outputScope', 'queryFormat', 'verbose'],
    requiredParameters: ['name'],
    parameterDescriptions: {
      name: 'Interface name',
    },
  }),
  mcpTool({
    toolName: 'archguard_find_subclasses',
    title: 'Find Subclasses',
    summary: 'Find subclasses of a class in object-oriented languages.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    limitations: ['Go has no class inheritance, so Go results are always empty.'],
    parameters: ['projectRoot', 'scope', 'name', 'outputScope', 'queryFormat', 'verbose'],
    requiredParameters: ['name'],
    parameterDescriptions: {
      name: 'Class name',
    },
  }),
  mcpTool({
    toolName: 'archguard_get_file_entities',
    title: 'File Entities',
    summary: 'Return entities defined in a specific source file.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    parameters: ['projectRoot', 'scope', 'filePath', 'outputScope', 'queryFormat', 'verbose'],
    requiredParameters: ['filePath'],
  }),
  mcpTool({
    toolName: 'archguard_detect_cycles',
    title: 'Detect Cycles',
    summary: 'Detect dependency cycles in analyzed architecture data.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    limitations: [
      'Valid Go projects cannot contain package import cycles, so package-level Go cycles are usually empty.',
    ],
    parameters: ['projectRoot', 'scope', 'outputScope', 'queryFormat'],
  }),
  mcpTool({
    toolName: 'archguard_summary',
    title: 'Summary',
    summary: 'Return pre-computed architecture counts, relation breakdowns, and top rankings.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    followWith: ['archguard_find_entity', 'archguard_get_dependencies'],
    limitations: [
      'Use this tool first for counting or ranking questions; do not enumerate other tool outputs to count manually.',
    ],
    parameters: ['projectRoot', 'scope', 'outputScope', 'queryFormat'],
  }),
  mcpTool({
    toolName: 'archguard_get_atlas_layer',
    title: 'Atlas Layer',
    summary:
      'Return a Go Atlas architecture layer such as package, capability, goroutine, or flow.',
    category: 'atlas',
    callFirst: atlasCallFirst,
    limitations: ['Requires Go Atlas analysis data from a Go project.'],
    parameters: ['projectRoot', 'scope', 'layer', 'format'],
    requiredParameters: ['layer'],
    parameterDescriptions: {
      format:
        'full: raw layer object as JSON (works for all layers). adjacency: simplified [{from, to, label}] edge list — not supported for the flow layer.',
    },
  }),
  mcpTool({
    toolName: 'archguard_get_package_stats',
    title: 'Package Stats',
    summary: 'Return per-package file, entity, method, and approximate line metrics.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    parameters: [
      'projectRoot',
      'scope',
      'depth',
      'sortBy',
      'minFileCount',
      'minLoc',
      'topN',
      'outputScope',
      'queryFormat',
    ],
    parameterDescriptions: {
      depth:
        'Directory depth for package grouping. Applies to Java, Python, and C++ only; ignored for Go (module-defined packages) and TypeScript (directory-based modules).',
    },
  }),
  mcpTool({
    toolName: 'archguard_analyze',
    title: 'Analyze',
    summary: 'Analyze project sources and refresh ArchGuard query artifacts.',
    category: 'analysis',
    followWith: ['archguard_summary'],
    limitations: [
      'Writes analysis artifacts under the selected work directory.',
      'Use the lang parameter to override code-language plugin detection when auto-detect is wrong.',
    ],
    parameters: [
      'projectRoot',
      'sources',
      'lang',
      'diagrams',
      'format',
      'noCache',
      'includeTests',
      'testsOnly',
      'includeGit',
    ],
    verification: 'npm test -- tests/unit/cli/mcp/analyze-tool.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_detect_test_patterns',
    title: 'Detect Test Patterns',
    summary: 'Detect test frameworks and convention hints before reading test metrics or issues.',
    category: 'test-analysis',
    callFirst: ['archguard_analyze'],
    followWith: ['archguard_get_test_metrics', 'archguard_get_test_issues'],
    limitations: ['Package manifest detection is partial until test analysis artifacts exist.'],
    parameters: ['projectRoot', 'scope'],
    parameterDescriptions: testAnalysisParameterDescriptions,
    verification: 'npm test -- tests/unit/cli/mcp/test-analysis-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_test_issues',
    title: 'Test Issues',
    summary:
      'Return static-analysis test quality issues such as orphan tests, zero assertions, and skips.',
    category: 'test-analysis',
    callFirst: testAnalysisCallFirst,
    limitations: [
      'Static test quality checks may produce false positives with aliases or custom helpers.',
    ],
    parameters: ['projectRoot', 'scope', 'patternConfig', 'severity'],
    parameterDescriptions: testAnalysisParameterDescriptions,
    verification: 'npm test -- tests/unit/cli/mcp/test-analysis-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_test_metrics',
    title: 'Test Metrics',
    summary: 'Return test suite metrics and optional package coverage breakdowns.',
    category: 'test-analysis',
    callFirst: testAnalysisCallFirst,
    limitations: ['Coverage is inferred from static matching, not runtime tracing.'],
    parameters: ['projectRoot', 'scope', 'patternConfig', 'includePackageBreakdown'],
    parameterDescriptions: testAnalysisParameterDescriptions,
    verification: 'npm test -- tests/unit/cli/mcp/test-analysis-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_entity_coverage',
    title: 'Entity Coverage',
    summary: 'Return inferred coverage details for a single source entity.',
    category: 'test-analysis',
    callFirst: testAnalysisCallFirst,
    limitations: ['Unknown entity IDs return found:false and may indicate stale analysis.'],
    parameters: ['projectRoot', 'entityId'],
    requiredParameters: ['entityId'],
    verification: 'npm test -- tests/unit/cli/mcp/test-analysis-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_analyze_git',
    title: 'Analyze Git History',
    summary: 'Analyze git history and write churn, co-change, risk, and ownership artifacts.',
    category: 'git-history',
    followWith: ['archguard_get_change_context'],
    limitations: ['Requires a git repository and reflects the selected time window.'],
    parameters: [
      'projectRoot',
      'sinceDays',
      'maxCommits',
      'includeMerges',
      'granularities',
      'packageDepth',
    ],
    parameterDescriptions: {
      projectRoot:
        'Root directory of the git repository to analyze. Defaults to the MCP server startup cwd.',
    },
    verification: 'npm test -- tests/unit/cli/mcp/git-history-analyze-tool.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_change_context',
    title: 'Change Context',
    summary:
      'Return churn, ownership, co-change, and risk context for a file or package before editing.',
    category: 'git-history',
    callFirst: gitHistoryCallFirst,
    limitations: ['Rename and entity-level tracking are not supported in v1.'],
    parameters: ['projectRoot', 'targetType', 'target'],
    requiredParameters: ['targetType', 'target'],
    parameterDescriptions: {
      target: 'Package path or file path to query (e.g. "src/cli" or "src/cli/mcp/mcp-server.ts").',
    },
    verification: 'npm test -- tests/unit/cli/mcp/git-history-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_cochange',
    title: 'Co-change',
    summary: 'Return strongest co-change neighbors for a file or package.',
    category: 'git-history',
    callFirst: gitHistoryCallFirst,
    limitations: ['Co-change is evolutionary, not a runtime or static dependency.'],
    parameters: ['projectRoot', 'targetType', 'target', 'topN'],
    requiredParameters: ['targetType', 'target'],
    parameterDescriptions: {
      topN: 'Maximum number of co-change neighbors to return (default: 10, max: 20).',
    },
    verification: 'npm test -- tests/unit/cli/mcp/git-history-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_change_risk',
    title: 'Change Risk',
    summary: 'Return an explainable heuristic risk score for changing a file or package.',
    category: 'git-history',
    callFirst: gitHistoryCallFirst,
    limitations: ['Risk is heuristic and not a predictive defect model.'],
    parameters: ['projectRoot', 'targetType', 'target'],
    requiredParameters: ['targetType', 'target'],
    verification: 'npm test -- tests/unit/cli/mcp/git-history-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_ownership',
    title: 'Ownership',
    summary: 'Return maintainer concentration and bus-factor proxy data for a file or package.',
    category: 'git-history',
    callFirst: gitHistoryCallFirst,
    limitations: ['Ownership reflects the analyzed time window only.'],
    parameters: ['projectRoot', 'targetType', 'target'],
    requiredParameters: ['targetType', 'target'],
    verification: 'npm test -- tests/unit/cli/mcp/git-history-mcp.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_find_callers',
    title: 'Find Callers',
    summary: 'Return direct and transitive callers of an entity or method from static call edges.',
    category: 'query',
    callFirst: queryArtifactCallFirst,
    limitations: [
      'Approximate precision varies by language: TypeScript about 85%, Go about 90%, Java about 60%, Python about 40%.',
      'Dynamic dispatch, callbacks, and reflection are not fully resolved.',
    ],
    parameters: ['projectRoot', 'entityName', 'depth'],
    requiredParameters: ['entityName'],
    parameterDescriptions: {
      depth: 'BFS depth (1–5, default: 1). Values outside range are clamped.',
    },
    verification: 'npm test -- tests/unit/cli/mcp/call-graph-tools.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_package_fanin',
    title: 'Package Fan-in',
    summary: 'List Go Atlas packages ranked by incoming package dependencies.',
    category: 'atlas',
    callFirst: atlasCallFirst,
    limitations: ['Requires Go Atlas package-layer data.'],
    parameters: ['projectRoot', 'scope', 'minFanIn', 'limit'],
    parameterDescriptions: atlasAnalyticsParameterDescriptions,
    verification: 'npm test -- tests/unit/cli/mcp/atlas-analytics-tools.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_get_package_fanout',
    title: 'Package Fan-out',
    summary: 'List Go Atlas packages ranked by outgoing package dependencies.',
    category: 'atlas',
    callFirst: atlasCallFirst,
    limitations: ['Requires Go Atlas package-layer data.'],
    parameters: ['projectRoot', 'scope', 'minFanOut', 'limit'],
    parameterDescriptions: atlasAnalyticsParameterDescriptions,
    verification: 'npm test -- tests/unit/cli/mcp/atlas-analytics-tools.test.ts',
  }),
  mcpTool({
    toolName: 'archguard_detect_god_packages',
    title: 'Detect God Packages',
    summary: 'Detect Go Atlas packages that exceed coupling, file, struct, or function thresholds.',
    category: 'atlas',
    callFirst: atlasCallFirst,
    limitations: ['Requires Go Atlas package-layer data and uses threshold heuristics.'],
    parameters: ['projectRoot', 'scope', 'minFanIn', 'minStructs', 'minFunctions', 'minFiles'],
    parameterDescriptions: {
      ...atlasAnalyticsParameterDescriptions,
      minFanIn: 'Fan-in threshold — packages at or above this value are flagged (default: 5).',
    },
    verification: 'npm test -- tests/unit/cli/mcp/atlas-analytics-tools.test.ts',
  }),
];

export const archGuardMetadataRegistry: ArchGuardMetadataRegistry = {
  cliCommands,
  stagedCliCommands,
  mcpTools,
  queryMappings,
};
