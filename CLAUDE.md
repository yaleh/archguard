# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Building
```bash
npm run build              # Full build: tsc → tsc-alias → fix imports
npm run dev                # Watch mode for development
```

### Testing
```bash
npm test                   # Run all tests (vitest)
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage report
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e           # E2E tests only
```

### Running Individual Tests
```bash
# Run a specific test file
npx vitest run tests/unit/parser/typescript-parser.test.ts

# Run tests matching a pattern
npx vitest run --grep "should parse"

# Run tests in a specific directory
npx vitest run tests/unit/parser
```

### Code Quality
```bash
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix lint issues
npm run format             # Prettier format
npm run format:check       # Check formatting
npm run type-check         # TypeScript type check
```

### Self-Validation
```bash
# Build and analyze ArchGuard itself
npm run build
node dist/cli/index.js analyze -v
```

## Using ArchGuard

### Basic Usage
```bash
# Analyze a TypeScript project (using archguard.config.json)
npm run build
node dist/cli/index.js analyze

# With verbose output
node dist/cli/index.js analyze -v

# Specify source and output directory
node dist/cli/index.js analyze -s ./src --output-dir ./diagrams

# Generate JSON instead of PlantUML
node dist/cli/index.js analyze -f json -o ./output.json
```

### Available Commands

#### analyze
Analyze TypeScript project and generate architecture diagrams.

**Options**:
- `-s, --source <path>` - Source directory to analyze (default: `./src`)
- `-o, --output <path>` - Output file path
- `-f, --format <type>` - Output format: `plantuml`, `json`, or `svg` (default: `plantuml`)
- `-e, --exclude <patterns...>` - Exclude patterns
- `--no-cache` - Disable cache
- `-c, --concurrency <num>` - Parallel parsing concurrency (default: CPU cores)
- `-v, --verbose` - Verbose output
- `--cli-command <command>` - Claude CLI command to use (default: `claude`)
- `--cli-args <args>` - Additional CLI arguments (space-separated)
- `--output-dir <dir>` - Output directory for diagrams (default: `./archguard`)

#### init
Initialize configuration file.

```bash
node dist/cli/index.js init
```

Creates `archguard.config.json` with default settings.

#### cache
Manage cache operations.

```bash
# Clear all cached data
node dist/cli/index.js cache clear

# Show cache statistics
node dist/cli/index.js cache stats
```

### Generated Artifacts

When running `analyze` command with PlantUML format, ArchGuard generates:

- **`archguard/architecture.puml`** - PlantUML source file
- **`archguard/architecture.png`** - Rendered PNG diagram

The output directory can be changed with `--output-dir` option or `outputDir` in config file.

### Prerequisites

**Required**: Claude Code CLI must be installed and configured.

```bash
# Verify Claude Code CLI is available
claude --version

# If not installed, visit: https://docs.anthropic.com/claude-code
```

## Architecture Overview

ArchGuard is a TypeScript architecture analysis tool that generates PlantUML diagrams using Claude Code CLI. The project follows a three-layer architecture:

### Layer 1: Parser Layer (`src/parser/`)
- **TypeScriptParser**: Uses ts-morph to parse TypeScript files and extract AST
- **Extractors**: ClassExtractor, InterfaceExtractor, EnumExtractor, DecoratorExtractor, MemberExtractor
- **RelationExtractor**: Identifies inheritance, composition, and dependency relationships
- **ParallelParser**: Concurrent file processing with configurable concurrency

**Key Data Flow**:
```
TypeScript Source → AST → Entities (classes, interfaces, enums) → Relations → ArchJSON
```

**ArchJSON Structure**:
```typescript
{
  version: "1.0",
  language: "typescript",
  sourceFiles: string[],
  entities: Entity[] (name, type, decorators, methods, properties),
  relations: Relation[] (from, to, type: inheritance|composition|dependency)
}
```

