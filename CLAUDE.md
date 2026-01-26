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
# Build and analyze ArchGuard itself
npm run build
node dist/cli/index.js analyze -v

# Batch mode: analyze multiple modules
node dist/cli/index.js analyze -s ./src/cli -s ./src/parser --batch -v
```

## Using ArchGuard

### Basic Usage
```bash
# Generate PlantUML diagram (requires Claude Code CLI)
npm run build
node dist/cli/index.js analyze -v

# Generate ArchJSON only (no Claude CLI required, fast)
node dist/cli/index.js analyze -f json -o ./architecture.json

# Custom source and output directory
node dist/cli/index.js analyze -s ./src --output-dir ./diagrams
```

### Advanced Usage

#### Multi-Level Architecture Diagrams
Generate diagrams at different abstraction levels:
```bash
# Package-level overview (high-level)
node dist/cli/index.js analyze -s ./src -l package -n overview

# Class-level detail (default)
node dist/cli/index.js analyze -s ./src -l class -n architecture

# Method-level detail (low-level)
node dist/cli/index.js analyze -s ./src/core -l method -n core-methods
```

#### Multiple Diagram Generation
Use configuration file to generate multiple diagrams with different levels:
```bash
# Create archguard.config.json with diagrams array:
{
  "diagrams": [
    {
      "name": "overview",
      "sources": ["./src"],
      "level": "package"
    },
    {
      "name": "modules/frontend",
      "sources": ["./src/frontend"],
      "level": "class"
    },
    {
      "name": "modules/backend",
      "sources": ["./src/backend"],
      "level": "class"
    }
  ]
}

# Generate all diagrams
node dist/cli/index.js analyze

# Generate specific diagrams
node dist/cli/index.js analyze --diagrams overview frontend
```

#### Custom Output Organization
Control output file names and locations:
```bash
# Custom name in default directory
node dist/cli/index.js analyze --name my-architecture

# Subdirectory organization
node dist/cli/index.js analyze --name services/auth-api
# Output: archguard/services/auth-api.png

# Multiple levels
node dist/cli/index.js analyze --name modules/frontend/components
# Output: archguard/modules/frontend/components.png
```

### Available Commands

#### analyze
Analyze TypeScript project and generate architecture diagrams.

**Configuration Options**:
- `--config <path>` - Config file path (default: `archguard.config.json`)
- `--diagrams <names...>` - Generate specific diagrams (comma-separated)

**CLI Shortcut (Single Diagram)**:
- `-s, --sources <paths...>` - Source directories (creates single diagram)
- `-l, --level <level>` - Detail level: `package`|`class`|`method` (default: `class`)
- `-n, --name <name>` - Diagram name (default: `architecture`)

**Global Config Overrides**:
- `-f, --format <type>` - Output format: `plantuml`|`json`|`svg` (default: `plantuml`)
- `--output-dir <dir>` - Output directory for diagrams (default: `./archguard`)
- `-e, --exclude <patterns...>` - Exclude patterns
- `--no-cache` - Disable cache
- `-c, --concurrency <num>` - Parallel parsing concurrency (default: CPU cores)
- `-v, --verbose` - Verbose output

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

**PlantUML** (default, requires Claude Code CLI):
- Generates `archguard/architecture.puml` and `archguard/architecture.png`
- Output directory: `--output-dir` option or `outputDir` in config

**JSON** (ArchJSON, no Claude CLI required):
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

**SVG** (requires Claude Code CLI):
- Generates PlantUML source only (no PNG rendering)

### Prerequisites

**For PlantUML/SVG formats**: Claude Code CLI required.
```bash
claude --version  # Verify installation
```

## Architecture Overview

Three-layer architecture:
1. **Parser** (`src/parser/`) - TypeScriptParser → Extractors → ArchJSON
2. **AI Integration** (`src/ai/`) - ClaudeCodeWrapper → PlantUMLGenerator
3. **CLI** (`src/cli/`) - Commands (analyze, init, cache) with ErrorHandler

**Data Flow**: `TypeScript → AST → ArchJSON → PlantUML/PNG`

**Key Components**:
- ParallelParser: Concurrent file processing
- ClaudeCodeWrapper: CLI invocation with retry logic
- PromptTemplateManager: Template rendering (`prompts/`)
- ErrorHandler: Unified error formatting

## Configuration

Create `archguard.config.json` (run `node dist/cli/index.js init`):

```json
{
  "source": "./src",
  "format": "plantuml",           // plantuml | json | svg
  "exclude": ["**/*.test.ts", "**/*.spec.ts"],
  "cli": { "timeout": 180000 },   // 3min for large projects (30+ files)
  "cache": { "enabled": true },
  "concurrency": 8,
  "verbose": false
}
```

**Tips**: Use `format: "json"` for fast ArchJSON-only mode (no Claude CLI required).

## Path Aliases (TypeScript)
When importing, use these aliases instead of relative paths:
- `@/parser` → `src/parser`
- `@/cli` → `src/cli`
- `@/ai` → `src/ai`
- `@/types` → `src/types`
- `@/utils` → `src/utils`

## Testing Patterns

- **Unit**: `tests/unit/` - Vitest with mocked dependencies
- **Integration**: `tests/integration/` - Use `skip-helper.ts` to skip when Claude CLI unavailable
- **E2E**: `tests/integration/e2e/` - Full workflows

## Development Workflow

1. **Make changes** to source code
2. **Run tests**: `npm test` (ensure 370+ tests pass)
3. **Type check**: `npm run type-check`
4. **Lint**: `npm run lint` and `npm run lint:fix`
5. **Build**: `npm run build`
6. **Self-validate**: `node dist/cli/index.js analyze -v`

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

## Documentation

- `docs/architecture.md` - System architecture
- `docs/specs.md` - Requirements and specifications
- `docs/PLANTUML-GENERATION-FLOW.md` - Generation workflow
