# ArchGuard Configuration Examples

This directory contains example configuration files for ArchGuard v1.1.

## Examples

### 1. Basic Configuration (`basic-config.json`)

A minimal configuration with default settings suitable for most projects.

**Use case**: Standard TypeScript projects with default requirements

**Key features**:
- Default Claude CLI command
- Default timeout (60 seconds)
- Caching enabled
- Standard exclusions (test files, node_modules)

**Usage**:

```bash
# Copy to your project
cp examples/basic-config.json archguard.config.json

# Run with default settings
archguard analyze
```

---

### 2. Advanced Configuration (`advanced-config.json`)

Configuration for monorepos or projects requiring higher performance.

**Use case**: Large projects, monorepos, or projects needing higher quality output

**Key features**:
- Custom model selection (Claude Opus for highest quality)
- Extended timeout (120 seconds)
- Higher concurrency (8 workers)
- Verbose output enabled
- Custom output directory

**Usage**:

```bash
# Copy to your project
cp examples/advanced-config.json archguard.config.json

# Edit source path for your project
# Then run
archguard analyze
```

---

### 3. Custom CLI Configuration (`custom-cli-config.json`)

Configuration using a custom Claude CLI path and additional arguments.

**Use case**: Non-standard Claude CLI installation or custom CLI arguments

**Key features**:
- Custom CLI path (`/usr/local/bin/claude`)
- Multiple CLI arguments (model selection, max tokens)
- Custom timeout
- Caching disabled (for CI/CD)

**Usage**:

```bash
# Copy to your project
cp examples/custom-cli-config.json archguard.config.json

# Update cli.command to your Claude CLI path
# Then run
archguard analyze
```

---

### 4. Legacy Configuration (`legacy-config.json`)

**DEPRECATED**: Old v1.0 configuration format (for reference only).

This file shows the deprecated `ai` configuration format. ArchGuard v1.1 will automatically migrate this format, but it's recommended to update to the new format.

**Deprecated fields**:
- `ai.model` → Use `cli.args: ["--model", "..."]` instead
- `ai.timeout` → Use `cli.timeout` instead
- `ai.apiKey` → **Removed** (Claude CLI uses its own authentication)
- `ai.maxTokens` → **Removed** (not applicable to CLI)
- `ai.temperature` → **Removed** (not applicable to CLI)

**Migration**: See `migrated-config.json` for the updated version.

---

### 5. Migrated Configuration (`migrated-config.json`)

The v1.1 version of `legacy-config.json` after migration.

**Use case**: Reference for migrating from v1.0 to v1.1

**Key changes from legacy**:
- `ai.model` → `cli.args: ["--model", "claude-sonnet-4-20250514"]`
- `ai.timeout` → `cli.timeout: 120000`
- Removed `ai.apiKey`, `ai.maxTokens`, `ai.temperature`
- Added `outputDir` for centralized path management

**See also**: [MIGRATION.md](../MIGRATION.md) for complete migration guide.

---

## Common Configuration Patterns

### Pattern 1: Development Configuration

For local development with fast feedback:

```json
{
  "cache": { "enabled": true },
  "concurrency": 4,
  "verbose": false
}
```

### Pattern 2: CI/CD Configuration

For CI/CD pipelines with consistent builds:

```json
{
  "cache": { "enabled": false },
  "concurrency": 16,
  "verbose": true,
  "cli": {
    "timeout": 120000
  }
}
```

### Pattern 3: High-Quality Output

For best-quality diagrams using Claude Opus:

```json
{
  "cli": {
    "args": ["--model", "claude-opus-4-20250514"],
    "timeout": 120000
  }
}
```

### Pattern 4: Fast Iteration

For quick diagram generation during development:

```json
{
  "cli": {
    "args": ["--model", "claude-3-5-haiku-20241022"],
    "timeout": 30000
  },
  "cache": { "enabled": true }
}
```

---

## CLI Usage Examples

### Basic Usage

```bash
# Use default configuration
archguard analyze

# Specify source directory
archguard analyze -s ./src

# Specify output file
archguard analyze -s ./src -o ./docs/architecture.puml
```

### Custom CLI Command

```bash
# Use custom Claude CLI path
archguard analyze --cli-command /usr/local/bin/claude
```

### Model Selection

```bash
# Use specific model via CLI arguments
archguard analyze --cli-args "--model claude-opus-4-20250514"
```

### Custom Output Directory

```bash
# Specify output directory
archguard analyze --output-dir ./docs/diagrams
```

### Combining Options

```bash
# Complete example with multiple options
archguard analyze \
  --source ./packages/core/src \
  --output ./docs/core-architecture.puml \
  --cli-command /usr/local/bin/claude \
  --cli-args "--model claude-opus-4-20250514" \
  --output-dir ./docs/diagrams \
  --concurrency 8 \
  --verbose
```

---

## NPM Script Integration

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "docs": "archguard analyze",
    "docs:verbose": "archguard analyze -v",
    "docs:clean": "archguard cache clear && archguard analyze",
    "docs:json": "archguard analyze -f json -o ./architecture.json",
    "docs:opus": "archguard analyze --cli-args '--model claude-opus-4-20250514'"
  }
}
```

Usage:

```bash
npm run docs           # Generate diagrams
npm run docs:verbose   # Generate with verbose output
npm run docs:clean     # Clear cache and regenerate
npm run docs:json      # Generate JSON output
npm run docs:opus      # Generate using Claude Opus
```

---

## Monorepo Configuration

For monorepos, create separate config files for each package:

```
my-monorepo/
├── packages/
│   ├── auth/
│   │   └── archguard.config.json    # Auth package config
│   ├── api/
│   │   └── archguard.config.json    # API package config
│   └── ui/
│       └── archguard.config.json    # UI package config
└── package.json
```

Example package config:

```json
{
  "source": "./src",
  "output": "../../docs/auth-architecture.puml",
  "cli": {
    "args": ["--model", "claude-sonnet-4-20250514"]
  }
}
```

---

## Environment-Specific Configurations

### Development (`.archguardrc.dev.json`)

```json
{
  "cache": { "enabled": true },
  "verbose": true,
  "cli": {
    "timeout": 60000
  }
}
```

### Production (`.archguardrc.prod.json`)

```json
{
  "cache": { "enabled": false },
  "verbose": false,
  "cli": {
    "args": ["--model", "claude-opus-4-20250514"],
    "timeout": 120000
  }
}
```

Usage:

```bash
# Development
archguard analyze --config .archguardrc.dev.json

# Production
archguard analyze --config .archguardrc.prod.json
```

---

## Troubleshooting

### Issue: Deprecation Warnings

**Symptom**: Warnings about deprecated `ai.*` fields

**Solution**: Migrate to new `cli.*` format using `migrated-config.json` as reference.

### Issue: CLI Not Found

**Symptom**: Error about Claude CLI not found

**Solution**:

1. Check Claude CLI installation:
   ```bash
   claude --version
   ```

2. Update `cli.command` in config:
   ```json
   {
     "cli": {
       "command": "/path/to/your/claude"
     }
   }
   ```

### Issue: Timeout Errors

**Symptom**: Analysis times out on large projects

**Solution**: Increase timeout in config:

```json
{
  "cli": {
    "timeout": 180000
  }
}
```

---

## Additional Resources

- [Configuration Reference](../docs/CONFIGURATION.md)
- [CLI Usage Guide](../docs/CLI-USAGE.md)
- [Migration Guide](../MIGRATION.md)
- [Main Documentation](../README.md)