### Layer 2: CLI Integration Layer (`src/ai/`)
- **ClaudeCodeWrapper**: Main wrapper for Claude Code CLI invocation
  - Manages temporary files for prompt/output
  - Handles retry logic (exponential backoff: 1s, 2s, 4s)
  - Error classification (CLI_NOT_FOUND, TIMEOUT, VALIDATION_ERROR, etc.)
- **PromptTemplateManager**: Loads and renders prompt templates from `prompts/` directory
  - Variable substitution: `{{ARCH_JSON}}`, `{{PREVIOUS_PUML}}`
  - Conditional blocks: `{{#if VAR}}...{{else}}...{{/if}}`
  - Template caching for performance
- **OutputParser**: Extracts PlantUML from CLI output
  - Supports markdown code blocks, raw PlantUML, mixed content
  - Validates syntax (@startuml/@enduml markers)
- **PlantUMLGenerator**: Orchestrates the generation pipeline
  - Uses ClaudeCodeWrapper for CLI invocation
  - Uses PlantUMLValidator for output validation

### Layer 3: Command Layer (`src/cli/`)
- **analyze command**: Main CLI entry point via commander.js
  - Checks Claude Code CLI availability before generation
  - Supports both JSON and PlantUML output formats
  - Progress reporting with ora spinners
  - Configuration file support (.archguardrc, archguard.config.json)

## PlantUML Generation Flow

1. **Parse**: TypeScript code → ArchJSON (via TypeScriptParser)
2. **Build Prompt**: Load template from `prompts/class-diagram.txt`, substitute variables
3. **Create Temp Files**: `/tmp/archguard-xxxxx/prompt.txt` and `output.puml`
4. **Call CLI**: `claude-code --prompt-file prompt.txt --output output.puml --no-interactive`
5. **Parse Output**: Extract PlantUML from CLI response (supports multiple formats)
6. **Validate**: Check syntax and completeness (all entities present)
7. **Cleanup**: Remove temporary files

**Critical**: ArchGuard does NOT use Anthropic API directly. It requires Claude Code CLI to be installed and configured separately. The tool checks for CLI availability before attempting generation.

## Configuration

### Project Config (`archguard.config.json`)
```json
{
  "source": "./src",              // Source directory to analyze (default: ./src)
  "output": "./architecture.puml", // Output file path (default: auto-generated)
  "outputDir": "./archguard",     // Output directory for diagrams (default: ./archguard)
  "format": "plantuml",           // Output format: plantuml | json | svg (default: plantuml)
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ],
  "cli": {
    "command": "claude",          // Claude CLI command (default: claude)
    "timeout": 180000,            // CLI timeout in ms (default: 60000, 3 minutes recommended for large projects)
    "args": []                    // Additional CLI arguments (optional)
  },
  "cache": {
    "enabled": true,              // Enable caching (default: true)
    "ttl": 86400                  // Cache TTL in seconds (default: 24 hours)
  },
  "concurrency": 8,               // Parallel parsing concurrency (default: CPU cores)
  "verbose": false                // Verbose output (default: false)
}
```

**Important**:
- The `ai.apiKey` field has been removed. Claude Code CLI handles authentication.
- For large projects (30+ files), increase `cli.timeout` to 180000ms (3 minutes) to avoid timeouts.
- Use `outputDir` to specify where diagrams should be saved (default: `./archguard`).

## Path Aliases (TypeScript)
When importing, use these aliases instead of relative paths:
- `@/parser` → `src/parser`
- `@/cli` → `src/cli`
- `@/ai` → `src/ai`
- `@/types` → `src/types`
- `@/utils` → `src/utils`

## Testing Patterns

### Unit Tests
- Located in `tests/unit/`
- Use Vitest with `describe`, `it`, `expect`, `beforeEach`
- Mock external dependencies (fs, execa for CLI calls)
- Test files named `*.test.ts`

### Integration Tests
- Located in `tests/integration/`
- Use `skip-helper.ts` to skip tests when Claude Code CLI is unavailable
- Pattern:
```typescript
import { skipIfNoClaudeCode } from './skip-helper.js';

describe.skipIf = skipIfNoClaudeCode().skip
describe('Integration Test', () => {
  // Tests that require Claude Code CLI
});
```

