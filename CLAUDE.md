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
node dist/cli/index.js analyze -s ./src --lang dart
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
Analyze source code and generate architecture diagrams (multi-language).

**Configuration File**:
- `--config <path>` - Config file path (default: `archguard.config.json`)
- `--diagrams <levels...>` - Filter by level: `package`|`class`|`method` (language-dependent; default: all)

**Source Selection**:
- `-s, --sources <paths...>` - Source directory; triggers auto-detection of project structure → multi-diagram output. When path is outside CWD, output defaults to `<project>/.archguard`

**Global Config Overrides**:
- `-f, --format <type>` - Output format: `mermaid`|`json` (default: `mermaid`)
- `--work-dir <dir>` - ArchGuard work directory (default: `./.archguard`)
- `--cache-dir <dir>` - Cache directory (default: `<work-dir>/cache`)
- `--output-dir <dir>` - Output directory for diagrams (default: `./.archguard/output`; files written directly at `<dir>` when set)
- `-e, --exclude <patterns...>` - Exclude patterns
- `--no-cache` - Disable cache
- `--mermaid-theme <theme>` - Mermaid theme: `default`|`forest`|`dark`|`neutral`
- `--mermaid-renderer <renderer>` - Mermaid renderer: `isomorphic`|`cli`
- `-c, --concurrency <num>` - Parallel parsing concurrency (default: CPU cores)
- `-v, --verbose` - Verbose output
- `--lang <language>` - Language plugin: `typescript`|`go`|`java`|`python`|`cpp`|`kotlin`|`dart`

**Claude CLI Configuration**:
- `--cli-command <command>` - Claude CLI command to use (default: `claude`)
- `--cli-args <args>` - Additional CLI arguments (space-separated)

**Test Analysis**:
- `--include-tests` - Include test-system analysis (enables `query --test-*` / MCP test tools)
- `--tests-only` - Only run test analysis (uses cached ArchJSON, skips diagram generation)
- `--include-git` - Also analyze git history (writes artifacts to `<work-dir>/query/git-history/`)

**Go Architecture Atlas** (only with `--lang go`):
- `--atlas-layers <layers>` - Comma-separated: `package,capability,goroutine,flow` (default: all)
- `--atlas-strategy <strategy>` - `none`|`selective`|`full`
- `--atlas-protocols <protocols>` - Flow protocols: `http,grpc,cli,message,scheduler`
- `--atlas-entry-pattern <pattern>` - Regex for custom entry-point detection
- `--atlas-capability-mode <mode>` - `interface` (default) | `full`
- `--atlas-no-tests` / `--atlas-include-tests` - Test-package inclusion override
- `--gim` - Write GIM direction hint to `.archguard/gim/direction.json`

**Architecture Health**:
- `--arch-health` - Compute + persist intrinsic dimension (d_int) to `.archguard/arch-health-history.json`
- `--drift-base <commit>` - Drift baseline commit; CI gate exit codes (0=ok, 1=drift≥threshold, 2=invalid commit)
- `--drift-threshold <n>` - Drift gate threshold (default: `3.0`)

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

#### query
Query entities/relations from a previously-analyzed `.archguard`. One primary option
per invocation — parity with the MCP tools (ADR-007).

```bash
# Entity / relation discovery
node dist/cli/index.js query --entity com.acme.Foo
node dist/cli/index.js query --deps-of com.acme.Foo --depth 2
node dist/cli/index.js query --used-by com.acme.Foo
node dist/cli/index.js query --callers com.acme.Foo --callers-depth 2
node dist/cli/index.js query --cycles --summary

# Structural discovery / attributes
node dist/cli/index.js query --type class --high-coupling --threshold 10
node dist/cli/index.js query --orphans
node dist/cli/index.js query --attr "level=public"
node dist/cli/index.js query --package-stats --package-stats-sort-by loc
node dist/cli/index.js query --list-scopes

# Language / analysis-specific (mirror MCP tools)
node dist/cli/index.js query --atlas-layer package       # Go Atlas (--lang go)
node dist/cli/index.js query --god-classes                # Dart only (--lang dart)
node dist/cli/index.js query --test-patterns              # requires --include-tests
node dist/cli/index.js query --intrinsic-dimension        # requires --arch-health
node dist/cli/index.js query --architecture-drift
node dist/cli/index.js query --cluster-boundary
node dist/cli/index.js query --change-risk src/main.go    # requires --include-git
```

#### diff
Compare two metric snapshots (from `.archguard`):
```bash
node dist/cli/index.js diff                                # latest vs previous
node dist/cli/index.js diff --from <sha-prefix> --to <sha-prefix>
```

#### check
Evaluate configured `fitness` rules against the most recent snapshot:
```bash
node dist/cli/index.js check
```
Exits 1 on violation when `fitness.failOnViolation: true` is set in the config.

