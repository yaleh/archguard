# Custom Config File Paths

## Overview

The `--config` CLI option allows you to specify a custom configuration file path instead of using the default `archguard.config.json` or `archguard.config.js` files in the current directory.

## Usage

```bash
# Use custom config file
node dist/cli/index.js analyze --config path/to/my-config.json

# Relative path
node dist/cli/index.js analyze --config ./configs/production.config.json

# Absolute path
node dist/cli/index.js analyze --config /absolute/path/to/config.json

# With additional CLI options (CLI options override config file)
node dist/cli/index.js analyze --config my-config.json --format json -v
```

## Supported Formats

The custom config file can be either:
- `.json` - JSON configuration file
- `.js` - JavaScript ES module with `export default`

## Example

### Custom Config File

Create a custom configuration file `my-project.config.json`:

```json
{
  "outputDir": "./docs/architecture",
  "format": "plantuml",
  "diagrams": [
    {
      "name": "overview",
      "sources": ["./src/core", "./src/api"],
      "level": "package",
      "description": "High-level architecture overview"
    },
    {
      "name": "core-detailed",
      "sources": ["./src/core"],
      "level": "class",
      "description": "Detailed view of core module"
    }
  ]
}
```

### Run with Custom Config

```bash
node dist/cli/index.js analyze --config my-project.config.json -v
```

Output:
```
✔ Configuration loaded
ℹ Found 2 diagram(s) to generate
- Processing diagram: overview
- Processing diagram: core-detailed
...
```

## Behavior

### Config Priority

When `--config` is specified:
1. Load the specified config file
2. Merge with CLI options (CLI options take precedence)
3. Apply defaults for any unspecified values

### Without `--config` Option

When no `--config` is specified:
1. Search for `archguard.config.json` in current directory
2. If not found, search for `archguard.config.js`
3. If neither found, use defaults with CLI options

### Config Overrides

CLI options always override config file values:

```bash
# Config file has format: "json"
# CLI overrides with format: "plantuml"
node dist/cli/index.js analyze --config my-config.json --format plantuml

# Result: format will be "plantuml"
```

## Error Handling

### File Not Found

If the specified config file doesn't exist:

```bash
node dist/cli/index.js analyze --config nonexistent.json
```

Output:
```
✖ Analysis failed

Error
  Config file not found: nonexistent.json
```

### Invalid Config

If the config file contains invalid configuration:

```bash
node dist/cli/index.js analyze --config invalid.json
```

Output:
```
✖ Analysis failed

Error
  Configuration validation failed:
  - format: Invalid enum value. Expected 'plantuml' | 'json' | 'svg', received 'invalid'
```

## Use Cases

### 1. Multiple Environments

Maintain separate configs for different environments:

```bash
# Development config
node dist/cli/index.js analyze --config configs/dev.config.json

# Production config
node dist/cli/index.js analyze --config configs/prod.config.json

# Testing config
node dist/cli/index.js analyze --config configs/test.config.json
```

### 2. Project-Specific Configs

Keep configs organized by project or module:

```bash
# Frontend architecture
node dist/cli/index.js analyze --config frontend.config.json

# Backend architecture
node dist/cli/index.js analyze --config backend.config.json

# Full stack architecture
node dist/cli/index.js analyze --config fullstack.config.json
```

### 3. Shared Team Configs

Store configs in a shared location:

```bash
# Team standard config
node dist/cli/index.js analyze --config /shared/team/archguard-standard.json

# Override output directory per developer
node dist/cli/index.js analyze --config /shared/team/archguard-standard.json --output-dir ./my-output
```

### 4. CI/CD Integration

Use different configs in CI/CD pipelines:

```yaml
# .github/workflows/architecture.yml
- name: Generate Architecture Diagrams
  run: |
    node dist/cli/index.js analyze --config .github/configs/ci.config.json
```

## Implementation Details

### ConfigLoader API

The `ConfigLoader.load()` method signature:

```typescript
async load(cliOptions: Partial<Config> = {}, configPath?: string): Promise<Config>
```

Parameters:
- `cliOptions`: CLI options to override config file values
- `configPath`: Optional custom config file path

### Path Resolution

- Relative paths are resolved from the current working directory (`process.cwd()`)
- Absolute paths are used as-is
- The config file must exist and be readable

### File Format Detection

The config loader detects the format by file extension:
- `.json` → Loaded with `fs.readJson()`
- `.js` → Loaded with dynamic `import()`
- Other extensions → Error

## Testing

See comprehensive tests in:
- `tests/unit/cli/config-loader.test.ts`
- `tests/integration/custom-config-path.test.ts`

Run tests:
```bash
npm test -- tests/integration/custom-config-path.test.ts
```

## See Also

- [Configuration File Support](./configuration.md)
- [CLI Usage Guide](./cli-usage.md)
- [CLAUDE.md](../CLAUDE.md) - Project instructions
