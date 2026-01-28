# ArchGuard Troubleshooting Guide

Common issues and their solutions when using ArchGuard.

## Table of Contents

- [Installation Issues](#installation-issues)
- [API and Authentication](#api-and-authentication)
- [Parsing Errors](#parsing-errors)
- [Performance Issues](#performance-issues)
- [Cache Problems](#cache-problems)
- [Output Generation](#output-generation)
- [Memory and Resource Issues](#memory-and-resource-issues)
- [Configuration Errors](#configuration-errors)

---

## Installation Issues

### NPM Install Fails

**Problem**: `npm install archguard` fails with errors

**Solutions**:

1. Update Node.js to version 18 or higher:
```bash
node --version  # Should be >= 18.0.0
```

2. Clear npm cache:
```bash
npm cache clean --force
npm install archguard
```

3. Try with different package manager:
```bash
yarn add archguard
# or
pnpm add archguard
```

### Command Not Found

**Problem**: `archguard: command not found`

**Solutions**:

1. If installed globally, check global bin path:
```bash
npm list -g archguard
npm bin -g
```

2. Add to PATH:
```bash
export PATH="$(npm bin -g):$PATH"
```

3. Use npx instead:
```bash
npx archguard analyze
```

4. Check local installation:
```bash
npm list archguard
npx archguard --version
```

---

## API and Authentication

### API Key Not Found

**Problem**: `Error: Anthropic API key is required`

**Solutions**:

1. Set environment variable:
```bash
export ANTHROPIC_API_KEY=your_api_key_here
archguard analyze
```

2. Create .env file:
```bash
echo "ANTHROPIC_API_KEY=your_api_key_here" > .env
```

3. Add to configuration file:
```json
{
  "anthropicApiKey": "${ANTHROPIC_API_KEY}"
}
```

4. Verify the key is set:
```bash
echo $ANTHROPIC_API_KEY
```

### API Key Invalid

**Problem**: `Error: Invalid API key`

**Solutions**:

1. Check key format (should start with `sk-ant-`):
```bash
echo $ANTHROPIC_API_KEY | head -c 10
# Should output: sk-ant-...
```

2. Verify key is active in Anthropic Console

3. Generate new API key if needed

### API Rate Limit

**Problem**: `Error: Rate limit exceeded`

**Solutions**:

1. Wait before retrying:
```bash
sleep 60
archguard analyze
```

2. Use JSON output to avoid API calls:
```bash
archguard analyze -f json
```

3. Reduce concurrent API calls in your workflow

### API Network Errors

**Problem**: `Error: Network request failed`

**Solutions**:

1. Check internet connection:
```bash
ping api.anthropic.com
```

2. Check proxy settings:
```bash
echo $HTTP_PROXY
echo $HTTPS_PROXY
```

3. Retry with longer timeout:
```bash
# Future feature: --timeout option
```

---

## Parsing Errors

### TypeScript Syntax Errors

**Problem**: `Error: Cannot parse file: syntax error at line 42`

**Solutions**:

1. Use `--verbose` to see which file failed:
```bash
archguard analyze -v
```

2. Exclude problematic files:
```bash
archguard analyze -e "src/broken-file.ts"
```

3. Fix TypeScript syntax errors in source files

4. Use `--no-strict` mode (if available):
```bash
# Future feature: --no-strict
```

### Cannot Find Module

**Problem**: `Error: Cannot find module './missing-file'`

**Solutions**:

1. Ensure all imports resolve correctly:
```bash
tsc --noEmit
```

2. Add path aliases to tsconfig.json:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

3. Check file extensions in imports

### Parsing Performance Slow

**Problem**: Parsing takes too long

**Solutions**:

1. Increase concurrency:
```bash
archguard analyze -c 8
```

2. Exclude unnecessary files:
```json
{
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**"
  ]
}
```

3. Enable caching:
```bash
archguard analyze  # Cache enabled by default
```

4. Check CPU usage:
```bash
top  # Look for high CPU processes
```

---

## Performance Issues

### Analysis Very Slow

**Problem**: Analysis takes more than expected time

**Diagnosis**:

```bash
# Run with verbose mode to see progress
archguard analyze -v

# Check file count
archguard analyze | grep "Found"
```

**Solutions**:

1. **Optimize concurrency**:
```bash
# Default uses CPU cores
archguard analyze

# Custom concurrency
archguard analyze -c 8
```

2. **Exclude large directories**:
```json
{
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**"
  ]
}
```

3. **Use cache**:
```bash
# First run: slow
archguard analyze

# Second run: fast (with cache)
archguard analyze
```

4. **Check disk I/O**:
```bash
iostat -x 1
```

### High Memory Usage

**Problem**: Process using too much memory

**Diagnosis**:

```bash
# Monitor memory during analysis
archguard analyze -v &
top -p $!
```

**Solutions**:

1. **Reduce concurrency**:
```bash
archguard analyze -c 2
```

2. **Process in batches**:
```bash
archguard analyze -s ./src/module1
archguard analyze -s ./src/module2
```

3. **Exclude large files**:
```bash
archguard analyze -e "**/*.generated.ts"
```

4. **Increase system memory** or use smaller chunks

### CPU Throttling

**Problem**: High CPU usage causing system slowdown

**Solutions**:

1. **Limit concurrency**:
```bash
archguard analyze -c 2
```

2. **Run with nice priority**:
```bash
nice -n 10 archguard analyze
```

3. **Schedule during off-hours** in CI/CD

---

## Cache Problems

### Cache Not Working

**Problem**: Every run is slow, cache not being used

**Diagnosis**:

```bash
# Check cache stats
archguard cache stats

# Check cache directory
archguard cache path
ls -la $(archguard cache path)
```

**Solutions**:

1. **Verify cache is enabled**:
```json
{
  "cache": true
}
```

2. **Check cache directory permissions**:
```bash
ls -la ~/.archguard/cache
chmod 755 ~/.archguard/cache
```

3. **Clear and rebuild cache**:
```bash
archguard cache clear
archguard analyze
```

### Cache Directory Full

**Problem**: Cache consuming too much disk space

**Diagnosis**:

```bash
du -sh ~/.archguard/cache
```

**Solutions**:

1. **Clear cache**:
```bash
archguard cache clear
```

2. **Use custom cache location** with more space:
```json
{
  "cacheDir": "/large-disk/archguard-cache"
}
```

3. **Implement cache cleanup** in CI/CD:
```bash
# Clean cache older than 7 days
find ~/.archguard/cache -mtime +7 -delete
```

### Cache Corruption

**Problem**: `Error: Cannot read cache file`

**Solutions**:

1. **Clear corrupted cache**:
```bash
archguard cache clear
archguard analyze
```

2. **Delete specific cache files**:
```bash
rm -rf ~/.archguard/cache/*
```

---

## Output Generation

### Mermaid Generation Fails

**Problem**: `Error: Failed to generate Mermaid diagram`

**Solutions**:

1. **Check verbose output** for detailed error:
```bash
archguard analyze -v
```

2. **Try JSON output** first to verify parsing:
```bash
archguard analyze -f json -o output.json
```

3. **Check output directory permissions**:
```bash
mkdir -p ./docs
chmod 755 ./docs
```

4. **Verify isomorphic-mermaid installation**:
```bash
npm ls isomorphic-mermaid
```

### Invalid Mermaid Syntax

**Problem**: Generated Mermaid has syntax errors

**Solutions**:

1. **Use verbose mode** to see validation results:
```bash
archguard analyze -v
```

2. **Check quality metrics** in verbose output:
```
✅ Parse Validation: Passed
✅ Structural Validation: Passed
✅ Render Validation: Passed
✅ Quality Analysis: 75.5/100
```

3. **Report issue** with:
   - Source files (if possible)
   - Generated Mermaid (.mmd file)
   - ArchGuard version
   - Quality metrics output

4. **Try different themes** if rendering issues:
```bash
archguard analyze --mermaid-theme forest
```

### Output File Not Created

**Problem**: No output file generated

**Solutions**:

1. **Check output path**:
```bash
archguard analyze -o /full/path/to/output
```

2. **Verify directory exists**:
```bash
mkdir -p docs
archguard analyze -o docs/architecture
```

3. **Check file permissions**:
```bash
ls -la docs/
```

4. **Use absolute paths**:
```bash
archguard analyze -o $(pwd)/docs/architecture
```

5. **Check for all output files**:
```bash
ls -la archguard/
# Should show:
# architecture.mmd  (Mermaid source)
# architecture.svg  (Vector image)
# architecture.png  (Raster image)
```

---

## Memory and Resource Issues

### Out of Memory

**Problem**: `Error: JavaScript heap out of memory`

**Solutions**:

1. **Increase Node.js memory**:
```bash
NODE_OPTIONS="--max-old-space-size=4096" archguard analyze
```

2. **Reduce concurrency**:
```bash
archguard analyze -c 2
```

3. **Process in smaller batches**:
```bash
archguard analyze -s ./src/module1
```

4. **Exclude large files**:
```bash
archguard analyze -e "**/*.generated.ts" -e "**/large-file.ts"
```

### File Descriptor Limit

**Problem**: `Error: EMFILE: too many open files`

**Solutions**:

1. **Increase file descriptor limit**:
```bash
ulimit -n 4096
archguard analyze
```

2. **Reduce concurrency**:
```bash
archguard analyze -c 4
```

3. **Permanently increase limit**:
```bash
# Add to ~/.bashrc or ~/.zshrc
ulimit -n 4096
```

### Disk Space Full

**Problem**: `Error: ENOSPC: no space left on device`

**Solutions**:

1. **Check disk space**:
```bash
df -h
```

2. **Clear cache**:
```bash
archguard cache clear
```

3. **Use different output directory**:
```bash
archguard analyze --output-dir /other-disk/output
```

---

## Configuration Errors

### Invalid Configuration

**Problem**: `Error: Invalid configuration file`

**Solutions**:

1. **Validate JSON syntax**:
```bash
cat .archguardrc.json | jq .
```

2. **Check for common errors**:
   - Trailing commas
   - Missing quotes
   - Invalid escape sequences

3. **Use schema validation**:
```json
{
  "$schema": "https://archguard.dev/schema/config.json"
}
```

4. **Reinitialize**:
```bash
mv .archguardrc.json .archguardrc.json.bak
archguard init
```

### Configuration Not Found

**Problem**: Configuration file not being loaded

**Solutions**:

1. **Check file location** (must be in project root):
```bash
ls -la .archguardrc.json
```

2. **Specify config file explicitly**:
```bash
archguard analyze --config .archguardrc.json
```

3. **Use package.json** instead:
```json
{
  "archguard": {
    "source": "./src"
  }
}
```

### Conflicting Settings

**Problem**: Settings not applying as expected

**Remember priority order**:

1. CLI options (highest)
2. Environment variables
3. Configuration file
4. Defaults (lowest)

**Solution**:

Use `--verbose` to see which settings are active:

```bash
archguard analyze -v
```

---

## Debugging

### Enable Verbose Mode

Get detailed output for debugging:

```bash
archguard analyze -v
```

### Check Version

Ensure you're using the latest version:

```bash
archguard --version
npm list archguard
```

### Update ArchGuard

Update to the latest version:

```bash
npm update archguard
# or
npm install -g archguard@latest
```

### Generate Debug Report

Create a debug report for issues:

```bash
archguard analyze -v > debug.log 2>&1
```

Share `debug.log` when reporting issues (remove sensitive data first).

---

## Getting Help

### Check Documentation

- [README](../README.md)
- [CLI Usage](CLI-USAGE.md)
- [Configuration](CONFIGURATION.md)

### Search Issues

Check if your issue has been reported:

[GitHub Issues](https://github.com/your-org/archguard/issues)

### Create Issue

Include:
- ArchGuard version (`archguard --version`)
- Node.js version (`node --version`)
- Operating system
- Full error message
- Steps to reproduce
- Configuration file (if applicable)

### Community Support

- GitHub Discussions
- Stack Overflow (tag: `archguard`)

---

## Common Error Messages

### Quick Reference

| Error | Cause | Solution |
|-------|-------|----------|
| `API key is required` | Missing API key | Set `ANTHROPIC_API_KEY` |
| `Source directory not found` | Invalid path | Check `source` path |
| `Cannot parse file` | Syntax error | Fix TypeScript syntax |
| `Rate limit exceeded` | Too many API calls | Wait and retry |
| `Out of memory` | Insufficient memory | Increase Node.js memory |
| `EMFILE: too many open files` | File descriptor limit | Increase `ulimit -n` |
| `ENOSPC: no space left` | Disk full | Clear cache/disk space |
| `Invalid configuration` | JSON syntax error | Validate JSON |
| `Network request failed` | Network issue | Check connection |
| `Cache corruption` | Corrupted cache | Clear cache |

---

If your issue is not listed here, please [create an issue](https://github.com/your-org/archguard/issues/new) on GitHub.
