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
# Build and analyze ArchGuard itself (auto-detects structure, generates 3-tier diagrams)
npm run build
node dist/cli/index.js analyze -v

# Analyze specific external project
node dist/cli/index.js analyze -s /path/to/project/src
```

## Using ArchGuard

### Basic Usage
```bash
# Analyze current project (auto-detects structure → 3-tier diagrams: package/class/method)
npm run build
node dist/cli/index.js analyze -v

# Analyze an external project (output goes to <project>/.archguard automatically)
node dist/cli/index.js analyze -s /home/user/work/my-project/src

# Generate ArchJSON only (no LLM required, fast)
node dist/cli/index.js analyze -f json

# Custom output directory
node dist/cli/index.js analyze --output-dir ./diagrams
```

### Advanced Usage

#### Filtering Diagram Levels
Use `--diagrams` to select which levels to generate (default: all):
```bash
# Only package and class diagrams
node dist/cli/index.js analyze --diagrams package class

# Only method-level diagrams
node dist/cli/index.js analyze -s ./src --diagrams method

# Single level for external project
node dist/cli/index.js analyze -s /path/to/project --diagrams class
```

#### Mermaid Themes
```bash
node dist/cli/index.js analyze --mermaid-theme dark
node dist/cli/index.js analyze --mermaid-theme forest
```

#### Language Selection
```bash
# Auto-detect language (default: TypeScript)
node dist/cli/index.js analyze -s ./src

# Explicitly specify language
node dist/cli/index.js analyze -s ./src --lang typescript
node dist/cli/index.js analyze -s ./src --lang go        # Atlas mode ON by default (levels: package/capability/goroutine/flow)
node dist/cli/index.js analyze -s ./src --lang go --no-atlas  # Standard Go parsing
node dist/cli/index.js analyze -s ./src --lang java
node dist/cli/index.js analyze -s ./src --lang python
node dist/cli/index.js analyze -s ./src --lang kotlin
```

#### Multiple Diagram Generation via Config File
```bash
# archguard.config.json
{
  "diagrams": [
    { "name": "overview/package", "sources": ["./src"], "level": "package" },
    { "name": "class/all-classes", "sources": ["./src"], "level": "class" },
    { "name": "method/frontend", "sources": ["./src/frontend"], "level": "method" }
  ]
}

# Generate all diagrams
node dist/cli/index.js analyze

# Filter by level
node dist/cli/index.js analyze --diagrams class method
```

### Available Commands

#### analyze
Analyze TypeScript project and generate architecture diagrams.

**Configuration File**:
- `--config <path>` - Config file path (default: `archguard.config.json`)
- `--diagrams <levels...>` - Filter by level: `package`|`class`|`method` (language-dependent; default: all)

**Source Selection**:
- `-s, --sources <paths...>` - Source directory; triggers auto-detection of project structure → multi-diagram output. When path is outside CWD, output defaults to `<project>/.archguard`

**Global Config Overrides**:
- `-f, --format <type>` - Output format: `mermaid`|`json` (default: `mermaid`)
- `--output-dir <dir>` - Output directory for diagrams (default: `./.archguard`)
- `-e, --exclude <patterns...>` - Exclude patterns
- `--no-cache` - Disable cache
- `--mermaid-theme <theme>` - Mermaid theme: `default`|`forest`|`dark`|`neutral`
- `-c, --concurrency <num>` - Parallel parsing concurrency (default: CPU cores)
- `-v, --verbose` - Verbose output
- `--lang <language>` - Language plugin: `typescript`|`go`|`java`|`python`|`cpp`|`kotlin`

**Claude CLI Configuration**:
- `--cli-command <command>` - Claude CLI command to use (default: `claude`)
- `--cli-args <args>` - Additional CLI arguments (space-separated)

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

### Output Formats

**Mermaid** (default):
- For TypeScript: generates 3-tier diagram set in `.archguard/` (overview/package, class/all-classes, method/* per module) + `index.md`
- For Go (Atlas): generates 4-layer set (package, capability, goroutine, flow) in `.archguard/`
- No external dependencies required
- Supports local rendering with isomorphic-mermaid

**JSON** (ArchJSON):
- Fast parsing-only mode for tooling integration
- Example: `node dist/cli/index.js analyze -f json -o ./arch.json`
- Structure:
  ```json
  {
    "version": "1.0",
    "language": "typescript",
    "entities": [{"name": "Class", "type": "class", "methods": [...]}],
    "relations": [{"from": "A", "to": "B", "type": "dependency"}]
  }
  ```

### Prerequisites

**For Mermaid format**: No external dependencies required (uses built-in isomorphic-mermaid).

## Language Support

ArchGuard supports multiple programming languages through its plugin system:

| Language | Status | Features |
|----------|--------|----------|
| TypeScript | Stable | Full support, dependency extraction |
| Go | Stable | Tree-sitter + gopls, interface detection |
| Java | Beta | Tree-sitter, Maven/Gradle deps |
| Python | Beta | Tree-sitter, pip/Poetry deps |
| C++ | Beta | Tree-sitter, CMake deps |
| Kotlin/Android | Beta | Tree-sitter, build.gradle.kts deps |

### Adding Language Support

To add a new language, create a plugin implementing `ILanguagePlugin`. See [Plugin Development Guide](docs/dev-guide/plugin-development-guide.md).

### Using Language Plugins

```bash
# Auto-detect language (default)
node dist/cli/index.js analyze -s ./src

