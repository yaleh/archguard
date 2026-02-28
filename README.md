# ArchGuard

ArchGuard analyzes source code to extract architectural insights and generates **Mermaid diagrams** at multiple levels of detail. It supports TypeScript (stable), Go (stable), Java (beta), and Python (beta) through a plugin system, with optional LLM-powered grouping for better diagram organization.

## Screenshots

### Package-Level Overview
![Package Overview](docs/screenshots/overview-package.png)

### Class-Level Diagram
![Class Diagram](docs/screenshots/class-all-classes.png)

### Method-Level Detail (CLI Module)
![CLI Module Methods](docs/screenshots/method-cli-module.png)

## Features

- **Multi-Language Support**: TypeScript, Go, Java, Python via plugin system
- **Multi-Level Diagrams**: Package (high-level), Class (default), Method (low-level)
- **Go Architecture Atlas**: 4-layer visualization — package graph, capability graph, goroutine topology, flow graph
- **Parallel Processing**: High-performance parsing with configurable concurrency
- **Smart Caching**: File-based caching with SHA-256 hashing for fast repeated runs
- **AI-Powered Grouping**: Optional LLM-powered intelligent grouping via Claude API
- **Zero External Dependencies**: Local Mermaid rendering using isomorphic-mermaid
- **Five-Layer Validation**: Automatic syntax, structure, render, quality, and auto-repair validation
- **Configuration Files**: Project-level config with `archguard.config.json` support
- **Rich CLI**: Interactive progress display with real-time feedback

## Quick Start

### Installation

```bash
npm install -g archguard
```

Or as a dev dependency:

```bash
npm install --save-dev archguard
```

### Basic Usage

Analyze a TypeScript project:

```bash
archguard analyze -s ./src --output-dir ./docs/architecture
```

Analyze a Go project:

```bash
archguard analyze -s ./cmd --lang go --output-dir ./docs/architecture
```

This generates `architecture.mmd` (Mermaid source), `architecture.svg`, and `architecture.png`.

### Multi-Level Diagrams

```bash
# Package-level overview (high-level)
archguard analyze -s ./src -l package -n overview

# Class-level detail (default)
archguard analyze -s ./src -l class -n architecture

# Method-level detail (granular)
archguard analyze -s ./src/core -l method -n core-detail
```

## CLI Commands

### `analyze`

Analyze a project and generate architecture diagrams.

```bash
archguard analyze [options]
```

**Source & Level:**

- `-s, --sources <paths...>` - Source directories (repeatable)
- `-l, --level <level>` - Detail level: `package` | `class` | `method` (default: `class`)
- `-n, --name <name>` - Diagram name, supports paths like `modules/auth` (default: `architecture`)
- `--lang <language>` - Language: `typescript` | `go` | `java` | `python` (auto-detected)

**Output:**

- `--output-dir <dir>` - Output directory (default: `./archguard`)
- `-f, --format <type>` - Output format: `mermaid` | `json` (default: `mermaid`)
- `-e, --exclude <patterns...>` - Exclude glob patterns

**Performance:**

- `--no-cache` - Disable cache
- `-c, --concurrency <num>` - Parallel parsing workers (default: CPU cores)
- `-v, --verbose` - Verbose output

**Mermaid:**

- `--mermaid-theme <theme>` - Theme: `default` | `forest` | `dark` | `neutral`
- `--no-llm-grouping` - Use heuristic grouping instead of LLM

**Go Atlas** (enabled by default for Go):

- `--no-atlas` - Disable Atlas mode, use standard Go parsing
- `--atlas-layers <layers>` - Comma-separated layers: `package,capability,goroutine,flow`
- `--atlas-strategy <strategy>` - Analysis strategy: `none` | `selective` | `full`
- `--atlas-entry-points <types>` - Entry point types to focus on
- `--atlas-include-tests` - Include test packages in Atlas

**Multi-Diagram (config file):**

