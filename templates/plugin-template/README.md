# ArchGuard Plugin Template

This template provides a starting point for creating new language plugins for ArchGuard.

## Quick Start

1. **Copy the template**:
   ```bash
   cp -r templates/plugin-template my-archguard-plugin
   cd my-archguard-plugin
   ```

2. **Rename and configure**:
   - Replace `my-language` with your language name
   - Update `MyLanguagePlugin` class name
   - Modify file extensions in metadata
   - Update package.json with your details

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Implement your plugin**:
   - Edit `src/index.ts` to implement parsing logic
   - Add your language's AST parsing (tree-sitter, regex, etc.)
   - Map parsed structures to ArchJSON format

5. **Test your plugin**:
   ```bash
   npm test
   ```

6. **Build and publish**:
   ```bash
   npm run build
   npm publish
   ```

## Directory Structure

```
my-archguard-plugin/
├── src/
│   └── index.ts           # Main plugin implementation
├── tests/
│   ├── plugin.test.ts     # Plugin tests
│   └── fixtures/          # Test fixtures (sample files)
├── package.json.template  # Package configuration (rename to package.json)
├── tsconfig.json          # TypeScript configuration
├── README.md              # This file
└── LICENSE                # MIT License
```

## Implementation Guide

### 1. Update Plugin Metadata

Edit the `PLUGIN_METADATA` constant in `src/index.ts`:

```typescript
const PLUGIN_METADATA: PluginMetadata = {
  name: 'your-language',       // Unique identifier
  version: '1.0.0',
  displayName: 'Your Language',
  fileExtensions: ['.your', '.ext'],
  author: 'Your Name',
  repository: 'https://github.com/you/archguard-your-language',
  minCoreVersion: '2.0.0',
  capabilities: {
    singleFileParsing: true,
    incrementalParsing: true,
    dependencyExtraction: false,  // Set to true if you implement it
    typeInference: false,
  },
};
```

### 2. Implement Parsing Logic

The template provides stubs for three main parsing methods:

- `parseProject()` - Parse an entire project directory
- `parseCode()` - Parse a single code string
- `parseFiles()` - Parse specific files

Implement these methods based on your language's requirements.

### 3. Add Test Fixtures

Create sample files in `tests/fixtures/`:

```
tests/fixtures/
├── basic/
│   ├── class.your
│   └── function.your
├── advanced/
│   ├── inheritance.your
│   └── generics.your
└── edge-cases/
    ├── empty.your
    └── syntax-error.your
```

### 4. Write Tests

Update `tests/plugin.test.ts` with language-specific tests.

## Resources

- [Plugin Development Guide](../../docs/plugin-development-guide.md)
- [Plugin Registry Documentation](../../docs/plugin-registry.md)
- [ArchJSON Specification](../../docs/specs.md)

## License

MIT