# Explicitly specify language
node dist/cli/index.js analyze -s ./src --lang typescript
node dist/cli/index.js analyze -s ./src --lang go        # Atlas mode ON by default
node dist/cli/index.js analyze -s ./src --lang go --no-atlas  # Standard mode opt-out
node dist/cli/index.js analyze -s ./src --lang java
node dist/cli/index.js analyze -s ./src --lang python
node dist/cli/index.js analyze -s ./src --lang kotlin
```

### Plugin Registry

ArchGuard uses a plugin registry to manage language support. Plugins can be:
- **Built-in**: TypeScript, Go, Java, Python, C++, Kotlin plugins included
- **External**: Load third-party plugins via configuration

See [Plugin Registry Documentation](docs/user-guide/plugin-registry.md) for details.

## Architecture Overview

Three-layer architecture:
1. **Parser** (`src/parser/`) - TypeScriptParser → Extractors → ArchJSON
2. **Mermaid** (`src/mermaid/`) - MermaidGenerator → Renderer → SVG/PNG
3. **CLI** (`src/cli/`) - Commands (analyze, init, cache) with ErrorHandler

**Data Flow**: `TypeScript → AST → ArchJSON → Mermaid/SVG/PNG`

**Key Components**:
- ParallelParser: Concurrent file processing
- MermaidGenerator: Local Mermaid generation with validation
- RenderWorkerPool: Parallel diagram rendering via Worker Threads
- ErrorHandler: Unified error formatting

## Configuration

Create `archguard.config.json` (run `node dist/cli/index.js init`):

```json
{
  "source": "./src",
  "format": "mermaid",           // mermaid | json
  "exclude": ["**/*.test.ts", "**/*.spec.ts"],
  "mermaid": {
    "enableLLMGrouping": true,   // Use LLM for intelligent grouping
    "renderer": "isomorphic",    // isomorphic | cli
    "theme": "default",          // default | forest | dark | neutral
    "transparentBackground": true
  },
  "cli": { "timeout": 180000 },   // 3min for large projects (30+ files)
  "cache": { "enabled": true },
  "concurrency": 8,
  "verbose": false
}
```

**Tips**: Use `format: "json"` for fast ArchJSON-only mode (no LLM required).

## Path Aliases (TypeScript)
When importing, use these aliases instead of relative paths:
- `@/parser` → `src/parser`
- `@/cli` → `src/cli`
- `@/types` → `src/types`
- `@/utils` → `src/utils`
- `@/core` → `src/core`
- `@/analysis` → `src/analysis`

## Testing Patterns

- **Unit**: `tests/unit/` - Vitest with mocked dependencies
- **Integration**: `tests/integration/` - Use `skip-helper.ts` to skip when Claude CLI unavailable
- **E2E**: `tests/integration/e2e/` - Full workflows

## Development Workflow

1. **Make changes** to source code
2. **Run tests**: `npm test` (ensure 1936+ tests pass)
3. **Type check**: `npm run type-check`
4. **Lint**: `npm run lint` and `npm run lint:fix`
5. **Build**: `npm run build`
6. **Self-validate**: `node dist/cli/index.js analyze -v`
7. **After rebuilding with new MCP tools**: Run `/mcp` → Reconnect in Claude Code to reload MCP tool definitions in the current session.

## CLI/MCP Metadata Registry Rule

When adding or changing a CLI command, query option, MCP tool, or agent onboarding surface, treat `src/cli/metadata/registry.ts` as the source of truth. Do not add runtime command/tool behavior without updating the registry-driven metadata, generated docs, structured help, and drift tests.

Required pattern:
- Add top-level CLI commands to `cliCommandBaseline` and `cliCommands`.
- Add query CLI options to `queryOptions` with `mapsToMcpTool` when they expose an MCP-equivalent operation.
- Add MCP tools to `mcpToolBaseline` and `mcpTools`.
- Add MCP tools to `workflowDependentMcpTools` when they require analysis, git-history, test-analysis, Atlas, or other prerequisite artifacts.
- Add `queryMappings` only when a real `archguard query ...` CLI option exists. Do not invent a CLI equivalent for MCP-only or agent-only tools.
- Use `mcpToolDescription()` and `mcpParamDescription()` in MCP registration code so listTools descriptions and schema parameter docs come from the registry.
- Keep generated docs in sync with `npm run build && npm run docs:write`.

Validation for registry-affecting changes:
```bash
npm run build
npm run type-check
npm run docs:check
npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/mcp/mcp-metadata-drift.test.ts
npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts
```

## Project-Specific Patterns

### Error Handling
Use unified error handling with custom error classes:

```typescript
import { ErrorHandler } from '@/cli/error-handler.js';
import { ParseError, ValidationError, APIError, FileError } from '@/cli/errors.js';

