# PlantUML Removal Notice (v2.1)

## Summary

**Effective Date**: 2026-01-28
**Version**: v2.1 and later
**Status**: PlantUML support has been completely removed from ArchGuard

ArchGuard v2.1 completes the transition to Mermaid as the sole diagram format, removing all PlantUML-related code, dependencies, and documentation.

## What Changed

### Removed Features

- **PlantUML format**: No longer supported
- **SVG format**: No longer a separate option (SVG always generated with Mermaid)
- **PlantUML validation**: No longer applicable
- **PlantUML-specific configuration**: Removed from schema

### Current Status

**Supported Output Formats**:
- `mermaid` - Default format (generates `.mmd`, `.svg`, and `.png`)
- `json` - ArchJSON data format (no LLM required)

**Removed Formats**:
- `plantuml` - No longer supported
- `svg` - No longer a separate format (SVG always generated with Mermaid)

## Why PlantUML Was Removed

The migration to Mermaid provides significant improvements:

| Metric | PlantUML | Mermaid | Improvement |
|--------|----------|---------|-------------|
| Error Rate | 40-60% | <1% | -98% |
| First-Pass Success | ~5% | >95% | +90% |
| Generation Speed | 30-60s | 5-10s | 5x faster |
| LLM Token Usage | ~7000 | ~2000 | -70% |
| External Dependencies | Claude CLI + PlantUML Java | None (optional LLM) | 100% self-contained |
| Maintainability | PlantUML Java dependency | Pure JS/TS | Full control |

## Migration Guide

### Before (PlantUML v1.x)

```bash
# PlantUML generation
archguard analyze -f plantuml -s ./src

# Output: architecture.puml, architecture.png
```

**Configuration**:
```json
{
  "format": "plantuml",
  "output": "./docs/architecture.puml"
}
```

### After (Mermaid v2.1+)

```bash
# Mermaid generation (default)
archguard analyze -s ./src

# Output: architecture.mmd, architecture.svg, architecture.png
```

**Configuration**:
```json
{
  "format": "mermaid",
  "output": "./docs/architecture"
}
```

### Key Differences

