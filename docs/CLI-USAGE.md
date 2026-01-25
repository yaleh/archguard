# ArchGuard CLI Usage Guide

Complete reference for ArchGuard command-line interface.

## Table of Contents

- [Installation](#installation)
- [Commands](#commands)
  - [analyze](#analyze)
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

After installation, the `archguard` command will be available globally.

### Local Installation

```bash
npm install --save-dev archguard
```

Use with npx:

```bash
npx archguard analyze -s ./src
```

Or add to package.json scripts:

```json
{
  "scripts": {
    "docs": "archguard analyze -s ./src -o ./docs/architecture.puml"
  }
}
```

## Commands

### analyze

Analyze TypeScript project and generate architecture documentation.

```bash
archguard analyze [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-s, --source <path>` | string | ./src | Source directory to analyze |
| `-o, --output <path>` | string | ./architecture.puml | Output file path |
| `-f, --format <type>` | string | plantuml | Output format (plantuml, json, svg) |
| `-e, --exclude <patterns...>` | string[] | [] | Glob patterns to exclude |
| `--no-cache` | boolean | false | Disable caching |
| `-c, --concurrency <num>` | number | CPU cores | Parallel processing concurrency |
| `-v, --verbose` | boolean | false | Verbose output with detailed logging |
| `--cli-command <command>` | string | claude | Claude CLI command to use |
| `--cli-args <args>` | string | - | Additional CLI arguments (space-separated) |
| `--output-dir <dir>` | string | ./archguard | Output directory for diagrams |

#### Examples

**Basic Analysis**

```bash
archguard analyze
```

Analyzes `./src` directory and generates `./architecture.puml`.

**Custom Paths**

```bash
archguard analyze -s ./packages/core -o ./docs/core-architecture.puml
```

**JSON Output**

```bash
archguard analyze -s ./src -o ./output/architecture.json -f json
```

**Exclude Patterns**

```bash
archguard analyze -s ./src -e "**/*.test.ts" "**/*.spec.ts" "**/mocks/**"
```

**High-Performance Processing**

```bash
archguard analyze -s ./src -c 8 -v
```

Uses 8 concurrent workers with verbose output.

**Disable Cache**

```bash
archguard analyze -s ./src --no-cache
```

Useful when you need fresh analysis without cache.

**Custom Claude CLI Command**

```bash
archguard analyze -s ./src --cli-command /usr/local/bin/claude
```

Use a custom path for the Claude CLI executable.

**Custom Model Selection**

```bash
archguard analyze -s ./src --cli-args "--model claude-opus-4-20250514"
```

Pass additional arguments to the Claude CLI (e.g., model selection).

**Custom Output Directory**

```bash
archguard analyze -s ./src --output-dir ./docs/diagrams
```

Specify where diagrams should be generated.

#### Output

The analyze command provides real-time progress feedback:

```
✔ Found 27 TypeScript files
⠋ Parsing TypeScript files... (12/27 files)
✔ Parsed 27 files in 6.26s (4.3 files/sec)
⠋ Generating PlantUML diagram...
✔ Generated PlantUML diagram: /path/to/architecture.puml
```

With verbose mode (`-v`), additional details are shown:

```
ℹ Entities: 47
ℹ Relations: 79
ℹ Memory: 24.50 MB
```

---

### init

Initialize ArchGuard configuration file in your project.

```bash
archguard init [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-f, --force` | boolean | false | Overwrite existing configuration |

#### Examples

**Create Configuration**

```bash
archguard init
```

Creates `.archguardrc.json` with default settings:

```json
{
  "source": "./src",
  "output": "./docs/architecture.puml",
  "format": "plantuml",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ],
  "concurrency": 4,
  "cache": true
}
```

**Force Overwrite**

```bash
archguard init --force
```

Overwrites existing `.archguardrc.json` file.

#### Interactive Mode

The init command interactively prompts for configuration options:

```
? Source directory: (./src)
? Output file: (./docs/architecture.puml)
? Output format: (plantuml)
? Exclude patterns: **/*.test.ts, **/*.spec.ts
? Enable caching? (yes)
? Concurrency level: (4)
```

---

### cache

Manage ArchGuard cache operations.

```bash
archguard cache <command>
```

#### Subcommands

**stats** - View cache statistics

```bash
archguard cache stats
```

Output:

```
Cache Statistics:
  Directory: /home/user/.archguard/cache
  Total Size: 2.4 MB
  Files: 27
  Hit Rate: 85.2%
  Hits: 23
  Misses: 4
```

**clear** - Clear all cache

```bash
archguard cache clear
```

Output:

```
✔ Cache cleared successfully
  Removed: 27 files (2.4 MB)
```

**path** - Show cache directory path

```bash
archguard cache path
```

Output:

```
/home/user/.archguard/cache
```

---

## Configuration

### Configuration File

ArchGuard supports configuration files in multiple formats:

- `.archguardrc.json`
- `.archguardrc`
- `archguard.config.json`

### Configuration Schema

```json
{
  "source": "./src",
  "output": "./docs/architecture.puml",
  "format": "plantuml",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts"
  ],
  "concurrency": 4,
  "cache": true,
  "anthropicApiKey": "${ANTHROPIC_API_KEY}"
}
```

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `source` | string | No | ./src | Source directory to analyze |
| `output` | string | No | ./architecture.puml | Output file path |
| `format` | string | No | plantuml | Output format (plantuml, json, svg) |
| `exclude` | string[] | No | [] | Glob patterns to exclude |
| `concurrency` | number | No | CPU cores | Parallel processing workers |
| `cache` | boolean | No | true | Enable caching |
| `cli.command` | string | No | claude | Claude CLI command to use |
| `cli.args` | string[] | No | [] | Additional CLI arguments |
| `cli.timeout` | number | No | 60000 | CLI timeout in milliseconds |
| `outputDir` | string | No | ./archguard | Output directory for diagrams |

### Environment Variables

Environment variables take precedence over configuration file:

```bash
export ANTHROPIC_API_KEY=your_api_key_here
archguard analyze
```

### Priority Order

Configuration values are resolved in this order (highest to lowest):

1. Command-line arguments
2. Environment variables
3. Configuration file
4. Default values

Example:

```bash
# Configuration file has: "concurrency": 4
# Command overrides to 8:
archguard analyze -c 8
```

---

## Examples

### Example 1: Simple Project

```bash
# Project structure:
# my-project/
# ├── src/
# │   ├── models/
# │   ├── services/
# │   └── controllers/
# └── docs/

# Generate architecture diagram
archguard analyze -s ./src -o ./docs/architecture.puml
```

### Example 2: Monorepo

```bash
# Analyze each package separately
archguard analyze -s ./packages/auth -o ./docs/auth-architecture.puml
archguard analyze -s ./packages/api -o ./docs/api-architecture.puml
archguard analyze -s ./packages/ui -o ./docs/ui-architecture.puml
```

### Example 3: CI/CD Integration

Add to your CI/CD pipeline:

```yaml
# .github/workflows/docs.yml
name: Generate Documentation

on:
  push:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -g archguard
      - run: archguard analyze -s ./src -o ./docs/architecture.puml
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - run: git add docs/architecture.puml
      - run: git commit -m "Update architecture diagram"
      - run: git push
```

### Example 4: NPM Scripts

```json
{
  "scripts": {
    "docs:generate": "archguard analyze -s ./src -o ./docs/architecture.puml",
    "docs:json": "archguard analyze -s ./src -o ./output/architecture.json -f json",
    "docs:clean": "archguard cache clear && npm run docs:generate",
    "docs:verbose": "archguard analyze -s ./src -o ./docs/architecture.puml -v"
  }
}
```

### Example 5: Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Generate updated architecture diagram before commit
archguard analyze -s ./src -o ./docs/architecture.puml --no-cache

# Add to commit if changed
git add docs/architecture.puml
```

---

## Best Practices

### 1. Use Configuration Files

Create `.archguardrc.json` for consistent settings across team:

```bash
archguard init
git add .archguardrc.json
```

### 2. Leverage Caching

Cache significantly speeds up repeated analysis:

```bash
# First run: ~10 seconds
archguard analyze

# Second run with cache: <3 seconds
archguard analyze
```

Clear cache only when needed:

```bash
archguard cache clear
```

### 3. Optimize Concurrency

Adjust concurrency based on project size:

```bash
# Small projects (< 50 files)
archguard analyze -c 2

# Medium projects (50-200 files)
archguard analyze -c 4

# Large projects (> 200 files)
archguard analyze -c 8
```

### 4. Exclude Unnecessary Files

Exclude test files, generated code, and dependencies:

```json
{
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/generated/**",
    "**/node_modules/**",
    "**/__mocks__/**",
    "**/dist/**"
  ]
}
```

### 5. Use Verbose Mode for Debugging

Enable verbose output to diagnose issues:

```bash
archguard analyze -v
```

### 6. Version Control

Add to `.gitignore` if regenerating frequently:

```
docs/architecture.puml
```

Or commit for documentation:

```bash
git add docs/architecture.puml
```

### 7. Separate Concerns

Generate different diagrams for different concerns:

```bash
# Domain model
archguard analyze -s ./src/models -o ./docs/domain-model.puml

# Services architecture
archguard analyze -s ./src/services -o ./docs/services-architecture.puml

# API architecture
archguard analyze -s ./src/api -o ./docs/api-architecture.puml
```

### 8. Automate Documentation

Add to package.json scripts:

```json
{
  "scripts": {
    "postinstall": "archguard analyze",
    "precommit": "archguard analyze && git add docs/architecture.puml"
  }
}
```

---

## Troubleshooting

For common issues and solutions, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Quick tips:

- **Cache issues**: Run `archguard cache clear`
- **API errors**: Check `ANTHROPIC_API_KEY` environment variable
- **Performance**: Adjust `-c` concurrency setting
- **Memory issues**: Reduce concurrency or exclude large files
- **Parsing errors**: Use `-v` for verbose output

---

## Getting Help

```bash
# General help
archguard --help

# Command help
archguard analyze --help
archguard init --help
archguard cache --help
```

For more information:
- [GitHub Issues](https://github.com/your-org/archguard/issues)
- [Documentation](https://github.com/your-org/archguard/tree/main/docs)
