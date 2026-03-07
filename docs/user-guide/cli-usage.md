# ArchGuard CLI Usage Guide

Complete reference for ArchGuard command-line interface.

## Table of Contents

- [Installation](#installation)
- [Commands](#commands)
  - [analyze](#analyze)
  - [query](#query)
  - [mcp](#mcp)
  - [init](#init)
  - [cache](#cache)
- [Configuration](#configuration)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Installation

### Global Installation

```bash
npm install -g archguard
```

### Local Installation

```bash
npm install --save-dev archguard
npx archguard analyze -s ./src
```

## Commands

### analyze

Analyze a project and generate architecture diagrams.

```bash
archguard analyze [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-s, --sources <paths...>` | string[] | - | Source directory/directories; triggers auto-detection → multi-diagram output |
| `--diagrams <levels...>` | string[] | all | Filter by level: `package`\|`class`\|`method` (TypeScript); `package`\|`capability`\|`goroutine`\|`flow` (Go Atlas) |
| `--lang <language>` | string | auto | Language plugin: `typescript`\|`go`\|`java`\|`python` |
| `--config <path>` | string | archguard.config.json | Config file path |
| `-f, --format <type>` | string | mermaid | Output format: `mermaid`\|`json` |
| `--output-dir <dir>` | string | `./.archguard` | Output directory (auto-set to `<project>/.archguard` for external paths) |
| `-e, --exclude <patterns...>` | string[] | [] | Glob patterns to exclude |
| `--no-cache` | boolean | false | Disable caching |
| `-c, --concurrency <num>` | number | CPU cores | Parallel processing workers |
| `-v, --verbose` | boolean | false | Verbose output |
| `--mermaid-theme <theme>` | string | default | Mermaid theme: `default`\|`forest`\|`dark`\|`neutral` |
| `--mermaid-renderer <renderer>` | string | isomorphic | Mermaid renderer: `isomorphic`\|`cli` |
| `--cli-command <command>` | string | claude | Claude CLI command |
| `--cli-args <args>` | string | - | Additional CLI arguments (space-separated) |
| `--work-dir <dir>` | string | `./.archguard` | Work directory for cache and query artifacts |
| `--cache-dir <dir>` | string | `<work-dir>/cache` | Cache directory |
| `--no-atlas` | boolean | false | Disable Go Atlas mode (Go only) |

#### Default behavior (no flags)

ArchGuard auto-detects your project structure and generates a **3-tier diagram set** when 2+ top-level modules are found:

- `overview/package` — package-level overview
- `class/all-classes` — full class diagram
- `method/<module>` — method-level detail per module

Output goes to `.archguard/` with an `index.md` summary.

#### Examples

**Analyze current project (auto-detect)**

```bash
archguard analyze
```

**Analyze external project (output to that project's `.archguard`)**

```bash
archguard analyze -s /path/to/other-project/src
```

**Filter to specific levels**

```bash
archguard analyze --diagrams class method
archguard analyze -s ./src --diagrams package
```

**Go project with Atlas**

```bash
archguard analyze -s ./src --lang go
# Generates: package, capability, goroutine, flow diagrams
```

**JSON output (fast, no LLM)**

```bash
archguard analyze -f json
```

**High-performance processing**

```bash
archguard analyze -c 8 -v
```

**Custom output directory**

```bash
archguard analyze --output-dir ./docs/diagrams
```

#### Output

TypeScript (3-tier, auto-detected with 2+ modules):

```
.archguard/
├── overview/
│   ├── package.mmd / .svg / .png
├── class/
│   ├── all-classes.mmd / .svg / .png
├── method/
│   ├── cli.mmd / .svg / .png
│   ├── parser.mmd / .svg / .png
│   └── ...
└── index.md
```

Go Atlas:

```
.archguard/
├── architecture-package.mmd / .svg / .png
├── architecture-capability.mmd / .svg / .png
├── architecture-goroutine.mmd / .svg / .png
├── architecture-flow.mmd / .svg / .png
└── architecture-atlas.json
```

---

### query

Query persisted architecture entities and relationships.

```bash
archguard query [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--arch-dir <dir>` | string | `./.archguard` | ArchGuard work directory |
| `--scope <key>` | string | auto | Query scope key |
| `--format <type>` | string | text | Output format: `json`\|`text` |
| `--entity <name>` | string | - | Find entity by exact name |
| `--deps-of <name>` | string | - | Find dependencies of an entity |
| `--used-by <name>` | string | - | Find dependents of an entity |
| `--implementers-of <name>` | string | - | Find implementers of an interface |
| `--subclasses-of <name>` | string | - | Find subclasses of a class |
| `--file <path>` | string | - | Find entities defined in a file |
| `--depth <n>` | number | 1 | BFS depth for dependency queries |
| `--cycles` | boolean | false | Show dependency cycles |
| `--summary` | boolean | false | Show scope summary |
| `--list-scopes` | boolean | false | List available query scopes |
| `--type <entityType>` | string | - | Filter entities by type |
| `--high-coupling` | boolean | false | Find high-coupling entities |
| `--threshold <n>` | number | 8 | Coupling threshold |
| `--orphans` | boolean | false | Find orphan entities |
| `--in-cycles` | boolean | false | Find entities participating in cycles |

#### Examples

```bash
archguard query --summary
archguard query --entity "QueryEngine"
archguard query --deps-of "DiagramProcessor" --depth 2
archguard query --implementers-of "ILanguagePlugin"
archguard query --list-scopes
```

---

### mcp

Start the ArchGuard MCP server over stdio.

```bash
archguard mcp [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--arch-dir <dir>` | string | `./.archguard` | ArchGuard work directory |
| `--scope <key>` | string | auto | Initial query scope |

The MCP server exposes the query toolset and `archguard_analyze`, which reruns analysis and refreshes query artifacts inside the current MCP session.

---

### init

Initialize ArchGuard configuration file.

```bash
archguard init
```

Creates `archguard.config.json` with default settings.

---

### cache

Manage ArchGuard cache.

```bash
archguard cache stats   # View cache statistics
archguard cache clear   # Clear all cached data
```

---

## Configuration

### Configuration File

`archguard.config.json` (or `archguard.config.js`):

```json
{
  "outputDir": "./.archguard",
  "format": "mermaid",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ],
  "mermaid": {
    "renderer": "isomorphic",
    "theme": "default",
    "transparentBackground": true
  },
  "cli": { "timeout": 180000 },
  "cache": { "enabled": true },
  "concurrency": 8,
  "verbose": false
}
```

### Multi-diagram config (explicit)

```json
{
  "diagrams": [
    { "name": "overview/package", "sources": ["./src"], "level": "package" },
    { "name": "class/all-classes", "sources": ["./src"], "level": "class" },
    { "name": "method/frontend", "sources": ["./src/frontend"], "level": "method" },
    { "name": "method/backend", "sources": ["./src/backend"], "level": "method" }
  ]
}
```

### Configuration priority

1. CLI arguments (highest)
2. Config file
3. Default values

### supportedLevels per language

| Language | Supported levels |
|----------|-----------------|
| TypeScript | `package`, `class`, `method` |
| Go (Atlas) | `package`, `capability`, `goroutine`, `flow` |
| Go (standard) | `package`, `class`, `method` |
| Java | `package`, `class`, `method` |
| Python | `package`, `class`, `method` |

---

## Examples

### Example 1: Analyze current TypeScript project

```bash
archguard analyze
# Output: .archguard/ with 3-tier diagrams + index.md
```

### Example 2: Analyze external project

```bash
archguard analyze -s /home/user/work/web-llm/src
# Output: /home/user/work/web-llm/.archguard/
```

### Example 3: Monorepo — analyze each package

```bash
archguard analyze -s ./packages/auth --output-dir ./docs/auth
archguard analyze -s ./packages/api --output-dir ./docs/api
```

### Example 4: CI/CD Integration

```yaml
# .github/workflows/docs.yml
- run: npm install -g archguard
- run: archguard analyze --output-dir ./docs/diagrams
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
- run: git add docs/diagrams/ && git commit -m "Update architecture diagrams"
```

### Example 5: Query persisted results

```bash
archguard analyze
archguard query --summary
archguard query --used-by "ArchJSON"
```

### Example 6: NPM Scripts

```json
{
  "scripts": {
    "docs": "archguard analyze",
    "docs:class": "archguard analyze --diagrams class",
    "docs:json": "archguard analyze -f json"
  }
}
```

---

## Best Practices

### 1. Use configuration files for teams

```bash
archguard init
git add archguard.config.json
```

### 2. Leverage caching

Cache speeds up repeated analysis significantly. Clear only when needed:

```bash
archguard cache clear
```

### 3. Optimize concurrency

```bash
archguard analyze -c 8   # large projects
archguard analyze -c 2   # small projects
```

### 4. Use JSON format for tooling integration

```bash
archguard analyze -f json  # fast, no LLM required
```
