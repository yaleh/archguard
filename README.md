# ArchGuard

## ⚠️ Breaking Changes

### v2.1: PlantUML Removal Complete

ArchGuard v2.1 completes the transition to Mermaid by removing all PlantUML support. See [PlantUML Removal Notice](docs/PLANTUML-REMOVAL-NOTICE.md) for details.

### v2.0: Mermaid Migration

ArchGuard v2.0 migrated from PlantUML to **Mermaid** as the default diagram format. See [Migration Guide](docs/MIGRATION-v2.0.md) for details.

**Key Improvements**:
- Error rate: 40-60% → <1% (-98%)
- First-pass success: ~5% → >95% (+90%)
- Generation speed: 30-60s → 5-10s (5x faster)
- LLM cost: -70% token consumption
- No external dependencies

## Overview

ArchGuard analyzes TypeScript projects to extract architectural insights and generates beautiful Mermaid diagrams. It automatically identifies classes, interfaces, enums, and their relationships, creating comprehensive architecture documentation with minimal effort.

## Features

- **Parallel Processing**: High-performance parsing with configurable concurrency
- **Smart Caching**: File-based caching with SHA-256 hashing for fast repeated analysis
- **AI-Powered Diagrams**: Beautiful Mermaid diagrams with intelligent LLM grouping
- **Zero Dependencies**: Local Mermaid rendering using isomorphic-mermaid
- **Rich CLI**: Interactive progress display with real-time feedback
- **Flexible Output**: Generate Mermaid diagrams (SVG/PNG) or ArchJSON data
- **Robust Error Handling**: Graceful handling of parsing errors with detailed reporting
- **Five-Layer Validation**: Automatic syntax, structure, render, and quality validation
- **Configuration Files**: Project-level configuration with archguard.config.json support
- **High Test Coverage**: 80%+ test coverage with comprehensive unit, integration, and E2E tests

## Quick Start

### Installation

```bash
npm install -g archguard
```

Or install as a dev dependency:

```bash
npm install --save-dev archguard
```

### Prerequisites

**No external dependencies required!** ArchGuard uses built-in isomorphic-mermaid for diagram rendering.

For optional LLM-powered grouping (better diagram organization), Claude CLI is recommended but not required:

```bash
# Check if Claude CLI is available (optional)
claude --version
```

### Basic Usage

Analyze your TypeScript project:

```bash
archguard analyze -s ./src --output-dir ./docs/architecture
```

This generates `architecture.mmd` (Mermaid source), `architecture.svg`, and `architecture.png` (rendered diagrams).

Generate JSON output:

```bash
archguard analyze -s ./src --output-dir ./docs -f json
```

With verbose output:

```bash
archguard analyze -s ./src --output-dir ./docs/architecture -v
```

## CLI Commands

### `analyze`

Analyze TypeScript project and generate architecture diagrams.

```bash
archguard analyze [options]
```

**Options:**

- `-s, --source <path>` - Source directory to analyze (default: ./src)
- `--output-dir <dir>` - Output directory for diagrams (default: ./archguard)
- `-f, --format <type>` - Output format: mermaid, json (default: mermaid)
- `-e, --exclude <patterns...>` - Exclude patterns
- `--no-cache` - Disable cache
- `--no-llm-grouping` - Disable LLM-powered grouping (use heuristic)
- `--mermaid-theme <theme>` - Mermaid theme: default, forest, dark, neutral
- `-c, --concurrency <num>` - Parallel parsing concurrency (default: CPU cores)
- `-v, --verbose` - Verbose output
- `--cli-command <command>` - Claude CLI command for LLM grouping (default: claude)
- `--cli-args <args>` - Additional CLI arguments (space-separated)
- `--output-dir <dir>` - Output directory for diagrams (default: ./archguard)

**Output Formats:**

- **mermaid** (default): Generates `.mmd`, `.svg`, and `.png` files
- **json**: Generates `.json` ArchJSON data

**Examples:**

```bash
# Basic analysis (generates architecture.mmd, .svg, and .png)
archguard analyze

# Analyze specific directory with custom output
archguard analyze -s ./packages/core --output-dir ./docs/core-architecture

# High-performance parallel processing
archguard analyze -s ./src -c 8 -v

# Exclude specific files
archguard analyze -s ./src -e "**/*.test.ts" "**/*.spec.ts"

# JSON output for further processing
archguard analyze -s ./src --output-dir . -f json

# Disable LLM grouping (use heuristic, faster)
archguard analyze -s ./src --no-llm-grouping

# Use different Mermaid theme
archguard analyze -s ./src --mermaid-theme dark

# Custom Claude CLI for LLM grouping
archguard analyze -s ./src --cli-command /usr/local/bin/claude

# Additional CLI arguments (e.g., custom model)
archguard analyze -s ./src --cli-args "--model claude-3-5-sonnet-20241022"

# Custom output directory
archguard analyze -s ./src --output-dir ./docs/diagrams
```

