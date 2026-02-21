# ArchGuard Plugin Development Guide

This guide provides comprehensive documentation for developing language plugins for ArchGuard.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Plugin Architecture Overview](#plugin-architecture-overview)
3. [Creating a New Plugin](#creating-a-new-plugin)
4. [API Reference](#api-reference)
5. [Best Practices](#best-practices)
6. [Examples](#examples)
7. [Testing](#testing)
8. [Publishing](#publishing)

---

## Getting Started

### Prerequisites

- Node.js 18.x or later
- TypeScript 5.x
- Familiarity with tree-sitter (recommended for AST-based parsing)
- Understanding of the target language's syntax and semantics

### Quick Start

1. **Clone the plugin template**:
   ```bash
   cp -r templates/plugin-template my-archguard-plugin
   cd my-archguard-plugin
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Implement your plugin**:
   Edit `src/index.ts` to implement the `ILanguagePlugin` interface.

4. **Test your plugin**:
   ```bash
   npm test
   ```

5. **Build and publish**:
   ```bash
   npm run build
   npm publish
   ```

---

## Plugin Architecture Overview

ArchGuard uses a plugin-based architecture to support multiple programming languages. Each plugin implements the `ILanguagePlugin` interface and is responsible for:

1. **Parsing**: Converting source code to ArchJSON format
2. **Dependency Extraction**: (Optional) Extracting project dependencies
3. **Validation**: (Optional) Language-specific validation rules

### Core Components

```
+-------------------+     +------------------+     +----------------+
|   Source Files    | --> |  Language Plugin | --> |   ArchJSON     |
|  (.ts, .go, .py)  |     |  (ILanguagePlugin)|    |   (output)     |
+-------------------+     +------------------+     +----------------+
                                   |
                          +--------+--------+
                          |                 |
                   +------v------+   +------v------+
                   |   Parser    |   |  Dependency |
                   |  (IParser)  |   |  Extractor  |
                   +-------------+   +-------------+
```

### Plugin Lifecycle

```
1. Instantiation  --> Plugin class is instantiated
2. Initialize     --> initialize() called with config
3. Usage          --> parseProject(), parseCode(), etc.
4. Dispose        --> dispose() called for cleanup
```

---

## Creating a New Plugin

### Step 1: Project Structure

Create a directory structure following this pattern:

```
my-archguard-plugin/
├── src/
│   ├── index.ts              # Main plugin export
│   ├── parser.ts             # Parser implementation
│   ├── archjson-mapper.ts    # AST to ArchJSON mapper
│   ├── dependency.ts         # Dependency extraction (optional)
│   └── types.ts              # Language-specific types
├── tests/
│   ├── plugin.test.ts        # Plugin tests
│   ├── parser.test.ts        # Parser tests
│   └── fixtures/             # Test fixtures
│       └── sample.myLang
├── package.json
├── tsconfig.json
└── README.md
```

### Step 2: Define Plugin Metadata

```typescript
import type { PluginMetadata, PluginCapabilities } from '@archguard/core';

const metadata: PluginMetadata = {
  name: 'my-language',           // Unique identifier (lowercase, hyphen-separated)
  version: '1.0.0',              // Semantic version
  displayName: 'My Language',    // Human-readable name
  fileExtensions: ['.my', '.ml'], // Supported file extensions
  author: 'Your Name',
  repository: 'https://github.com/you/archguard-my-language',
  minCoreVersion: '2.0.0',       // Minimum ArchGuard version
  capabilities: {
    singleFileParsing: true,     // Supports parseCode()
    incrementalParsing: true,    // Supports parseFiles()
    dependencyExtraction: false, // Has dependency extractor
    typeInference: false,        // Can infer types
  } as PluginCapabilities,
};
```

### Step 3: Implement ILanguagePlugin

```typescript
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
} from '@archguard/core';
import type { ParseConfig } from '@archguard/core';
import type { ArchJSON } from '@archguard/types';

export class MyLanguagePlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'my-language',
    version: '1.0.0',
    displayName: 'My Language',
    fileExtensions: ['.my'],
    author: 'Your Name',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: false,
      typeInference: false,
    },
  };

  private initialized = false;

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize parser, load resources, validate dependencies
    // Example: Check if required tools are available

    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given path
   */
  canHandle(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();

    // Check file extension
    if (this.metadata.fileExtensions.includes(ext)) {
      return true;
    }

    // Check for project markers (e.g., myproject.toml)
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        return fs.existsSync(path.join(targetPath, 'myproject.toml'));
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Parse entire project
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // 1. Find all source files
    // 2. Parse each file
    // 3. Map to ArchJSON entities and relations
    // 4. Return complete ArchJSON

    return {
      version: '1.0',
      language: 'my-language',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };
  }

  /**
   * Parse single code string (optional - based on capabilities)
   */
  parseCode(code: string, filePath?: string): ArchJSON {
    this.ensureInitialized();

    // Parse single file and return ArchJSON
    return {
      version: '1.0',
      language: 'my-language',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath ?? 'source.my'],
      entities: [],
      relations: [],
    };
  }

  /**
   * Parse multiple files (optional - based on capabilities)
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    // Parse multiple files and merge results
    return {
      version: '1.0',
      language: 'my-language',
      timestamp: new Date().toISOString(),
      sourceFiles: filePaths,
      entities: [],
      relations: [],
    };
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    this.initialized = false;
    // Clean up any resources (close connections, clear caches, etc.)
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Plugin not initialized. Call initialize() first.');
    }
  }
}
```

### Step 4: Export the Plugin

```typescript
// src/index.ts
export { MyLanguagePlugin } from './my-language-plugin.js';
export type { MyLanguageTypes } from './types.js';
```

---

## API Reference

### ILanguagePlugin Interface

The main interface that all plugins must implement.

```typescript
interface ILanguagePlugin extends IParser {
  readonly metadata: PluginMetadata;

  initialize(config: PluginInitConfig): Promise<void>;
  canHandle(targetPath: string): boolean;
  dispose(): Promise<void>;

  readonly dependencyExtractor?: IDependencyExtractor;
  readonly validator?: IValidator;
}
```

### PluginMetadata

Describes the plugin's identity and capabilities.

```typescript
interface PluginMetadata {
  name: string;                    // Unique identifier
  version: string;                 // Semantic version
  displayName: string;             // Human-readable name
  fileExtensions: string[];        // Supported extensions
  author: string;                  // Author name
  repository?: string;             // Repository URL
  minCoreVersion: string;          // Minimum core version
  capabilities: PluginCapabilities;
}
```

### PluginCapabilities

Flags indicating supported features.

```typescript
interface PluginCapabilities {
  singleFileParsing: boolean;      // Supports parseCode()
  incrementalParsing: boolean;      // Supports parseFiles()
  dependencyExtraction: boolean;    // Has IDependencyExtractor
  typeInference: boolean;           // Can infer types
}
```

### PluginInitConfig

Configuration passed during initialization.

```typescript
interface PluginInitConfig {
  workspaceRoot: string;           // Project root directory
  cacheDir?: string;               // Cache directory path
  verbose?: boolean;               // Enable verbose logging
}
```

### IParser Interface

Core parsing methods.

```typescript
interface IParser {
  parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON>;
  parseCode?(code: string, filePath?: string): ArchJSON;
  parseFiles?(filePaths: string[]): Promise<ArchJSON>;
}
```

### ParseConfig

Configuration for parsing operations.

```typescript
interface ParseConfig {
  workspaceRoot: string;
  excludePatterns: string[];
  includePatterns?: string[];
  filePattern?: string;
  concurrency?: number;
  languageSpecific?: Record<string, unknown>;
}
```

### IDependencyExtractor Interface

For extracting project dependencies.

```typescript
interface IDependencyExtractor {
  extractDependencies(workspaceRoot: string): Promise<Dependency[]>;
}
```

### Dependency Type

Represents a project dependency.

```typescript
interface Dependency {
  name: string;
  version: string;
  type: DependencyType;           // 'npm' | 'gomod' | 'pip' | 'maven' | 'cargo'
  scope: DependencyScope;         // 'runtime' | 'development' | 'optional' | 'peer'
  source: string;                 // Source file
  isDirect: boolean;              // Direct vs transitive
}
```

### IValidator Interface

For language-specific validation.

```typescript
interface IValidator {
  validate(archJson: ArchJSON): ValidationResult;
}
```

### ArchJSON Structure

The output format all plugins must produce.

```typescript
interface ArchJSON {
  version: string;
  language: SupportedLanguage;
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];
  relations: Relation[];
  modules?: Module[];
  metadata?: Record<string, unknown>;
}
```

### Entity Types

```typescript
type EntityType = 'class' | 'interface' | 'enum' | 'struct' | 'trait' | 'abstract_class' | 'function';

interface Entity {
  id: string;
  name: string;
  type: EntityType;
  visibility: Visibility;
  members: Member[];
  sourceLocation: SourceLocation;
  decorators?: Decorator[];
  isAbstract?: boolean;
  isConst?: boolean;
  genericParams?: string[];
  extends?: string[];
  implements?: string[];
}
```

### Relation Types

```typescript
type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association';

interface Relation {
  id: string;
  type: RelationType;
  source: string;
  target: string;
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls';
}
```

---

## Best Practices

### 1. Test-Driven Development (TDD)

Always write tests before implementation:

```typescript
describe('MyLanguagePlugin', () => {
  it('should parse a simple class', () => {
    const code = `
      class MyClass {
        function myMethod() {}
      }
    `;

    const plugin = new MyLanguagePlugin();
    await plugin.initialize({ workspaceRoot: '/tmp' });

    const result = plugin.parseCode(code);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('MyClass');
    expect(result.entities[0].type).toBe('class');
  });
});
```

### 2. Error Handling

Use appropriate error types:

```typescript
import {
  PluginError,
  PluginInitializationError,
  ToolDependencyError,
  FileSystemError,
} from '@archguard/core';

// When a required tool is missing
if (!await hasRequiredTool()) {
  throw new ToolDependencyError(
    'my-language',
    'my-compiler',
    '1.0.0'
  );
}

// When file operations fail
try {
  const content = await fs.readFile(path);
} catch (error) {
  throw new FileSystemError(
    'my-language',
    'read',
    path,
    error as Error
  );
}
```

### 3. Performance Optimization

- **Parallel Processing**: Use Promise.all for concurrent file parsing
- **Caching**: Cache parsed ASTs when possible
- **Lazy Loading**: Load heavy dependencies only when needed

```typescript
async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
  const concurrency = config.concurrency ?? os.cpus().length;
  const files = await this.findSourceFiles(workspaceRoot, config);

  // Process files in parallel batches
  const batches = this.chunk(files, concurrency);
  const results = [];

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(file => this.parseFile(file))
    );
    results.push(...batchResults);
  }

  return this.mergeResults(results);
}
```

### 4. Logging

Use verbose mode for debugging:

```typescript
async initialize(config: PluginInitConfig): Promise<void> {
  if (config.verbose) {
    console.log(`[MyLanguagePlugin] Initializing with workspace: ${config.workspaceRoot}`);
  }

  // ... initialization code

  if (config.verbose) {
    console.log('[MyLanguagePlugin] Initialization complete');
  }
}
```

### 5. Resource Management

Always clean up resources:

```typescript
async dispose(): Promise<void> {
  // Close any open connections
  if (this.lspClient) {
    await this.lspClient.close();
  }

  // Clear caches
  this.cache?.clear();

  // Reset state
  this.initialized = false;
}
```

---

## Examples

### Simple Plugin Example

A minimal plugin for a hypothetical "SimpleLang" language:

```typescript
import type { ILanguagePlugin, PluginMetadata, PluginInitConfig } from '@archguard/core';
import type { ParseConfig } from '@archguard/core';
import type { ArchJSON, Entity, Relation } from '@archguard/types';
import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';

export class SimpleLangPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'simple-lang',
    version: '1.0.0',
    displayName: 'SimpleLang',
    fileExtensions: ['.simple'],
    author: 'Your Name',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: false,
      typeInference: false,
    },
  };

  private initialized = false;

  async initialize(config: PluginInitConfig): Promise<void> {
    this.initialized = true;
  }

  canHandle(targetPath: string): boolean {
    return path.extname(targetPath).toLowerCase() === '.simple';
  }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    const files = await glob('**/*.simple', {
      cwd: workspaceRoot,
      absolute: true,
      ignore: config.excludePatterns,
    });

    const entities: Entity[] = [];
    const relations: Relation[] = [];

    for (const file of files) {
      const code = await fs.readFile(file, 'utf-8');
      const result = this.parseCode(code, file);
      entities.push(...result.entities);
      relations.push(...result.relations);
    }

    return {
      version: '1.0',
      language: 'simple-lang',
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities,
      relations,
    };
  }

  parseCode(code: string, filePath: string = 'source.simple'): ArchJSON {
    this.ensureInitialized();

    // Simple regex-based parsing
    const classMatches = code.matchAll(/class\s+(\w+)\s*\{/g);
    const entities: Entity[] = [];

    for (const match of classMatches) {
      entities.push({
        id: `${filePath}#${match[1]}`,
        name: match[1],
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: filePath,
          startLine: this.getLineNumber(code, match.index!),
          endLine: this.getLineNumber(code, match.index! + match[0].length),
        },
      });
    }

    return {
      version: '1.0',
      language: 'simple-lang',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations: [],
    };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Plugin not initialized');
    }
  }

  private getLineNumber(code: string, index: number): number {
    return code.substring(0, index).split('\n').length;
  }
}
```

### Tree-sitter Integration Example

Using tree-sitter for robust AST parsing:

```typescript
import Parser from 'tree-sitter';
import MyLanguage from 'tree-sitter-my-language';

