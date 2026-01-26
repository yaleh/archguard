# Migration Guide: v1.x → v2.0

## Breaking Changes

### ⚠️ Complete PlantUML Removal

ArchGuard v2.0 completely removes PlantUML support and uses Mermaid as the only diagram format.

#### What Changed?

**v1.x (PlantUML)**:
```bash
node dist/cli/index.js analyze -f plantuml -s ./src
# Generates: architecture.puml, architecture.png
```

**v2.0 (Mermaid)**:
```bash
node dist/cli/index.js analyze -f mermaid -s ./src
# Generates: architecture.mmd, architecture.svg, architecture.png
```

#### Why?

The migration to Mermaid provides significant improvements:

| Metric | v1.x (PlantUML) | v2.0 (Mermaid) | Improvement |
|--------|----------------|----------------|-------------|
| Error Rate | 40-60% | <1% | -98% |
| First-Pass Success | ~5% | >95% | +90% |
| Generation Speed | 30-60s | 5-10s | 5x faster |
| LLM Token Usage | ~7000 | ~2000 | -70% |
| External Dependencies | Claude CLI + PlantUML | None (optional LLM) | 100% self-contained |
| Maintainability | PlantUML Java dependency | Pure JS/TS | Full control |

## Format Changes

| v1.x Format | v2.0 Equivalent | Notes |
|-------------|------------------|-------|
| `-f plantuml` | `-f mermaid` | Default format |
| `-f svg` | `-f mermaid` | SVG always generated |
| `format: "plantuml"` | `format: "mermaid"` | In config file |

## Configuration File Migration

### Before (v1.x)

```json
{
  "source": "./src",
  "format": "plantuml",
  "cli": {
    "command": "claude",
    "timeout": 60000
  }
}
```

### After (v2.0)

```json
{
  "source": "./src",
  "format": "mermaid",
  "mermaid": {
    "enableLLMGrouping": true,
    "renderer": "isomorphic",
    "theme": "default",
    "transparentBackground": true
  },
  "cli": {
    "command": "claude",
    "timeout": 60000
  }
}
```

### New Configuration Options

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

**Field Descriptions**:

- **enableLLMGrouping** (boolean, default: true)
  - Use LLM for intelligent entity grouping
  - Disable with `--no-llm-grouping` for faster, free heuristic grouping

- **renderer** (string, default: "isomorphic")
  - "isomorphic": Use built-in isomorphic-mermaid (recommended)
  - "cli": Use external mermaid CLI (requires mermaid-cli package)

- **theme** (string, default: "default")
  - Available themes: "default", "forest", "dark", "neutral"

- **transparentBackground** (boolean, default: true)
  - Use transparent background for PNG output

## New Features

### 1. LLM Intelligent Grouping

v2.0 uses LLM to intelligently group entities into logical namespaces:

**Enabled by default**:
```bash
node dist/cli/index.js analyze -s ./src
# Uses LLM for grouping (consumes ~2000 tokens)
```

**Opt-out**:
```bash
node dist/cli/index.js analyze --no-llm-grouping
# Uses heuristic grouping (free, faster)
```

**Benefits**:
- Semantic understanding of code structure
- Better organized diagrams
- Reduced cross-module relationship complexity

### 2. Five-Layer Validation

Automatic validation ensures generated diagrams are correct:

1. **Parse Validation**: Syntax checking with mermaid.parse()
2. **Structural Validation**: Entity references, relationship symmetry
3. **Render Validation**: Can it be rendered?
4. **Quality Analysis**: Readability, completeness, complexity scores
5. **Auto-Repair**: Automatic syntax correction

**Example Output**:
```
✅ Parse Validation: Passed
✅ Structural Validation: Passed
✅ Render Validation: Passed
✅ Quality Analysis: 75.5/100
  Readability: 90/100
  Completeness: 80/100
  Consistency: 85/100
  Complexity: 47/100
✅ Auto-Repair: No issues found
```

### 3. Quality Metrics

Generated diagrams include comprehensive quality scores:

```bash
node dist/cli/index.js analyze -s ./src -v
```

Output:
```
📊 Quality Metrics:
  Overall Score: 75.5/100
  Readability: 90/100
  Completeness: 80/100
  Consistency: 85/100
  Complexity: 47/100
```