- `--config <path>` - Config file path (default: `archguard.config.json`)
- `--diagrams <names...>` - Generate only specific diagrams by name

**Claude CLI:**

- `--cli-command <command>` - Claude CLI executable (default: `claude`)
- `--cli-args <args>` - Additional Claude CLI arguments

**Examples:**

```bash
# Basic analysis
archguard analyze

# Analyze specific directory with custom output
archguard analyze -s ./packages/core --output-dir ./docs/core-architecture

# Generate JSON for tooling integration
archguard analyze -s ./src --output-dir . -f json

# Go project with Architecture Atlas
archguard analyze -s ./cmd --lang go

# Go without Atlas (faster, basic diagram)
archguard analyze -s ./cmd --lang go --no-atlas

# High concurrency
archguard analyze -s ./src -c 8 -v

# Exclude test files
archguard analyze -s ./src -e "**/*.test.ts" "**/*.spec.ts"

# Disable LLM grouping (heuristic, no Claude needed)
archguard analyze -s ./src --no-llm-grouping

# Dark theme
archguard analyze -s ./src --mermaid-theme dark
```

### `init`

Initialize configuration file:

```bash
archguard init
```

Creates `archguard.config.json` with defaults. Use `-f js` for a JavaScript config.

### `cache`

```bash
archguard cache stats   # View cache statistics
archguard cache clear   # Clear all cached data
archguard cache path    # Show cache directory
```

## Language Support

| Language   | Status | Parser                    | Features                                           |
|------------|--------|---------------------------|----------------------------------------------------|
| TypeScript | Stable | ts-morph (AST)            | Classes, interfaces, enums, dependencies, path aliases |
| Go         | Stable | tree-sitter + gopls       | Structs, interfaces, goroutines, Architecture Atlas |
| Java       | Beta   | tree-sitter               | Classes, interfaces, Maven/Gradle deps              |
| Python     | Beta   | tree-sitter               | Classes, functions, pip/Poetry deps                 |

### Go Architecture Atlas

For Go projects, ArchGuard generates a multi-layer architecture atlas showing:

- **Package Graph** — inter-package dependencies and coupling
- **Capability Graph** — functional capability clusters
- **Goroutine Topology** — concurrent execution patterns and channel topology
- **Flow Graph** — data and control flow paths

```bash
# Full Atlas (default when --lang go)
archguard analyze -s ./cmd --lang go

# Specific layers only
archguard analyze -s ./cmd --lang go --atlas-layers package,capability

# Standard diagram without Atlas
archguard analyze -s ./cmd --lang go --no-atlas
```

gopls is optional but improves interface detection accuracy from ~75% to ~95%:

```bash
go install golang.org/x/tools/gopls@latest
```

See [Go Plugin Usage Guide](docs/golang-plugin-usage.md) for details.

## Configuration

### `archguard.config.json`

```json
{
  "source": "./src",
  "format": "mermaid",
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"],
  "concurrency": 4,
  "outputDir": "./archguard",
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
  }
}
```

### Multi-Diagram Configuration

Generate multiple diagrams with different sources and levels in one run:

```json
{
  "diagrams": [
    {
      "name": "overview",
      "sources": ["./src"],
      "level": "package"
    },
    {
      "name": "modules/cli",
      "sources": ["./src/cli"],
      "level": "class"
    },
    {
      "name": "modules/parser",
      "sources": ["./src/parser"],
      "level": "method"
    }
  ],
  "outputDir": "./docs/architecture"
}
```