try {
  // Your code
} catch (error) {
  const errorHandler = new ErrorHandler();
  console.error(errorHandler.format(error, { verbose: options.verbose }));
  process.exit(1);
}
```

**Best Practices**: Use specific error types (ParseError, ValidationError) with ErrorHandler.format()

### Progress Reporting
```typescript
import { ProgressReporter } from '@/cli/progress.js';
const progress = new ProgressReporter();
progress.start('Processing...');
progress.succeed('Done');
```

### File Operations
- Use `fs-extra` for file I/O
- Clean up temp files in `finally` blocks

## Performance

- **Caching**: SHA-256 file hashing (`src/cli/cache-manager.ts`)
- **Parallel Parsing**: Configurable concurrency (default: CPU cores)
- **Targets**: <10s for 30 files, ~4 files/sec, <300MB memory

## Autonomous Task Queue

Tasks are created by skills and executed autonomously by the L0 worker:

```bash
/backlog-setup                          # one-time: initialize Kanban columns
/feature-to-backlog <feature>           # dev task: TDD plan + proposal/plan docs
/task-to-backlog <topic>                # non-dev task: analysis, docs, research
backlog task edit TASK-N --status Ready # approve and queue
/loop-backlog                           # start worker (self-schedules until session ends)
```

See `docs/dev-guide/backlog-workflow.md` for the full guide (columns, failure
handling, worktree layout, configuration).

### L0 Config (optional)

Add to `CLAUDE.md` to override auto-detected defaults:

```markdown
## L0 Config

test-cmd: npm test -- --run     # per-phase test runner
test-all: npm test              # full suite
worktree-symlinks: node_modules # dirs to symlink into worktree
doc-path: docs                  # root for proposals/ and plans/
```

Without this section, skills auto-detect from `package.json` / `go.mod` /
`Cargo.toml` / `pyproject.toml`.

## Documentation

- `docs/dev-guide/architecture.md` - System architecture
- `docs/dev-guide/specs.md` - Requirements and specifications
- `docs/dev-guide/backlog-workflow.md` - Autonomous task queue guide
- `docs/user-guide/migration-v2.0.md` - Migration guide from PlantUML to Mermaid