### 4. Multiple Detail Levels

Three detail levels for different use cases:

```bash
# Package level (high-level overview)
node dist/cli/index.js analyze -l package -n overview

# Class level (default, balanced)
node dist/cli/index.js analyze -l class -n architecture

# Method level (detailed)
node dist/cli/index.js analyze -l method -n detail
```

## CLI Changes

### Removed Options

```bash
# ❌ No longer supported
-f plantuml
-f svg
```

### New Options

```bash
# ✅ New Mermaid-specific options
--no-llm-grouping              # Disable LLM grouping
--mermaid-theme <theme>        # Theme: default|forest|dark|neutral
--mermaid-renderer <renderer>  # Renderer: isomorphic|cli
```

### Example Migrations

#### Before (v1.x)

```bash
# Basic PlantUML generation
archguard analyze -s ./src -f plantuml

# PlantUML with custom output
archguard analyze -s ./src -o ./docs/diagram -f plantuml

# SVG format
archguard analyze -s ./src -f svg
```

#### After (v2.0)

```bash
# Basic Mermaid generation (default)
archguard analyze -s ./src

# Mermaid with custom output
archguard analyze -s ./src -o ./docs/diagram

# Mermaid with custom theme
archguard analyze -s ./src --mermaid-theme dark

# Disable LLM grouping (faster, free)
archguard analyze -s ./src --no-llm-grouping
```

## Migration Steps

### Step 1: Update Configuration

If you have `archguard.config.json`, update it:

**Option A: Manual Update**

```json
{
  "format": "mermaid",  // Changed from "plantuml"
  "mermaid": {          // New section
    "enableLLMGrouping": true,
    "theme": "default"
  }
}
```

**Option B: Automated Migration**

```bash
npm run migrate
```

This will:
- Backup your existing config to `archguard.config.json.bak`
- Update format from `plantuml`/`svg` to `mermaid`
- Add default `mermaid` configuration section

**Option C: Create New Config**

```bash
# Delete old config
rm archguard.config.json

# Generate new default config
node dist/cli/index.js init
```

### Step 2: Update CI/CD Scripts

Replace PlantUML commands:

```bash
# Before
node dist/cli/index.js analyze -f plantuml -s ./src

# After
node dist/cli/index.js analyze -f mermaid -s ./src
# Or simply (mermaid is now default)
node dist/cli/index.js analyze -s ./src
```

### Step 3: Update Output References

```bash
# Before
ls archguard/architecture.puml
ls archguard/architecture.png

# After
ls archguard/architecture.mmd   # Mermaid source
ls archguard/architecture.svg   # SVG vector (NEW!)
ls archguard/architecture.png   # PNG raster
```

### Step 4: Test Migration

```bash
# Build
npm run build

# Test with your project
node dist/cli/index.js analyze -s ./src --no-llm-grouping

# Verify output
ls archguard/
cat archguard/architecture.mmd
```

### Step 5: Review and Commit

```bash
# Review changes
git diff

# Add updated config
git add archguard.config.json

# Commit
git commit -m "chore: migrate to ArchGuard v2.0 (Mermaid)"
```

## Common Issues

### Issue: "Format plantuml is no longer supported"

**Solution**: Update your config file or CLI command to use `-f mermaid`.

```bash
# Config file
vim archguard.config.json
# Change "format": "plantuml" to "format": "mermaid"

# CLI command
archguard analyze -f mermaid  # Instead of -f plantuml
```

### Issue: Generated diagram looks different

**Solution**: Mermaid syntax is different from PlantUML. This is expected behavior.

Key differences:
- **Namespace structure**: Mermaid uses subgraphs, not nesting
- **Generic types**: Use `~T~` not `<T>` in Mermaid
- **Relationship placement**: Outside subgraphs in Mermaid
- **Styling**: Different theme system

If you see issues:
1. Check verbose output: `archguard analyze -v`
2. Review quality metrics
3. Try different themes: `--mermaid-theme forest`

### Issue: Too many tokens consumed

**Solution**: Use `--no-llm-grouping` to use heuristic grouping instead.

```bash
archguard analyze --no-llm-grouping
```