1. **Format Field**:
   - Old: `"format": "plantuml"`
   - New: `"format": "mermaid"` (or omit, as it's the default)

2. **Output Extensions**:
   - Old: `.puml` (PlantUML source)
   - New: `.mmd` (Mermaid source)

3. **Additional Outputs**:
   - Old: Only `.png` (raster)
   - New: `.svg` (vector) + `.png` (raster)

4. **File Structure**:
   - Old: Single `.puml` file
   - New: Multiple files (`.mmd`, `.svg`, `.png`)

## Configuration Migration

### Step 1: Update Format Field

**Before**:
```json
{
  "format": "plantuml"
}
```

**After**:
```json
{
  "format": "mermaid"
}
```

### Step 2: Update Output Path

**Before**:
```json
{
  "output": "./docs/architecture.puml"
}
```

**After**:
```json
{
  "outputDir": "./docs/archguard",
  "diagrams": [
    {
      "name": "architecture",
      "sources": ["./src"]
    }
  ]
}
```

Or use CLI:
```bash
archguard analyze -s ./src --output-dir ./docs/archguard
```

### Step 3: Add Mermaid Configuration (Optional)

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

## CLI Migration

### Command Changes

**Before**:
```bash
# PlantUML format
archguard analyze -f plantuml -s ./src

# SVG format (separate option)
archguard analyze -f svg -s ./src
```

**After**:
```bash
# Mermaid format (default)
archguard analyze -s ./src

# SVG always generated
archguard analyze -s ./src --output-dir ./docs
```

### New CLI Options

```bash
# Mermaid-specific options
archguard analyze --mermaid-theme dark
archguard analyze --no-llm-grouping
archguard analyze --mermaid-renderer cli
```

## Benefits of Mermaid

### 1. Reliability

- **98% fewer errors**: Error rate reduced from 40-60% to <1%
- **95% first-pass success**: Up from ~5%
- **No syntax errors**: Built-in validation and auto-repair

### 2. Performance

- **5x faster**: Generation time reduced from 30-60s to 5-10s
- **70% less token usage**: Reduced from ~7000 to ~2000 tokens
- **Local rendering**: No external Java dependency

### 3. Maintainability

- **Pure JS/TS**: Full control over rendering stack
- **No Java dependency**: Self-contained with isomorphic-mermaid
- **Better error handling**: Clear, actionable error messages

### 4. Output Quality

- **Vector graphics**: SVG output for scalable diagrams
- **Multiple themes**: default, forest, dark, neutral
- **Transparent backgrounds**: For better integration

### 5. Features

- **LLM grouping**: Optional intelligent entity grouping
- **Five-layer validation**: Syntax, structure, render, quality, auto-repair
- **Quality metrics**: Readability, completeness, consistency scores

## Syntax Comparison

### PlantUML (v1.x)

```puml
@startuml
namespace "UserService" {
  class UserService {
    - users: Map<string, User>
    + getUser(id: string): Promise<User>
    + createUser(data: UserData): Promise<User>
  }
}

interface User {
  + id: string
  + name: string
  + email: string
}

UserService ..> User : uses
@enduml
```

### Mermaid (v2.1+)

```mmd
graph TD
  subgraph UserService [UserService Module]
    UserService[UserService<br/>users: Map<string, User><br/>+ getUser(id): Promise<User><br/>+ createUser(data): Promise<User>]
  end

  User[User<br/>+ id: string<br/>+ name: string<br/>+ email: string]

  UserService --> User : uses
```

## File Comparison

### PlantUML Output (v1.x)

```
archguard/
└── architecture.puml    # PlantUML source
└── architecture.png     # Raster image
```

### Mermaid Output (v2.1+)

```
archguard/
└── architecture.mmd     # Mermaid source
└── architecture.svg     # Vector image (NEW!)
└── architecture.png     # Raster image
```

## Rollback Instructions

If you need to use PlantUML (not recommended):

### Option 1: Stay on v1.x

```bash
# Install PlantUML version
npm install archguard@1.x

# Restore old config
cp archguard.config.json.bak archguard.config.json
```

### Option 2: Manual Conversion

Use PlantUML's Mermaid export:
```bash
# Convert Mermaid to PlantUML (external tools)
# Note: This is not officially supported
```

**Recommendation**: Use Mermaid directly. See [Mermaid Documentation](https://mermaid.js.org/).

## Getting Help

### Resources

- **Migration Guide**: [docs/MIGRATION-v2.0.md](MIGRATION-v2.0.md)
- **Mermaid Docs**: https://mermaid.js.org/
- **GitHub Issues**: https://github.com/your-org/archguard/issues
- **Discussions**: https://github.com/your-org/archguard/discussions

### Common Issues

**Issue**: "Format plantuml is no longer supported"

**Solution**: Update config or CLI to use `-f mermaid` or omit (default).

**Issue**: "Missing architecture.puml file"

**Solution**: Check for `architecture.mmd`, `architecture.svg`, `architecture.png` instead.

**Issue**: "Diagram looks different"

**Solution**: This is expected. Mermaid syntax differs from PlantUML. Use `--verbose` to see quality metrics.

### Support Channels

1. **Documentation**: See [docs/](../README.md)
2. **Troubleshooting**: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
3. **GitHub Issues**: Create issue with `v2-migration` label

## Timeline

- **v1.x**: PlantUML support (maintenance mode)
- **v2.0**: Initial Mermaid migration (PlantUML deprecated)
- **v2.1**: PlantUML completely removed

**Note**: v1.x will only receive security updates. No new features will be added.

## Summary

| Aspect | PlantUML (v1.x) | Mermaid (v2.1+) |
|--------|----------------|-----------------|
| Format | `.puml` | `.mmd` |
| Output | PNG only | SVG + PNG |
| Error Rate | 40-60% | <1% |
| Speed | 30-60s | 5-10s |
| Dependencies | Java + Claude CLI | Optional LLM only |
| Status | Deprecated | ✅ Recommended |

## Next Steps

1. **Update Configuration**: Change `"format": "plantuml"` to `"format": "mermaid"`
2. **Test Migration**: Run `archguard analyze --no-llm-grouping`
3. **Review Output**: Check `.mmd`, `.svg`, `.png` files
4. **Update CI/CD**: Remove PlantUML-specific commands
5. **Delete Old Files**: Remove `.puml` files if no longer needed

---

**Last Updated**: 2026-01-28
**ArchGuard Version**: 2.1.0
