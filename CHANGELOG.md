# Changelog

All notable changes to ArchGuard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.38] - 2026-10-08

### Fixed
- `arch-layer-review` skill is now bundled and registered with the published plugin
  (`plugin/skills/arch-layer-review/` + `plugin/.claude-plugin/plugin.json` `commands`), instead of
  only existing in the repo-local, unshipped `.claude/skills/` location noted in 0.1.37's entry
  below. External projects installing the `archguard@archguard` Claude Code plugin at user scope can
  now discover and invoke `archguard:arch-layer-review`.
- `.gitignore`'s `archguard*.json` rule was silently excluding
  `.agents/skills/arch-layer-review/references/archguard-selfreview-example-output.json` from git
  (the same class of collision the existing `project-semantics-discovery` negation line already
  worked around); added the matching negation line.

## [0.1.37] - 2026-10-08

### Fixed
- `archguard_get_evidence_pack`: the success path now carries `evaluated: true`, mirroring
  `evaluated: false` on the not-evaluated path, so `if (!result.evaluated)` can no longer
  misread a real result as "not evaluated". This closes the same gap `get_intrinsic_dimension`
  had fixed in 0.1.35; it was deliberately held back from that release to batch here.

### Changed
- Internal layering (no public behaviour change): `drift-baseline` moved from `cli/utils` into
  `cli/analyze` (it re-runs the analysis pipeline — an analyze concern), and the `DiagramResult`
  type was extracted into the leaf types layer (`src/types/diagram-result.ts`, re-exported from
  `src/types/index.ts`). This removes `cli/utils`'s outbound edges into the cli cycle.

### Tooling (repo-local — not part of the published npm package)
- `arch-layer-review` skill (Phase D1 semantic architecture review) plus its single-tree /
  architecture-health question set.

## [0.1.36] - 2026-10-03

### Fixed
- TypeScript `moduleGraph`: capture `export ... from`, literal dynamic `import()`,
  and bare-alias edges that were previously dropped, and emit type-only edges for
  type-position `import()` (both previously invisible)
- TypeScript `moduleGraph`: external (non-workspace) edges are now
  resolution-independent — the same import no longer produces a different graph
  depending on whether it happened to resolve
- `archguard_analyze` package-level JSON: derive the package graph from the module
  graph so node/edge/entity counts are self-consistent, and count `entityCount`
  from direct files (including the root) rather than double-counting
- `archguard_detect_cycles`: honour `outputScope: "package"` (three-valued, no longer
  silently falling back to class granularity)
- `archguard_detect_cycles` / `archguard_get_package_metrics`: declare the
  Go-Atlas-only `packageGraph` capability on TypeScript scopes instead of implying support
- `analyze` / `check`: resolve work/output directories from config the same way
  `analyze` does; `check` now loads real relations for no-dependency rules (previously
  evaluated against a stub, so the rule could never fire)
- File discovery: `.gitignore` and `.archguardignore` matches now actually exclude on
  the TypeScript plugin path; a single symlink-free discovery pass for ts-morph now
  covers `.tsx`/`.js`/`.jsx` and reports skipped extensions
- Duplicate detection: stop following symlinks during the scan
- `cache`: `prune-scopes` command; scope lists now expose `generatedAt`

### Added
- `analyze` honouring ignore files (`.gitignore`, `.archguardignore`) with the
  effective exclude rules reported in the run output
- Release tooling: fast-forward-only `advance-master` workflow, version-carrier
  consistency guard, and the release-run ledger (record + verify)
- `scripts/test.sh --perf` lane for the timing-sensitive performance suite (manual,
  never part of a correctness gate)

### Changed
- Layers: inject the parser runtime into `core/parser` and drop the mutual
  directory-level dependency; relocate types/constants below their consumers

## [0.1.35] - 2026-09-30

### Fixed
- `archguard_detect_shape_smells`: fix a dynamic `import('fs-extra')` that resolved
  `fs.readFile` to `undefined` (CJS/ESM named-export interop), silently skipping every
  source file and always reporting `totalSmells: 0` regardless of input
- `archguard_detect_shape_smells`: expand directory entries in `sources` to their
  `.ts`/`.tsx` files instead of passing them straight to `readFile` (`EISDIR`, silently
  swallowed by the same catch as above)
- Literal-dispersion `srcRoot` cross-module filter: a flat `src/*.ts` layout (no
  subdirectories) used to be treated as "confirmed single module" and had every smell
  dropped; it's now treated as "can't confirm same-module" and smells are kept
- `archguard_analyze_git`: write `keyRoot`/`pathFilters` into the manifest like
  `archguard_analyze --includeGit` does. Running `archguard_analyze_git` standalone
  after an `--includeGit` run was silently overwriting the manifest with one lacking
  `keyRoot`, which made every non-exact-match git-history lookup fall back to
  `legacy-manifest` instead of a real `outside-analyzed-paths`/`no-commits-in-window`
  reason — including telling you to "Re-run archguard_analyze_git", which is exactly
  what caused the regression
- Git history target lookups: normalize a leading `./` (and backslashes / trailing `/`)
  in `target` paths before matching, matching the plain repo-relative keys `git log`
  produces
- `archguard_get_metric_trend` with `packageName`: guard against metrics-history
  entries recorded before per-package tracking existed, which lack a `packages` field
  entirely and crashed `.filter()`/silently dropped from the unfiltered response with
  `TypeError: Cannot read properties of undefined (reading 'filter')`
- `archguard_get_intrinsic_dimension`: add `evaluated: true` to the success response so
  `if (!result.evaluated)` can't misfire on a real result (only the failure path had
  `evaluated: false` before; the success path had no `evaluated` key at all)
- `archguard_get_architecture_drift`: snapshots from `analyze --arch-health` never
  carried a `commitSha`, and the tool looks snapshots up by `commitSha` — every real
  invocation returned "no baseline available". Snapshots now record `commitSha` (HEAD
  at analysis time)
- `archguard_get_architecture_drift` / `--drift-base`: the baseline/drift snapshot
  resolvers called `reanalyzeCommitSnapshot(commitSha, root)`, but that function's real
  parameter order is `(root, commitSha)` — every call had a commit sha where a repo path
  was expected and vice versa, failing with "invalid commit reference: `<repo path>`"
  even after the `commitSha` gap above is fixed. Found by re-running the tool
  end-to-end after fixing the gap above, not by reading the code.

## [0.1.34] - 2026-09-30

### Fixed
- `analyze`/`archguard_analyze`: process every `--sources`/`sources` entry instead of silently
  dropping all but the first; list persisted scopes in the response (TASK-89)
- Query scope keys: realpath-resolve source paths before hashing so symlinked paths no longer
  produce duplicate scopes (TASK-92)
- Git history query tools (`get_change_context`, `get_cochange`, `get_change_risk`,
  `get_ownership`): accept both repo-relative and key-relative target paths (TASK-95)
- Global scope selection: re-select when a run has no primary scope, and prefer the
  previously-primary scope on an entity-count tie (TASK-90)

### Added
- `archguard_analyze`: `testSources` parameter for pointing test analysis at directories outside
  the analyzed source root
- Git history analysis: expose analyzed window (`windowStart`/`windowEnd`) and `truncated` flag
  when `gitMaxCommits` cuts the window short of `gitSinceDays`; `gitSinceDays`/`gitMaxCommits`
  are now tunable (TASK-94)

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