```bash
# Generate all diagrams
archguard analyze

# Generate specific diagrams only
archguard analyze --diagrams overview modules/cli
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | string | `./src` | Source directory (single diagram mode) |
| `diagrams` | array | — | Multi-diagram config (overrides `source`) |
| `format` | string | `mermaid` | Output format: `mermaid` or `json` |
| `exclude` | string[] | `[]` | Glob patterns to exclude |
| `concurrency` | number | CPU cores | Parallel parsing workers |
| `outputDir` | string | `./archguard` | Output directory |
| `cache.enabled` | boolean | `true` | Enable file-based caching |
| `mermaid.enableLLMGrouping` | boolean | `true` | LLM-powered entity grouping |
| `mermaid.theme` | string | `default` | Diagram theme |
| `mermaid.transparentBackground` | boolean | `true` | Transparent PNG background |
| `cli.command` | string | `claude` | Claude CLI executable |
| `cli.timeout` | number | `60000` | Claude CLI timeout (ms) |

## Output Formats

### Mermaid (default)

Generates `.mmd`, `.svg`, and `.png` files:

```
archguard/
├── overview/
│   ├── package.mmd
│   ├── package.svg
│   └── package.png
├── modules/
│   ├── cli.mmd
│   └── cli.png
└── index.md
```

Example `.mmd` output:

```
graph TD
  UserService[UserService<br/>+ getUser(id): Promise&lt;User&gt;<br/>+ createUser(data): Promise&lt;User&gt;]
  User[User<br/>+ id: string<br/>+ name: string]

  UserService --> User : uses
```

### ArchJSON

Structured JSON for tooling integration:

```json
{
  "version": "1.0",
  "language": "typescript",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "entities": [
    {
      "id": "UserService",
      "name": "UserService",
      "type": "class",
      "members": [...]
    }
  ],
  "relations": [
    { "from": "UserService", "to": "User", "type": "dependency" }
  ]
}
```

## Performance

- **Parallel Processing**: Automatically uses all CPU cores for parsing
- **Smart Caching**: SHA-256 file hashing; 80%+ cache hit rate on repeated runs
- **Benchmark** (ArchGuard self-analysis, 30+ files):
  - First run: ~6–10 seconds
  - Cached run: < 3 seconds
  - Throughput: ~4–5 files/second
  - Memory: < 300 MB

Tune concurrency:

```bash
archguard analyze -s ./src -c 8     # custom workers
archguard analyze -s ./src -c 1     # sequential (debugging)
```

## Architecture

### Project Structure

```
archguard/
├── src/
│   ├── cli/                 # CLI commands and utilities
│   │   ├── commands/        # analyze, init, cache
│   │   ├── progress/        # Progress reporting
│   │   ├── processors/      # Diagram processing pipeline
│   │   └── utils/           # Config loader, error handler
│   ├── core/                # Plugin registry and interfaces
│   │   └── interfaces/      # ILanguagePlugin, IParser, IDependencyExtractor
│   ├── parser/              # TypeScript AST parsing
│   │   ├── typescript-parser.ts
│   │   ├── parallel-parser.ts
│   │   └── extractors/      # class, interface, enum, relation
│   ├── mermaid/             # Diagram generation
│   │   ├── diagram-generator.ts
│   │   ├── renderer.ts
│   │   ├── validation-pipeline.ts
│   │   └── validators/      # parse, structural, render, quality
│   ├── plugins/             # Language plugins
│   │   ├── typescript/      # Stable
│   │   ├── golang/          # Stable (tree-sitter + gopls + Atlas)
│   │   │   └── atlas/       # package, capability, goroutine, flow builders
│   │   ├── java/            # Beta
│   │   └── python/          # Beta
│   └── types/               # Core types (config, ArchJSON, extensions)
├── tests/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   ├── plugins/             # Per-plugin tests
│   └── core/                # Plugin registry tests
└── docs/                    # Documentation and screenshots
```

### Data Flow

```
Source Files
    │
    ▼ Language Plugin (TypeScript / Go / Java / Python)
AST / Tree-sitter Parse
    │
    ▼ Extractors
ArchJSON (entities + relations)
    │
    ├─► (Go) Atlas Builders → 4-layer extension
    │
    ▼ LLM Grouper (optional, Claude API)
