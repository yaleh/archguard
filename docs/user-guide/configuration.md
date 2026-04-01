# ArchGuard Configuration Reference

Complete guide to configuring ArchGuard for your project.

## Table of Contents

- [Configuration Files](#configuration-files)
- [Configuration Schema](#configuration-schema)
- [Environment Variables](#environment-variables)
- [CLI Options](#cli-options)
- [Configuration Priority](#configuration-priority)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Configuration Files

ArchGuard supports multiple configuration file formats:

### Supported File Names

- `archguard.config.json` (recommended)
- `.archguardrc.json`

### File Location

Configuration files should be placed in the project root directory.

### Creating Configuration

Use the init command to create a configuration file:

```bash
archguard init
```

This creates `archguard.config.json` with default settings.

---

## Configuration Schema

### Complete Example

```json
{
  "$schema": "https://archguard.dev/schema/config.json",
  "source": "./src",
  "format": "mermaid",
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**",
    "**/__mocks__/**",
    "**/dist/**",
    "**/build/**"
  ],
  "concurrency": 4,
  "workDir": "./.archguard",
  "cache": { "enabled": true, "dir": "./.archguard/cache" },
  "outputDir": "./.archguard/output",
  "verbose": false,
  "mermaid": {
    "renderer": "isomorphic",
    "theme": "default",
    "transparentBackground": true
  },
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-sonnet-4-20250514"],
    "timeout": 60000
  }
}
```

### Field Descriptions

#### source

- **Type**: `string`
- **Default**: `"./src"`
- **Description**: Root directory containing TypeScript source files to analyze

```json
{
  "source": "./src"
}
```

**Examples**:

```json
// Monorepo package
{ "source": "./packages/core/src" }

// Multiple source directories (use multiple config files)
{ "source": "./src" }  // .archguardrc.json
{ "source": "./lib" }  // .archguardrc.lib.json
```

#### format

- **Type**: `"mermaid" | "json"`
- **Default**: `"mermaid"`
- **Description**: Output format for generated architecture

```json
{
  "format": "mermaid"
}
```

**Options**:

- `"mermaid"` - Generates Mermaid diagram (.mmd, .svg, .png)
- `"json"` - Generates ArchJSON data (.json)

#### exclude

- **Type**: `string[]`
- **Default**: `[]`
- **Description**: Glob patterns for files/directories to exclude from analysis

```json
{
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ]
}
```

**Common exclusions**:

```json
{
  "exclude": [
    // Test files
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/__tests__/**",
    "**/__mocks__/**",

    // Build output
    "**/dist/**",
    "**/build/**",
    "**/out/**",

    // Dependencies
    "**/node_modules/**",

    // Generated code
    "**/generated/**",
    "**/*.generated.ts",

    // Configuration
    "**/*.config.ts",

    // Examples/demos
    "**/examples/**",
    "**/demos/**"
  ]
}
```

#### concurrency

- **Type**: `number`
- **Default**: CPU core count
- **Description**: Number of parallel workers for file parsing

```json
{
  "concurrency": 4
}
```

**Guidelines**:

| Project Size | Files | Recommended Concurrency |
|--------------|-------|------------------------|
| Small | < 50 | 2-4 |
| Medium | 50-200 | 4-8 |
| Large | > 200 | 8-16 |

#### cache

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable/disable caching of parsing results

```json
{
  "cache": true
}
```

**When to disable**:

```json
// Disable for CI/CD fresh builds
{ "cache": false }

// Enable for development (faster)
{ "cache": true }
```

#### cacheDir

- **Type**: `string`
- **Default**: `"~/.archguard/cache"`
- **Description**: Directory for storing cache files

```json
{
  "cacheDir": "~/.archguard/cache"
}
```

**Custom cache locations**:

```json
// Project-local cache
{ "cacheDir": "./.archguard-cache" }

// Shared cache for monorepo
{ "cacheDir": "../../.archguard-cache" }
```

#### cli

- **Type**: `object`
- **Default**: `{ command: "claude", args: [], timeout: 60000 }`
- **Description**: External command configuration used by features that opt into command execution

```json
{
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-sonnet-4-20250514"],
    "timeout": 60000
  }
}
```

**Field Descriptions**:

- **cli.command** - Command to execute
- **cli.args** - Additional arguments to pass to the command
- **cli.timeout** - Timeout in milliseconds for command execution

**Examples**:

```json
// Default command configuration
{ "cli": { "command": "claude" } }

// Custom command path
{ "cli": { "command": "/usr/local/bin/claude" } }

// With custom arguments
{
  "cli": {
    "args": ["--model", "claude-opus-4-20250514"]
  }
}

// Extended timeout for large projects
{
  "cli": {
    "timeout": 120000
  }
}
```

#### outputDir

- **Type**: `string`
- **Default**: `"./.archguard/output"`
- **Description**: Output directory for generated diagrams

```json
{
  "outputDir": "./.archguard/output"
}
```

**Examples**:

```json
// Default location
{ "outputDir": "./.archguard/output" }

// Custom output directory
{ "outputDir": "./docs/diagrams" }

// Absolute path
{ "outputDir": "/tmp/archguard-output" }
```

#### projectSemantics

- **Type**: `object`
- **Default**: not set
- **Description**: Skill-authored or user-authored project knowledge injected into test analysis, Mermaid grouping, and FIM analysis

```json
{
  "projectSemantics": {
    "additionalTestPatterns": ["tests/**/*.ts"],
    "customAssertionPatterns": ["expect[A-Z]\\w+"],
    "architecturalLayers": {
      "src/analysis": "analysis",
      "src/cli": "cli"
    },
    "suggestedDepth": 2
  }
}
```

**Supported fields**:

- `nonProductionPatterns`
- `barrelFiles`
- `additionalTestPatterns`
- `customAssertionPatterns`
- `architecturalLayers`
- `suggestedDepth`

**Merge priority**:

1. `archguard.config.json.projectSemantics`
2. `.archguard/project-semantics.json`
3. built-in defaults

The sidecar file must use the same bare object shape as `projectSemantics`.

**Validation behavior**:

- Invalid `projectSemantics` in config fails configuration loading.
- Invalid `.archguard/project-semantics.json` fails analysis startup.
- Unsafe path-like values such as `..`, absolute paths, and null bytes are rejected.

**Sidecar example**:

```json
{
  "architecturalLayers": {
    "src/analysis": "analysis",
    "src/cli": "cli"
  }
}
```

#### mermaid

- **Type**: `object`
- **Default**: `{ renderer: "isomorphic", theme: "default", transparentBackground: true }`
- **Description**: Mermaid-specific configuration

```json
{
  "mermaid": {
    "renderer": "isomorphic",
    "theme": "default",
    "transparentBackground": true
  }
}
```

**Field Descriptions**:

- **renderer** - Rendering engine: `"isomorphic"` (default) or `"cli"`
- **theme** - Visual theme: `"default"`, `"forest"`, `"dark"`, `"neutral"`
- **transparentBackground** - Use transparent background for PNG output (default: true)

**Examples**:

```json
// Default configuration
{ "mermaid": { "theme": "default" } }

// Dark theme
{ "mermaid": { "theme": "dark" } }

// Use CLI renderer (requires mermaid-cli)
{ "mermaid": { "renderer": "cli" } }
```

---

## Backward Compatibility

### v1.0 to v1.1 Migration

Old configuration files using `ai` fields are automatically migrated:

```json
// Old (v1.0) - Still works with deprecation warnings
{
  "ai": {
    "model": "claude-sonnet-4-20250514",
    "timeout": 120000,
    "apiKey": "sk-ant-..."  // Deprecated and ignored
  }
}

// New (v1.1) - Recommended
{
  "cli": {
    "command": "claude",
    "args": ["--model", "claude-sonnet-4-20250514"],
    "timeout": 120000
  }
}
```

**Migration Mapping**:

- `ai.model` → `cli.args` (converted to `--model` flag)
- `ai.timeout` → `cli.timeout`
- `ai.apiKey` → **Removed**
- `ai.maxTokens` → **Removed** (not applicable to CLI)
- `ai.temperature` → **Removed** (not applicable to CLI)

**Deprecation Warnings**:

When using deprecated fields, ArchGuard will show warnings:

```
Warning: ai.apiKey is deprecated and will be ignored.
Please remove apiKey from your config file.
```

---

## CLI Options

Command-line options have the highest priority and override both configuration files and environment variables.

```bash
archguard analyze \
  --sources ./src \
  --format mermaid \
  --exclude "**/*.test.ts" "**/*.spec.ts" \
  --concurrency 8 \
  --no-cache \
  --verbose \
  --mermaid-theme dark \
  --output-dir ./docs/diagrams
```

### v2.0 CLI Options (Mermaid)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--mermaid-theme` | string | default | Mermaid theme (default, forest, dark, neutral) |
| `--mermaid-renderer` | string | isomorphic | Mermaid renderer (isomorphic, cli) |
| `--output-dir` | string | ./archguard | Output directory for diagrams |

#### verbose

- **Type**: `boolean`
- **Default**: `false`
- **Description**: Enable verbose logging for debugging

```json
{
  "verbose": false
}
```

---

## Environment Variables

Environment variables override configuration file values.

### ANTHROPIC_API_KEY

Your Anthropic API key for Claude AI.

```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

**Usage in .env file**:

```env
# .env
ANTHROPIC_API_KEY=your_api_key_here
```

### ARCHGUARD_CACHE_DIR

Override default cache directory.

```bash
export ARCHGUARD_CACHE_DIR=/custom/cache/path
```

### ARCHGUARD_CONCURRENCY

Override default concurrency level.

```bash
export ARCHGUARD_CONCURRENCY=8
```

---

## CLI Options

Command-line options have the highest priority and override both configuration files and environment variables.

```bash
archguard analyze \
  --sources ./src \
  --output-dir ./docs/architecture \
  --format mermaid \
  --exclude "**/*.test.ts" "**/*.spec.ts" \
  --concurrency 8 \
  --no-cache \
  --verbose
```

See [CLI Usage Guide](cli-usage.md) for complete CLI reference.

---

## Configuration Priority

Configuration values are resolved in the following order (highest to lowest priority):

1. **CLI Options** (highest priority)
2. **Environment Variables**
3. **Configuration File**
4. **Default Values** (lowest priority)

### Example Resolution

Given:

```json
// .archguardrc.json
{
  "concurrency": 4
}
```

```bash
export ARCHGUARD_CONCURRENCY=6
```

```bash
archguard analyze --concurrency 8
```

**Result**: Uses `8` (CLI option wins)

---

## Examples

### Example 1: Minimal Configuration

```json
{
  "source": "./src"
}
```

Uses all defaults, only specifies source directory.

### Example 2: Development Configuration

```json
{
  "source": "./src",
  "output": "./docs/architecture.puml",
  "cache": true,
  "verbose": true,
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
```

Optimized for development with caching and verbose output.

### Example 3: CI/CD Configuration

```json
{
  "source": "./src",
  "output": "./docs/architecture.puml",
  "cache": false,
  "concurrency": 16,
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ]
}
```

Optimized for CI/CD with high concurrency and no caching.

### Example 4: Monorepo Configuration

```json
{
  "projects": [
    {
      "source": "./packages/auth/src",
      "output": "./docs/auth-architecture.puml"
    },
    {
      "source": "./packages/api/src",
      "output": "./docs/api-architecture.puml"
    },
    {
      "source": "./packages/ui/src",
      "output": "./docs/ui-architecture.puml"
    }
  ],
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts"
  ],
  "concurrency": 8
}
```

### Example 5: package.json Integration

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "archguard": {
    "source": "./src",
    "output": "./docs/architecture.puml",
    "exclude": [
      "**/*.test.ts"
    ]
  },
  "scripts": {
    "docs": "archguard analyze"
  }
}
```

---

## Best Practices

### 1. Use Configuration Files

Maintain consistent settings across team:

```bash
archguard init
git add .archguardrc.json
git commit -m "Add ArchGuard configuration"
```

### 2. Separate Environments

Create environment-specific configurations:

```
.archguardrc.json         # Default
.archguardrc.dev.json     # Development
.archguardrc.ci.json      # CI/CD
```

Use with:

```bash
archguard analyze --config .archguardrc.ci.json
```

### 3. Secure API Keys

Never commit API keys:

```json
{
  "anthropicApiKey": "${ANTHROPIC_API_KEY}"
}
```

Use .env file:

```env
# .env (add to .gitignore)
ANTHROPIC_API_KEY=your_key_here
```

### 4. Optimize Exclusions

Exclude unnecessary files for faster parsing:

```json
{
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/dist/**",
    "**/node_modules/**",
    "**/__mocks__/**",
    "**/generated/**"
  ]
}
```

### 5. Tune Concurrency

Adjust based on system resources:

```json
{
  // Development (laptop)
  "concurrency": 4,

  // CI/CD (powerful server)
  "concurrency": 16
}
```

### 6. Enable Caching in Development

Speed up repeated analysis:

```json
{
  "cache": true,
  "cacheDir": "./.archguard-cache"
}
```

### 7. Version Control Configuration

Add to .gitignore if needed:

```
# .gitignore
.archguard-cache/
archguard/  # If regenerating frequently
```

### 8. Document Configuration

Add comments to explain project-specific settings:

```json
{
  "$schema": "https://archguard.dev/schema/config.json",
  // We use higher concurrency due to large project size
  "concurrency": 12,

  // Exclude auto-generated GraphQL files
  "exclude": [
    "**/*.generated.ts"
  ]
}
```

---

## Validation

ArchGuard validates configuration files on load:

```bash
archguard analyze
```

If configuration is invalid:

```
❌ Configuration error:
  - Invalid concurrency: must be a positive integer
  - Unknown format: "yaml" (expected "mermaid" or "json")
```

### Schema Validation

Use JSON schema for IDE autocomplete and validation:

```json
{
  "$schema": "https://archguard.dev/schema/config.json",
  "source": "./src"
}
```

---

## Migration

### From v2.0 (PlantUML) to v2.1 (Mermaid Only)

**Important**: PlantUML support has been completely removed in v2.1.

```json
// Old (v2.0) - No longer supported
{
  "format": "plantuml",
  "output": "./docs/architecture.puml"
}

// New (v2.1) - Use Mermaid
{
  "format": "mermaid",
  "outputDir": "./.archguard/output"
}
```

**Migration Steps**:

1. Update `format` field from `"plantuml"` to `"mermaid"` (or omit, as it's the default)
2. Replace `output` file path with `outputDir` directory
3. Add `mermaid` configuration section (optional)
4. Remove any PlantUML-specific settings

For detailed migration instructions, see [Migration from v1 (PlantUML)](migration-v2.0.md).

### From v1.0 to v1.1

```json
{
  // Old (v1.0)
  "inputDir": "./src",

  // New (v0.2)
  "source": "./src"
}
```

### From Environment Variables Only

Before:

```bash
export ARCHGUARD_SOURCE=./src
archguard analyze
```

After:

```json
{
  "source": "./src"
}
```

```bash
archguard analyze
```

---

## Troubleshooting

Common configuration issues:

### Invalid JSON

```bash
❌ Error: Unexpected token } in JSON at position 123
```

**Solution**: Validate JSON syntax (remove trailing commas, check quotes)

### API Key Not Found

```bash
❌ Error: Anthropic API key is required
```

**Solution**: Set `ANTHROPIC_API_KEY` environment variable

### Path Not Found

```bash
❌ Error: Source directory not found: ./src
```

**Solution**: Verify source path is correct relative to project root

### Concurrency Too High

```bash
⚠ Warning: Concurrency (32) exceeds CPU cores (8)
```

**Solution**: Reduce concurrency to match available resources

---

For more information:
- [CLI Usage Guide](cli-usage.md)
- [Troubleshooting](troubleshooting.md)
- [GitHub Issues](https://github.com/yaleh/archguard/issues)
