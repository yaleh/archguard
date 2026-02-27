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
# Generate Mermaid diagram (default format)
npm run build
node dist/cli/index.js analyze -v

# Generate ArchJSON only (no LLM required, fast)
node dist/cli/index.js analyze -f json -o ./architecture.json

# Custom source and output directory
node dist/cli/index.js analyze -s ./src --output-dir ./diagrams
```

### Advanced Usage

#### LLM Grouping
By default, ArchGuard uses LLM-powered intelligent grouping for better diagram organization:
```bash
# Enable LLM grouping (default)
node dist/cli/index.js analyze -s ./src

# Disable LLM grouping (use heuristic)
node dist/cli/index.js analyze --no-llm-grouping
```

#### Mermaid Themes
```bash
# Use different themes
node dist/cli/index.js analyze --mermaid-theme dark
node dist/cli/index.js analyze --mermaid-theme forest
```

#### Language Selection
```bash
# Auto-detect language (default: TypeScript)
node dist/cli/index.js analyze -s ./src

# Explicitly specify language (currently supports: typescript)
node dist/cli/index.js analyze -s ./src --lang typescript

# Go: atlas mode is enabled automatically (no --atlas flag needed)
node dist/cli/index.js analyze -s ./src --lang go

# Go: opt out of atlas mode (standard Go parsing only)
node dist/cli/index.js analyze -s ./src --lang go --no-atlas
```

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
- `-f, --format <type>` - Output format: `mermaid`|`json` (default: `mermaid`)
- `--output-dir <dir>` - Output directory for diagrams (default: `./archguard`)
- `-e, --exclude <patterns...>` - Exclude patterns
- `--no-cache` - Disable cache
- `--no-llm-grouping` - Disable LLM-powered grouping (use heuristic)
- `--mermaid-theme <theme>` - Mermaid theme: `default`|`forest`|`dark`|`neutral`
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

**Mermaid** (default):
- Generates `archguard/architecture.mmd`, `archguard/architecture.svg`, and `archguard/architecture.png`
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

### Adding Language Support

To add a new language, create a plugin implementing `ILanguagePlugin`. See [Plugin Development Guide](docs/plugin-development-guide.md).

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
```

### Plugin Registry

ArchGuard uses a plugin registry to manage language support. Plugins can be:
- **Built-in**: TypeScript, Go, Java, Python plugins included
- **External**: Load third-party plugins via configuration

See [Plugin Registry Documentation](docs/plugin-registry.md) for details.

## Architecture Overview

Three-layer architecture:
1. **Parser** (`src/parser/`) - TypeScriptParser → Extractors → ArchJSON
2. **AI Integration** (`src/ai/`) - LLMGroupingService → MermaidGenerator
3. **CLI** (`src/cli/`) - Commands (analyze, init, cache) with ErrorHandler

**Data Flow**: `TypeScript → AST → ArchJSON → Mermaid/SVG/PNG`

**Key Components**:
- ParallelParser: Concurrent file processing
- LLMGroupingService: Intelligent entity grouping (optional)
- MermaidGenerator: Local Mermaid generation with validation
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
- `docs/MIGRATION-v2.0.md` - Migration guide from PlantUML to Mermaid