### E2E Tests
- Located in `tests/integration/e2e/`
- Test complete workflows from CLI to output
- Use real project analysis (self-validation)

## Recent Migration (January 2025)

The project completed a major migration from `@anthropic-ai/sdk` (direct API calls) to Claude Code CLI integration:

**What Changed**:
- Removed: `ANTHROPIC_API_KEY` environment variable requirement
- Removed: `ai.apiKey` from configuration schema
- Added: Claude Code CLI as external dependency
- Simplified: PlantUMLGenerator reduced from 160 to 62 lines (-61%)

**Key Files from Migration**:
- `src/ai/claude-code-wrapper.ts` - CLI wrapper (356 lines)
- `src/ai/output-parser.ts` - Output parser (181 lines)
- `src/ai/prompt-template-manager.ts` - Template manager (155 lines)
- `src/utils/cli-detector.ts` - CLI detection (104 lines)
- `prompts/class-diagram.txt` - Chinese prompt template

**Removed**: Old API-based implementation (claude-connector.ts, cost-tracker.ts, prompt-builder.ts) has been removed as CLI integration is now stable.

## Development Workflow

1. **Make changes** to source code
2. **Run tests**: `npm test` (ensure 370+ tests pass)
3. **Type check**: `npm run type-check`
4. **Lint**: `npm run lint` and `npm run lint:fix`
5. **Build**: `npm run build`
6. **Self-validate**: `node dist/cli/index.js analyze -v`

## Project-Specific Patterns

### Error Handling
ArchGuard uses a unified error handling system with custom error classes:

**Error Classes** (`src/cli/errors.ts`):
- **ParseError**: TypeScript parsing errors (includes file path and line number)
- **APIError**: Claude Code CLI invocation errors
- **ValidationError**: Configuration and input validation errors
- **FileError**: File system operation errors

**ErrorHandler** (`src/cli/error-handler.ts`):
- Unified error formatting with color-coded output
- Intelligent suggestions based on error type
- Verbose mode for detailed debugging
- File location information for parse errors

**Usage Pattern**:
```typescript
import { ErrorHandler } from '@/cli/error-handler.js';
import { ParseError } from '@/cli/errors.js';

try {
  // Your code here
} catch (error) {
  const errorHandler = new ErrorHandler();
  console.error(errorHandler.format(error, { verbose: options.verbose }));
  process.exit(1);
}
```

**Best Practices**:
- Use specific error classes (ParseError, ValidationError, etc.) instead of generic Error
- Always use ErrorHandler.format() for consistent user-facing error messages
- Include file paths and line numbers for parsing errors
- Provide actionable suggestions in error messages
- CLI errors should suggest Claude Code installation if CLI is not available

### Progress Reporting
Use `ProgressReporter` from `src/cli/progress.ts`:
```typescript
progress.start('Processing...');
progress.update(completed, total);  // Shows percentage
progress.succeed('Done');
progress.fail('Failed');
```

### File Operations
- Use `fs-extra` for all file operations
- Use `path.join()` for cross-platform paths
- Clean up temp files in `finally` blocks

### CLI Detection Pattern
Always check for Claude Code CLI before attempting generation:
```typescript
import { isClaudeCodeAvailable } from '@/utils/cli-detector.js';

const available = await isClaudeCodeAvailable();
if (!available) {
  throw new Error('Claude Code CLI not found...');
}
```

## Performance Considerations

- **Caching**: SHA-256 based file hashing in `src/cli/cache-manager.ts`
- **Parallel Parsing**: Configurable concurrency (default: CPU cores)
- **Targets**: < 10s for ArchGuard self-analysis, 300MB memory limit
- **Throughput**: ~4 files/sec

## Documentation

- **Architecture**: `docs/architecture.md` - System architecture and workflow
- **Specs**: `docs/specs.md` - Requirements and feature specifications
- **PlantUML Flow**: `docs/PLANTUML-GENERATION-FLOW.md` - Detailed generation process
- **Migration**: `MIGRATION-COMPLETE.md` - Complete migration report
