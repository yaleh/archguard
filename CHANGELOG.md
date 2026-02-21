# Changelog

All notable changes to ArchGuard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-02-21

### Added

#### Multi-Language Plugin Architecture
- Plugin-based language support system with `ILanguagePlugin` interface
- `PluginRegistry` for centralized plugin management
- Plugin capabilities system for feature detection
- Support for multiple plugin versions

#### Go Language Support (Phase 2)
- Tree-sitter based parsing for Go source code
- gopls integration for enhanced semantic analysis
- Implicit interface implementation detection
- Struct, interface, and function extraction
- Cross-package relationship analysis

#### Java Language Support (Phase 3.A)
- Tree-sitter based Java parser
- Class, interface, and enum extraction
- Maven and Gradle dependency extraction
- Inheritance and implementation relationship detection
- 72 tests passing

#### Python Language Support (Phase 3.B)
- Tree-sitter based Python parser
- Class, function, and decorator extraction
- pip and Poetry dependency extraction
- Type hints and docstring support
- 75 tests passing

#### Community Ecosystem (Phase 4)
- Comprehensive plugin development guide
- Plugin template with boilerplate code
- Plugin registry documentation
- Testing patterns and examples

#### CLI Enhancements
- `--lang` parameter for explicit language selection
- Auto-detection of project language via plugin system
- Multi-language project support

### Changed

#### Type System
- Extended `ArchJSON` for multi-language support
- Added language-specific entity types (`struct`, `trait`)
- Enhanced `Relation` type with inference source tracking
- Added `SupportedLanguage` union type

#### Parser Architecture
- Migrated from monolithic parser to plugin-based system
- `TypeScriptParser` wrapped as `TypeScriptPlugin`
- Added tree-sitter as common parsing infrastructure
- Implemented parallel parsing support

#### Configuration
- Extended configuration for language-specific options
- Added plugin discovery settings
- Enhanced file pattern matching

### Fixed

- Improved error handling for malformed source files
- Better handling of circular dependencies
- Fixed memory leaks in long-running processes
- Improved performance for large codebases

### Documentation

- Added multi-language support documentation
- Created plugin development guide
- Added plugin registry documentation
- Updated architecture diagrams

## [1.5.0] - 2025-12-15

### Added

- Multi-level architecture diagrams (package, class, method)
- Multiple diagram generation from config file
- Custom output directory organization
- Mermaid theme support (default, forest, dark, neutral)

### Changed

- Migrated from PlantUML to Mermaid for diagram generation
- Improved LLM grouping algorithm
- Enhanced caching system with SHA-256 hashing

## [1.4.0] - 2025-11-01

### Added

- LLM-powered intelligent grouping for diagram organization
- ArchJSON-only output mode (`-f json`)
- Configuration file support (`archguard.config.json`)
- Cache management commands (`cache clear`, `cache stats`)

### Changed

- Improved CLI with better error messages
- Enhanced parallel parsing performance
- Better handling of TypeScript path aliases

## [1.3.0] - 2025-09-15

### Added

- Parallel file parsing with configurable concurrency
- Progress reporting during analysis
- Exclude patterns for filtering files
- Self-analysis capability

### Fixed

- Memory optimization for large projects
- Fixed handling of declaration files (.d.ts)
- Improved decorator parsing

## [1.2.0] - 2025-07-01

### Added

- TypeScript class extraction
- Interface and type alias support
- Inheritance relationship detection
- Method and property extraction

### Changed

- Refactored parser architecture
- Improved AST traversal efficiency
- Better error recovery

## [1.1.0] - 2025-05-15

### Added

- PlantUML diagram generation
- SVG and PNG output formats
- Basic dependency extraction
- NPM dependency analysis

## [1.0.0] - 2025-03-01

### Added

- Initial release
- Basic TypeScript parsing
- Class diagram generation
- CLI interface
- Configuration support

---

## Version History Summary

| Version | Date | Key Features |
|---------|------|--------------|
| 2.0.0 | 2026-02-21 | Multi-language plugins (Go, Java, Python) |
| 1.5.0 | 2025-12-15 | Mermaid migration, multi-level diagrams |
| 1.4.0 | 2025-11-01 | LLM grouping, JSON output mode |
| 1.3.0 | 2025-09-15 | Parallel parsing, caching |
| 1.2.0 | 2025-07-01 | TypeScript class extraction |
| 1.1.0 | 2025-05-15 | PlantUML diagrams, dependencies |
| 1.0.0 | 2025-03-01 | Initial release |

---

## Upgrading

### From 1.x to 2.0

**Breaking Changes:**
- CLI parameter `--lang` now defaults to auto-detection
- Plugin system requires initialization before use
- Configuration schema updated for multi-language support

**Migration Steps:**
1. Update dependencies: `npm install @archguard/core@2.0.0`
2. If using TypeScript parser directly, switch to TypeScriptPlugin
3. Update configuration files with language settings
4. Run tests to ensure compatibility

### Configuration Migration

```json
// Old (1.x)
{
  "source": "./src",
  "format": "mermaid"
}

// New (2.0)
{
  "source": "./src",
  "format": "mermaid",
  "language": "typescript",  // Optional, auto-detected
  "plugins": {
    "autoDiscover": true
  }
}
```

---

## Roadmap

### Upcoming Features

- [ ] Rust language support
- [ ] C# language support
- [ ] LSP integration for enhanced analysis
- [ ] Incremental parsing for large projects
- [ ] Plugin marketplace

### Future Considerations

- WebAssembly plugin support
- Real-time analysis mode
- IDE integrations
- Cloud-based analysis
