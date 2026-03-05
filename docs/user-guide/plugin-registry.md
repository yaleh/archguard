# Plugin Registry Documentation

This document describes how ArchGuard's plugin registry works and how plugins are registered, discovered, and managed.

## Table of Contents

1. [Overview](#overview)
2. [PluginRegistry Class](#pluginregistry-class)
3. [Plugin Registration](#plugin-registration)
4. [Plugin Discovery](#plugin-discovery)
5. [Version Management](#version-management)
6. [Extension Detection](#extension-detection)
7. [Auto-Discovery Mechanism](#auto-discovery-mechanism)
8. [Usage Examples](#usage-examples)

---

## Overview

The `PluginRegistry` is a centralized component that manages all language plugins in ArchGuard. It provides:

- **Registration**: Add plugins with version management
- **Discovery**: Find plugins by file extension or directory
- **Version Management**: Handle multiple versions of the same plugin
- **Extension Mapping**: Map file extensions to appropriate plugins

```
+----------------+
| PluginRegistry |
+----------------+
       |
       +---> plugins: Map<name, Map<version, Plugin>>
       |
       +---> extensionMap: Map<extension, Plugin[]>
       |
       +---> Methods:
             - register()
             - getByName()
             - getByExtension()
             - detectPluginForDirectory()
             - loadFromPath()
```

---

## PluginRegistry Class

The `PluginRegistry` class is defined in `src/core/plugin-registry.ts`.

### Constructor

```typescript
const registry = new PluginRegistry();
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `plugins` | `Map<string, Map<string, ILanguagePlugin>>` | Plugin name to version map |
| `extensionMap` | `Map<string, ILanguagePlugin[]>` | File extension to plugins map |

---

## Plugin Registration

### Basic Registration

```typescript
import { PluginRegistry } from '@archguard/core';
import { TypeScriptPlugin } from '@archguard/plugin-typescript';
import { GoPlugin } from '@archguard/plugin-golang';

const registry = new PluginRegistry();

// Register plugins
registry.register(new TypeScriptPlugin());
registry.register(new GoPlugin());
```

### Registration Options

```typescript
interface RegisterOptions {
  overwrite?: boolean;  // Default: false
}

// Register with overwrite enabled
registry.register(new MyPlugin(), { overwrite: true });
```

### Registration Errors

If a plugin with the same name and version is already registered:

```typescript
// This will throw an error
registry.register(new TypeScriptPlugin());
registry.register(new TypeScriptPlugin()); // Error: Plugin already registered

// Use overwrite option to replace
registry.register(new TypeScriptPlugin(), { overwrite: true });
```

---

## Plugin Discovery

### By Name

```typescript
// Get latest version
const plugin = registry.getByName('typescript');

// Get specific version
const plugin = registry.getByName('typescript', '1.2.0');

if (plugin) {
  console.log(`Found plugin: ${plugin.metadata.displayName}`);
}
```

### By File Extension

```typescript
// Get plugin that handles .ts files
const plugin = registry.getByExtension('.ts');

// Also works without leading dot
const plugin2 = registry.getByExtension('.go');
```

### By Directory

```typescript
// Detect plugin based on project markers
const plugin = registry.detectPluginForDirectory('/path/to/project');

// Project markers detected:
// - package.json -> TypeScript plugin
// - go.mod -> Go plugin
// - pom.xml, build.gradle -> Java plugin
// - pyproject.toml, requirements.txt -> Python plugin
```

---

## Version Management

The registry supports multiple versions of the same plugin.

### Registering Multiple Versions

```typescript
const pluginV1 = new MyPlugin();
pluginV1.metadata.version = '1.0.0';

const pluginV2 = new MyPlugin();
pluginV2.metadata.version = '2.0.0';

registry.register(pluginV1);
registry.register(pluginV2);
```

### Listing Versions

```typescript
const versions = registry.listVersions('my-language');
// Returns: ['1.0.0', '2.0.0']
```

### Version Priority

When multiple plugins handle the same extension, they are sorted by version (highest first):

```typescript
// Given: my-language@1.0.0 and my-language@2.0.0
const plugin = registry.getByExtension('.my');
// Returns: my-language@2.0.0 (latest version)
```

### Version Comparison

Versions are compared using semantic versioning:

```typescript
// Internal comparison logic
private compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(n => parseInt(n, 10));
  const partsB = b.split('.').map(n => parseInt(n, 10));

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}
```

---

## Extension Detection

### How Extensions Work

When a plugin is registered, its file extensions are mapped:

```typescript
// TypeScript plugin registers ['.ts', '.tsx', '.js', '.jsx']
registry.register(new TypeScriptPlugin());

// Extension map now contains:
// '.ts' -> [TypeScriptPlugin]
// '.tsx' -> [TypeScriptPlugin]
// '.js' -> [TypeScriptPlugin]
// '.jsx' -> [TypeScriptPlugin]
```

### Multiple Plugins Per Extension

Multiple plugins can handle the same extension:

```typescript
registry.register(new JavaScriptPlugin());   // handles .js
registry.register(new TypeScriptPlugin());   // handles .js

// Extension map:
// '.js' -> [TypeScriptPlugin, JavaScriptPlugin]  // sorted by version
```

### Extension Detection Flow

```
Input: "/path/to/file.ts"
         |
         v
+------------------------+
| getByExtension('.ts')  |
+------------------------+
         |
         v
+------------------------+
| Look up extensionMap   |
+------------------------+
         |
         v
+------------------------+
| Return first plugin    |
| (highest version)      |
+------------------------+
```

---

## Auto-Discovery Mechanism

### Directory Detection

The `detectPluginForDirectory` method checks for project markers:

```typescript
detectPluginForDirectory(directoryPath: string): ILanguagePlugin | null {
  // Check for package.json -> TypeScript
  if (fs.existsSync(path.join(directoryPath, 'package.json'))) {
    return this.getByName('typescript');
  }

  // Check for go.mod -> Go
  if (fs.existsSync(path.join(directoryPath, 'go.mod'))) {
    return this.getByName('golang');
  }

  // Check for pom.xml or build.gradle -> Java
  if (
    fs.existsSync(path.join(directoryPath, 'pom.xml')) ||
    fs.existsSync(path.join(directoryPath, 'build.gradle'))
  ) {
    return this.getByName('java');
  }

  // Check for Python markers
  const pythonMarkers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'];
  for (const marker of pythonMarkers) {
    if (fs.existsSync(path.join(directoryPath, marker))) {
      return this.getByName('python');
    }
  }

  return null;
}
```

### Project Markers by Language

| Language | Project Markers |
|----------|----------------|
| TypeScript | `package.json`, `tsconfig.json` |
| Go | `go.mod` |
| Java | `pom.xml`, `build.gradle` |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile` |
| Rust | `Cargo.toml` |
| C# | `.csproj`, `.sln` |

### Dynamic Plugin Loading

Load plugins from external paths:

```typescript
// Load plugin from file path
const plugin = await registry.loadFromPath('/path/to/plugin.js');

// Register the loaded plugin
registry.register(plugin);
```

### Plugin Module Requirements

For dynamic loading, plugins must export a default class or named `Plugin` export:

```typescript
// Option 1: Default export
export default class MyPlugin implements ILanguagePlugin {
  // ...
}

// Option 2: Named export
export class Plugin implements ILanguagePlugin {
  // ...
}
```

---

## Usage Examples

### Basic Usage

```typescript
import { PluginRegistry } from '@archguard/core';
import { TypeScriptPlugin } from '@archguard/plugin-typescript';
import { GoPlugin } from '@archguard/plugin-golang';
import { JavaPlugin } from '@archguard/plugin-java';
import { PythonPlugin } from '@archguard/plugin-python';

// Create registry and register built-in plugins
const registry = new PluginRegistry();

registry.register(new TypeScriptPlugin());
registry.register(new GoPlugin());
registry.register(new JavaPlugin());
registry.register(new PythonPlugin());

// Use the registry
const plugin = registry.getByExtension('.ts');
await plugin?.initialize({ workspaceRoot: '/project' });
const archJson = await plugin?.parseProject('/project', config);
```

### CLI Integration

```typescript
// In CLI analyze command
async function detectAndParse(workspaceRoot: string): Promise<ArchJSON> {
  const registry = new PluginRegistry();

  // Register all available plugins
  registerBuiltInPlugins(registry);

  // Detect language
  const plugin = registry.detectPluginForDirectory(workspaceRoot);

  if (!plugin) {
    throw new Error('Could not detect project language');
  }

  // Initialize and parse
  await plugin.initialize({ workspaceRoot });

  return plugin.parseProject(workspaceRoot, {
    workspaceRoot,
    excludePatterns: ['**/node_modules/**', '**/dist/**'],
  });
}
```

### With Explicit Language Selection

```typescript
// User specifies --lang typescript
async function parseWithLanguage(
  workspaceRoot: string,
  language: string
): Promise<ArchJSON> {
  const registry = new PluginRegistry();
  registerBuiltInPlugins(registry);

  const plugin = registry.getByName(language);

  if (!plugin) {
    throw new Error(`Unknown language: ${language}`);
  }

  await plugin.initialize({ workspaceRoot });
  return plugin.parseProject(workspaceRoot, config);
}
```

### Listing Available Plugins

```typescript
// List all registered plugins
const allPlugins = registry.listAll();

console.log('Available plugins:');
for (const plugin of allPlugins) {
  console.log(`- ${plugin.metadata.displayName} (${plugin.metadata.version})`);
  console.log(`  Extensions: ${plugin.metadata.fileExtensions.join(', ')}`);
}

// List versions of a specific plugin
const versions = registry.listVersions('typescript');
console.log(`TypeScript plugin versions: ${versions.join(', ')}`);
```

### Checking Plugin Availability

```typescript
// Check if a plugin is registered
if (registry.has('typescript')) {
  console.log('TypeScript plugin is available');
}

// Check for specific version
if (registry.has('typescript', '2.0.0')) {
  console.log('TypeScript plugin v2.0.0 is available');
}
```

---

## Best Practices

### 1. Register Plugins Early

Register all plugins at application startup:

```typescript
// Good: Register all plugins at startup
function initializeApp() {
  const registry = new PluginRegistry();
  registry.register(new TypeScriptPlugin());
  registry.register(new GoPlugin());
  // ... other plugins
  return registry;
}
```

### 2. Handle Missing Plugins Gracefully

```typescript
const plugin = registry.getByName('unknown-language');
if (!plugin) {
  console.error('Language not supported. Available languages:');
  for (const p of registry.listAll()) {
    console.log(`  - ${p.metadata.name}`);
  }
  process.exit(1);
}
```

### 3. Use Version Constraints

```typescript
// Get plugin meeting version requirements
const plugin = registry.getByName('typescript');
if (plugin && satisfiesVersion(plugin.metadata.version, '>=2.0.0')) {
  // Use plugin
}
```

### 4. Clean Up Resources

```typescript
// Dispose all plugins on shutdown
async function shutdown(registry: PluginRegistry) {
  for (const plugin of registry.listAll()) {
    await plugin.dispose();
  }
}
```

---

## Troubleshooting

### Plugin Not Found

**Problem**: `getByName()` returns null

**Solutions**:
1. Ensure plugin is registered before use
2. Check plugin name spelling (lowercase, hyphen-separated)
3. Verify plugin was registered successfully

### Extension Not Recognized

**Problem**: `getByExtension()` returns null

**Solutions**:
1. Check extension includes leading dot (`.ts` not `ts`)
2. Verify plugin declares the extension in `fileExtensions`
3. Ensure plugin is registered

### Version Conflicts

**Problem**: Wrong plugin version returned

**Solutions**:
1. Specify explicit version: `getByName('typescript', '1.0.0')`
2. Check registered versions: `listVersions('typescript')`
3. Use `overwrite: true` to replace existing versions

---

## See Also

- [Plugin Development Guide](./plugin-development-guide.md)
- [Architecture Documentation](./architecture.md)
- [API Reference](./specs.md)