Grouped ArchJSON
    │
    ▼ Mermaid Generator
.mmd syntax
    │
    ▼ Five-Layer Validator + Auto-repair
Valid .mmd
    │
    ▼ isomorphic-mermaid + sharp
.svg + .png
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

Optional, for enhanced features:
- **Claude CLI** — LLM-powered diagram grouping
- **gopls** — Semantic interface detection for Go projects

### Setup

```bash
git clone https://github.com/your-org/archguard.git
cd archguard
npm install
npm run build
npm test
```

### Testing

```bash
npm test                    # All tests (vitest)
npm run test:unit           # Unit tests
npm run test:integration    # Integration tests
npm run test:coverage       # With coverage report
npm run test:watch          # Watch mode
```

### Code Quality

```bash
npm run lint                # ESLint check
npm run lint:fix            # Auto-fix
npm run format              # Prettier
npm run type-check          # TypeScript check
npm run build && npm run lint && npm run type-check && npm test
```

### Self-Analysis

```bash
npm run build

# Analyze ArchGuard itself
node dist/cli/index.js analyze -v

# Package-level overview
node dist/cli/index.js analyze -l package -n overview

# Method-level detail for a module
node dist/cli/index.js analyze -s ./src/cli -l method -n cli-module
```

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Language | TypeScript | ^5.3.0 | Type-safe development |
| Runtime | Node.js | >=18.0.0 | JavaScript runtime |
| TS Parser | ts-morph | ^21.0.0 | TypeScript AST |
| Go Parser | tree-sitter + tree-sitter-go | ^0.25.0 | Go AST |
| Java/Python Parser | tree-sitter | ^0.25.0 | Java/Python AST |
| Go LSP | gopls | latest | Semantic interface detection |
| Diagram Generation | isomorphic-mermaid | ^0.1.1 | Local Mermaid rendering |
| Image Processing | sharp | ^0.34.5 | SVG → PNG conversion |
| LLM Integration | @anthropic-ai/sdk | ^0.20.0 | Optional LLM grouping |
| Process Management | execa | ^8.0.0 | Subprocess execution |
| Testing | Vitest | ^1.2.0 | Unit/integration tests |
| CLI | commander | ^11.1.0 | Command-line interface |
| Progress | ora, chalk | ^8.x, ^5.x | Interactive CLI |
| Concurrency | p-limit | ^5.0.0 | Parallel processing |
| Configuration | zod | ^3.25.76 | Config validation |

## Troubleshooting

See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for common issues.

Quick fixes:

- **LLM grouping fails** — run with `--no-llm-grouping` to use heuristic mode
- **Go interface detection low** — install gopls: `go install golang.org/x/tools/gopls@latest`
- **Slow first run** — normal; subsequent runs use cache (80%+ hit rate)
- **Render errors** — the five-layer validator auto-repairs most issues; run with `-v` for details

## Documentation

- [CLI Usage Guide](docs/CLI-USAGE.md)
- [Configuration Reference](docs/CONFIGURATION.md)
- [Go Plugin Usage Guide](docs/golang-plugin-usage.md)
- [Plugin Development Guide](docs/plugin-development-guide.md)
- [Plugin Registry](docs/plugin-registry.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Contributing

This project follows:

- **TDD Methodology**: Tests written before implementation
- **Plugin System**: Add new languages via `ILanguagePlugin`
- **Clean Code**: Readable, maintainable code

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for details.

## License

MIT

## Credits

Built with:
- [ts-morph](https://ts-morph.com/) for TypeScript parsing
- [tree-sitter](https://tree-sitter.github.io/) for Go/Java/Python parsing
- [Mermaid](https://mermaid.js.org/) for diagram syntax
- [isomorphic-mermaid](https://github.com/brede95/isomorphic-mermaid) for rendering
- [Claude AI](https://www.anthropic.com/claude) for optional LLM-powered grouping