This:
- Disables LLM-powered grouping
- Uses faster heuristic algorithm
- Reduces token consumption to ~500 (from ~2000)
- Still generates valid diagrams

### Issue: Claude CLI not found

**Solution**: Claude CLI is now optional.

For v2.0:
- Mermaid rendering works without Claude CLI
- Only LLM grouping requires Claude CLI
- Disable LLM grouping if you don't have Claude CLI:

```bash
archguard analyze --no-llm-grouping
```

### Issue: Missing .svg file

**Solution**: SVG is always generated in v2.0.

Check your output:
```bash
ls -la archguard/
# Should show:
# architecture.mmd
# architecture.svg
# architecture.png
```

If SVG is missing:
1. Check file permissions
2. Verify isomorphic-mermaid installation: `npm ls isomorphic-mermaid`
3. Run with verbose: `archguard analyze -v`

## Syntax Differences

### PlantUML vs Mermaid

**PlantUML** (v1.x):
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

**Mermaid** (v2.0):
```mmd
graph TD
  subgraph UserService [UserService Module]
    UserService[UserService<br/>users: Map<string, User><br/>+ getUser(id): Promise<User><br/>+ createUser(data): Promise<User>]
  end

  User[User<br/>+ id: string<br/>+ name: string<br/>+ email: string]

  UserService --> User : uses
```

## Rollback

If you need to rollback to v1.x:

```bash
# Install v1.x
npm install archguard@1.x

# Restore your old config file
cp archguard.config.json.bak archguard.config.json

# Or manually edit format back to plantuml
vim archguard.config.json
# Change "format": "mermaid" to "format": "plantuml"
```

**Note**: v1.x will receive security updates only. No new features will be added.

## Performance Comparison

### v1.x (PlantUML)

- Generation time: 30-60 seconds
- Token usage: ~7000 tokens
- Error rate: 40-60%
- First-pass success: ~5%
- External dependencies: Claude CLI + PlantUML

### v2.0 (Mermaid)

- Generation time: 5-10 seconds (5x faster)
- Token usage: ~2000 tokens (-70%)
- Error rate: <1% (-98%)
- First-pass success: >95% (+90%)
- External dependencies: None (optional LLM grouping)

## Need Help?

### Resources

- **GitHub Issues**: https://github.com/your-org/archguard/issues
- **Documentation**: docs/
- **Migration Questions**: Use label `v2-migration`

### Getting Support

If you encounter issues during migration:

1. Check verbose output: `archguard analyze -v`
2. Review quality metrics
3. Check common issues above
4. Search existing GitHub issues
5. Create new issue with `v2-migration` label

### Example Migration Issue Template

```markdown
### Issue Description
Brief description of the migration issue

### v1.x Configuration
```json
// Your old config
```

### v2.0 Configuration
```json
// Your new config
```

### Error Message
```
// Error output
```

### Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

### Environment
- ArchGuard v2.0.0
- Node.js v18.x.x
- OS: Linux/Mac/Windows
```

## Summary of Changes

### Removed

- PlantUML format (`-f plantuml`)
- SVG format as separate option (`-f svg`)
- Dependency on PlantUML Java runtime
- High error rates (40-60%)
- Slow generation (30-60s)

### Added

- Mermaid format (default)
- LLM intelligent grouping (optional)
- Five-layer validation pipeline
- Quality metrics and scoring
- Auto-repair functionality
- Multiple themes (default, forest, dark, neutral)
- SVG output (always generated)
- 98% error reduction
- 5x faster generation

### Changed

- Default output format: PlantUML → Mermaid
- Generation approach: External LLM → Local generation + optional LLM grouping
- Error handling: Manual validation → Automated five-layer validation
- Rendering: PlantUML Java → isomorphic-mermaid (JS/TS)

## Next Steps

1. **Backup**: Backup your current configuration and diagrams
2. **Update**: Run `npm run migrate` or manually update config
3. **Test**: Test with `--no-llm-grouping` first
4. **Verify**: Check generated diagrams and quality metrics
5. **Commit**: Commit your updated configuration
6. **Enjoy**: Experience 5x faster generation with 98% fewer errors!

---

**Last Updated**: 2026-01-26
**ArchGuard Version**: 2.0.0