#### mcp
Start the MCP server over stdio (consumed by Claude Code / Codex):
```bash
node dist/cli/index.js mcp
```

### Output Formats

**Mermaid** (default):
- For TypeScript: generates 3-tier diagram set in `.archguard/output/<project>/` (overview/package, class/all-classes, method/* per module) + `index.md` at `.archguard/output/index.md`
- For Go (Atlas): generates 4-layer set (package, capability, goroutine, flow) in `.archguard/output/<project>/`
- Default output dir is `.archguard/output` (config `outputDir` default). Each analyzed source gets a
  `<source>`-namespaced subdirectory (project basename for auto-detect, diagram `name` for config-driven
  multi-source, source basename for `-s`). Override with `--output-dir <dir>` to write files directly at
  `<dir>` (no `output/` nesting).
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

**Parser runtime**: Non-TypeScript languages pick a tree-sitter backend per language
(`src/plugins/shared/`). Default `auto` = native-first with WASM fallback. Force with
`ARCHGUARD_PARSER_RUNTIME=auto|native|wasm` (legacy alias `ARCHGUARD_PARSER_BACKEND`).
Native backends need the optional `tree-sitter-*` peer deps; WASM grammars ship in
`assets/grammars/`.

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
| Dart | Beta | Tree-sitter (WASM), pubspec/melos import resolution |

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
node dist/cli/index.js analyze -s ./src --lang dart
```

### Plugin Registry

ArchGuard uses a plugin registry to manage language support. Plugins can be:
- **Built-in**: TypeScript, Go, Java, Python, C++, Kotlin, Dart plugins included
- **External**: Load third-party plugins via configuration

See [Plugin Registry Documentation](docs/user-guide/plugin-registry.md) for details.

## Architecture Overview

ArchGuard is a **plugin-based multi-language analyzer**. A single pipeline produces
ArchJSON; two independent consumers (the `query` CLI + MCP server, and Mermaid
rendering) read it.

**Data Flow**: `source → language plugin → ArchJSON → query engine / Mermaid → diagrams`

**Core subsystems**:
1. **Language plugins** (`src/plugins/<lang>/`) — one per language, implement
   `ILanguagePlugin`, registered via `PluginRegistry` (`src/core/plugin-registry.ts`).
   Languages: typescript, go, java, python, cpp, kotlin, dart.
   - Non-TypeScript languages share a backend in `src/plugins/shared/`.
     `resolveParserBackend()` picks a **WASM** grammar (bundled in `assets/grammars/`) or
     a **native** `tree-sitter-*` peer dep. `ARCHGUARD_PARSER_RUNTIME=auto|native|wasm`
     forces it (legacy alias: `ARCHGUARD_PARSER_BACKEND`).
   - **Go Atlas mode** (`--lang go`): 4 layers — package/capability/goroutine/flow.
     Opt out with `--no-atlas`.
2. **Parser** (`src/parser/`) — parallel parse workers → ArchJSON (`src/types`).
3. **Query engine** (`src/core/query/`) — `QueryEngine`, entity/relation query
   services, `ArchIndex`; loaded from `.archguard` by `src/cli/query/engine-loader.ts`.
   Shared by the `query` CLI command AND the MCP server (ADR-007: CLI/MCP parity).
4. **Mermaid** (`src/mermaid/`) — MermaidGenerator → Renderer → SVG/PNG
   (isomorphic-mermaid, no external deps).
5. **CLI** (`src/cli/`) — 7 commands (analyze, init, cache, query, mcp, diff, check),
   the MCP server (`src/cli/mcp/`), and `ErrorHandler` (`src/cli/errors`).
6. **Analysis layers** (`src/analysis/`) — optional cross-cutting analyses on top of
   ArchJSON: `fitness/` (rule checks → `check`), `git-history/` (churn/ownership/risk),
   `jl/` (intrinsic dimension, cluster-boundary, drift), `gim/` (direction hints),
   `shape-smells/` (god-class, literal dispersion), `test-analysis/` (coverage),
   `snapshot-store.ts`+`snapshot-diff.ts` (metric snapshots → `diff`).

**Cross-cutting components**: `ParallelParser` (concurrent file processing),
`RenderWorkerPool` (parallel rendering via Worker Threads), `ErrorHandler`
(unified error formatting).

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
2. **Run tests**: `npm test` (ensure the full suite passes)
3. **Type check**: `npm run type-check`
4. **Lint**: `npm run lint` and `npm run lint:fix`
5. **Build**: `npm run build`
6. **Self-validate**: `node dist/cli/index.js analyze -v`
7. **After adding or changing MCP tools**: rebuild, then in Claude Code run `/mcp` → Reconnect to reload the tool definitions in the current session. New MCP tools are registered in `src/cli/mcp/mcp-server.ts` — each `tools/*.ts` exports a `register*()` function wired into `registerTools()`.

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