### `init`

Initialize ArchGuard configuration file.

```bash
archguard init [options]
```

**Options:**

- `-f, --force` - Overwrite existing configuration

Creates `archguard.config.json` with default settings:

```json
{
  "source": "./src",
  "format": "mermaid",
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"],
  "concurrency": 4,
  "cache": { "enabled": true },
  "mermaid": {
    "enableLLMGrouping": true,
    "renderer": "isomorphic",
    "theme": "default"
  },
  "cli": {
    "command": "claude",
    "args": [],
    "timeout": 60000
  },
  "outputDir": "./archguard"
}
```

### `cache`

Manage cache operations.

```bash
# View cache statistics
archguard cache stats

# Clear all cache
archguard cache clear

# Show cache directory
archguard cache path
```

## Configuration

### Configuration File

Create `archguard.config.json` in your project root:

```json
{
  "source": "./src",
  "format": "mermaid",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ],
  "concurrency": 4,
  "cache": { "enabled": true },
  "mermaid": {
    "enableLLMGrouping": true,
    "renderer": "isomorphic",
    "theme": "default",
    "transparentBackground": true
  },
  "cli": {
    "command": "claude",
    "args": [],
    "timeout": 60000
  },
  "outputDir": "./archguard"
}
```

### Dependencies

- **isomorphic-mermaid** - Built-in Mermaid rendering (automatically installed)
- **Claude Code CLI** - Optional, for LLM-powered intelligent grouping

### Configuration Fields

#### Mermaid Configuration

```json
{
  "mermaid": {
    "enableLLMGrouping": true,
    "renderer": "isomorphic",
    "theme": "default",
    "transparentBackground": true
  }
}
```

**Field Descriptions:**

- **mermaid.enableLLMGrouping** - Use LLM for intelligent entity grouping (default: true)
- **mermaid.renderer** - Rendering engine: `isomorphic` (default) or `cli`
- **mermaid.theme** - Visual theme: `default`, `forest`, `dark`, `neutral`
- **mermaid.transparentBackground** - Use transparent background for PNG (default: true)

#### CLI Configuration

ArchGuard uses the Claude Code CLI for optional LLM-powered grouping. You can customize the CLI behavior:

```json
{
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-3-5-sonnet-20241022"],
    "timeout": 60000
  }
}
```

**Field Descriptions:**

- **cli.command** - The Claude CLI command to use (default: `claude`)
- **cli.args** - Additional arguments to pass to the CLI (e.g., model selection)
- **cli.timeout** - Timeout in milliseconds for CLI operations (default: 60000)

#### Output Directory

Control where diagrams are generated:

```json
{
  "outputDir": "./archguard"
}
```

**CLI Override:**

```bash
archguard analyze --output-dir ./docs/diagrams
```

#### Migration from v1.x

If you're upgrading from ArchGuard v1.x (PlantUML), see the [Migration Guide](docs/MIGRATION-v2.0.md) for detailed instructions.

Quick migration:
```bash
# Automated migration
npm run migrate

# Or manually update config
node dist/cli/index.js init
```

## Performance

ArchGuard is optimized for large projects:

- **Parallel Processing**: Automatically uses CPU cores for faster parsing
- **Smart Caching**: 80%+ cache hit rate on repeated runs
- **Benchmark Results** (on ArchGuard itself):
  - First run: ~6-10 seconds for 27 files
  - Cached run: <3 seconds
  - Throughput: 4-5 files/second
  - Memory usage: <300MB

### Performance Tuning

Adjust concurrency for optimal performance:

```bash
# Use all CPU cores (default)
archguard analyze -s ./src

# Custom concurrency
archguard analyze -s ./src -c 8

# Sequential processing (debugging)
archguard analyze -s ./src -c 1
```

## Output Formats

### Mermaid (Default)

Generates `.mmd` files that can be rendered using Mermaid:

```mmd
graph TD
  UserService[UserService<br/>users: User[]<br/>+ getUser(id): Promise<User><br/>+ createUser(data): Promise<User>]
  User[User<br/>+ id: string<br/>+ name: string<br/>+ email: string]

  UserService --> User : uses
```

### ArchJSON

Generates structured JSON with complete architectural data:

```json
{
  "version": "1.0",
  "language": "typescript",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "sourceFiles": ["src/user-service.ts"],
  "entities": [
    {
      "id": "UserService",
      "name": "UserService",
      "type": "class",
      "visibility": "public",
      "members": [...],
      "sourceLocation": {...}
    }
  ],
  "relations": [...]
}
```

## Architecture

### Project Structure

```
archguard/
├── src/
│   ├── parser/              # TypeScript parsing
│   │   ├── typescript-parser.ts
│   │   ├── parallel-parser.ts   # Parallel processing
│   │   ├── class-extractor.ts
│   │   ├── interface-extractor.ts
│   │   └── relation-extractor.ts
│   ├── ai/                  # AI integration (optional LLM grouping)
│   │   ├── claude-client.ts
│   │   ├── prompt-manager.ts
│   │   ├── response-parser.ts
│   │   └── grouper.ts
│   ├── mermaid/              # Mermaid diagram generation
│   │   ├── generator.ts
│   │   ├── validator.ts
│   │   ├── renderer.ts
│   │   └── llm/              # LLM-powered grouping
│   │       ├── grouper.ts
│   │       ├── client.ts
│   │       ├── prompt.ts
│   │       └── parser.ts
│   ├── cli/                 # CLI implementation
│   │   ├── commands/
│   │   ├── progress.ts
│   │   ├── cache-manager.ts
│   │   ├── config-loader.ts
│   │   └── error-handler.ts
│   └── types/               # Type definitions
├── tests/
│   ├── unit/                # Unit tests (287 tests)
│   ├── integration/         # Integration tests (27 tests)
│   └── e2e/                 # End-to-end tests
└── docs/                    # Documentation
```

### Data Flow

1. **Parse**: TypeScript files → AST → ArchJSON
2. **Cache**: Check cache for previously parsed files
3. **Parallel**: Process multiple files concurrently
4. **Group** (optional): LLM-powered intelligent grouping
5. **Generate**: ArchJSON → Mermaid syntax
6. **Validate**: Five-layer validation (syntax, structure, render, quality, auto-repair)
7. **Render**: Mermaid → SVG/PNG (isomorphic-mermaid)
8. **Output**: Write to file system

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Claude Code CLI (installed and configured)

### Setup

```bash
# Clone repository
git clone https://github.com/your-org/archguard.git
cd archguard

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage (80%+ coverage)
npm run test:coverage

# Run specific test suites
npm run test:unit          # 287 unit tests
npm run test:integration   # 27 integration tests

# Watch mode for development
npm run test:watch
```

### Code Quality

```bash
# Lint
npm run lint
npm run lint:fix

# Format
npm run format
npm run format:check

# Type check
npm run type-check

# All checks
npm run build && npm run lint && npm run type-check && npm test
```

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Language | TypeScript | ^5.3.0 | Type-safe development |
| Runtime | Node.js | >=18.0.0 | JavaScript runtime |
| Parser | ts-morph | ^21.0.0 | TypeScript AST parsing |
| Diagram Generation | isomorphic-mermaid | ^0.1.1 | Mermaid rendering (built-in) |
| Image Processing | sharp | ^0.34.5 | PNG conversion |
| LLM Integration | @anthropic-ai/sdk | ^0.20.0 | Optional LLM grouping |
| Process Management | execa | ^8.0.0 | Subprocess execution |
| Testing | Vitest | ^1.2.0 | Unit/integration tests |
| CLI | commander | ^11.1.0 | Command-line interface |
| Progress | ora, chalk | ^8.x, ^5.x | Interactive CLI |
| Concurrency | p-limit | ^5.0.0 | Parallel processing |
| Validation | zod | ^3.25.76 | Configuration validation |

## Troubleshooting

See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for common issues and solutions.

## Documentation

- [PlantUML Removal Notice](docs/PLANTUML-REMOVAL-NOTICE.md) - Migration guide from PlantUML to Mermaid
- [Migration Guide v2.0](docs/MIGRATION-v2.0.md) - Upgrade from PlantUML to Mermaid
- [CLI Usage Guide](docs/CLI-USAGE.md)
- [Configuration Reference](docs/CONFIGURATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Contributing

This project follows:

- **TDD Methodology**: Tests written before implementation
- **RLM Practices**: Systematic refactoring lifecycle management
- **Clean Code**: Readable, maintainable, documented code

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for details.

## License

MIT

## Credits

Built with:
- [ts-morph](https://ts-morph.com/) for TypeScript parsing
- [Mermaid](https://mermaid.js.org/) for diagram syntax
- [isomorphic-mermaid](https://github.com/brede95/isomorphic-mermaid) for rendering
- [Claude AI](https://www.anthropic.com/claude) for optional LLM-powered grouping