interface RawClass {
  name: string;
  methods: RawMethod[];
  fields: RawField[];
}

interface RawMethod {
  name: string;
  params: string[];
  returnType: string;
}

interface RawField {
  name: string;
  type: string;
}

export class TreeSitterParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(MyLanguage);
  }

  parseCode(code: string, filePath: string): RawClass[] {
    const tree = this.parser.parse(code);
    const classes: RawClass[] = [];

    this.traverseNode(tree.rootNode, (node) => {
      if (node.type === 'class_declaration') {
        classes.push(this.extractClass(node, code));
      }
    });

    return classes;
  }

  private extractClass(node: Parser.SyntaxNode, code: string): RawClass {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');

    return {
      name: nameNode?.text ?? 'Anonymous',
      methods: this.extractMethods(bodyNode),
      fields: this.extractFields(bodyNode),
    };
  }

  private extractMethods(bodyNode: Parser.SyntaxNode | null): RawMethod[] {
    if (!bodyNode) return [];

    const methods: RawMethod[] = [];

    this.traverseNode(bodyNode, (node) => {
      if (node.type === 'method_declaration') {
        methods.push({
          name: node.childForFieldName('name')?.text ?? '',
          params: this.extractParams(node),
          returnType: node.childForFieldName('return_type')?.text ?? 'void',
        });
      }
    });

    return methods;
  }

  private extractFields(bodyNode: Parser.SyntaxNode | null): RawField[] {
    if (!bodyNode) return [];

    const fields: RawField[] = [];

    this.traverseNode(bodyNode, (node) => {
      if (node.type === 'field_declaration') {
        fields.push({
          name: node.childForFieldName('name')?.text ?? '',
          type: node.childForFieldName('type')?.text ?? 'any',
        });
      }
    });

    return fields;
  }

  private extractParams(methodNode: Parser.SyntaxNode): string[] {
    const paramsNode = methodNode.childForFieldName('parameters');
    if (!paramsNode) return [];

    return paramsNode.children
      .filter(n => n.type === 'parameter')
      .map(n => n.text);
  }

  private traverseNode(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
      this.traverseNode(child, callback);
    }
  }
}
```

### LSP Integration Example

Integrating with a Language Server Protocol server for enhanced analysis:

```typescript
import { spawn, ChildProcess } from 'child_process';

interface LSPResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

export class LSPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  async initialize(workspaceRoot: string): Promise<void> {
    // Start the LSP server process
    this.process = spawn('my-language-server', ['--stdio']);

    this.process.stdout?.on('data', (data) => {
      this.handleResponse(data.toString());
    });

    // Send initialize request
    await this.sendRequest('initialize', {
      rootUri: `file://${workspaceRoot}`,
      capabilities: {},
    });
  }

  async getDefinition(uri: string, line: number, character: number): Promise<unknown> {
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async getReferences(uri: string, line: number, character: number): Promise<unknown> {
    return this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
      this.process?.stdin?.write(header + message);
    });
  }

  private handleResponse(data: string): void {
    const response = JSON.parse(data) as LSPResponse;

    if (response.id !== undefined) {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
```

---

## Testing

### Unit Tests

Test individual components in isolation:

```typescript
// tests/parser.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterParser } from '../src/parser.js';

describe('TreeSitterParser', () => {
  let parser: TreeSitterParser;

  beforeEach(() => {
    parser = new TreeSitterParser();
  });

  it('should parse a simple class', () => {
    const code = `
      class MyClass {
        field: string
        method(): void {}
      }
    `;

    const classes = parser.parseCode(code, 'test.simple');

    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('MyClass');
    expect(classes[0].fields).toHaveLength(1);
    expect(classes[0].methods).toHaveLength(1);
  });

  it('should handle empty input', () => {
    const classes = parser.parseCode('', 'empty.simple');
    expect(classes).toHaveLength(0);
  });

  it('should handle syntax errors gracefully', () => {
    const code = 'class { invalid }';
    const classes = parser.parseCode(code, 'invalid.simple');
    // Should not throw, may return empty or partial results
    expect(Array.isArray(classes)).toBe(true);
  });
});
```

### Integration Tests

Test the full plugin workflow:

```typescript
// tests/plugin.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MyLanguagePlugin } from '../src/index.js';
import fs from 'fs-extra';
import path from 'path';

describe('MyLanguagePlugin Integration', () => {
  let plugin: MyLanguagePlugin;
  const tempDir = path.join(__dirname, 'fixtures', 'temp');

  beforeEach(async () => {
    plugin = new MyLanguagePlugin();
    await plugin.initialize({
      workspaceRoot: tempDir,
      verbose: true,
    });

    // Create test files
    await fs.ensureDir(tempDir);
    await fs.writeFile(
      path.join(tempDir, 'test.simple'),
      'class TestClass { method() {} }'
    );
  });

  afterEach(async () => {
    await plugin.dispose();
    await fs.remove(tempDir);
  });

  it('should parse a project directory', async () => {
    const result = await plugin.parseProject(tempDir, {
      workspaceRoot: tempDir,
      excludePatterns: [],
    });

    expect(result.language).toBe('simple-lang');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('TestClass');
  });

  it('should correctly detect project files', () => {
    expect(plugin.canHandle(path.join(tempDir, 'test.simple'))).toBe(true);
    expect(plugin.canHandle(path.join(tempDir, 'test.txt'))).toBe(false);
    expect(plugin.canHandle(tempDir)).toBe(true);
  });
});
```

### Test Fixtures

Organize test fixtures by category:

```
tests/
└── fixtures/
    ├── basic/
    │   ├── class.simple
    │   └── function.simple
    ├── advanced/
    │   ├── inheritance.simple
    │   └── generics.simple
    └── edge-cases/
        ├── empty.simple
        └── syntax-error.simple
```

---

## Publishing

### Package Configuration

Ensure your package.json is properly configured:

```json
{
  "name": "@archguard/plugin-my-language",
  "version": "1.0.0",
  "description": "ArchGuard plugin for My Language",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "keywords": [
    "archguard",
    "plugin",
    "my-language",
    "architecture",
    "diagram"
  ],
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/you/archguard-my-language"
  },
  "peerDependencies": {
    "@archguard/core": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

### Publishing to npm

```bash
# Login to npm
npm login

# Publish the package
npm publish --access public
```

### README Template

Include comprehensive documentation in your README:

```markdown
# @archguard/plugin-my-language

ArchGuard plugin for analyzing My Language projects.

## Installation

npm install @archguard/plugin-my-language

## Usage

```bash
archguard analyze -s ./src --lang my-language
```

## Features

- Class and interface extraction
- Inheritance relationship detection
- Method and field analysis

## Requirements

- Node.js 18+
- tree-sitter-my-language

## License

MIT
```

---

## Getting Help

- **Documentation**: [docs/](./)
- **Issues**: [GitHub Issues](https://github.com/archguard/archguard/issues)
- **Discussions**: [GitHub Discussions](https://github.com/archguard/archguard/discussions)

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.
