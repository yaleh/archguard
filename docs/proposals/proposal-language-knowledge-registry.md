# Language Knowledge Registry — Design Proposal

> Status: Draft (rev 1)
> Scope: Multi-language and framework support via a data-driven knowledge registry
> Branch: `feat/knowledge-registry` (future)

---

## Motivation

ArchGuard currently supports four languages through hard-coded TypeScript plugins. Adding
a new language or framework requires writing a new plugin class, updating the plugin
registry, and shipping a new release. This creates three structural problems:

| Problem | Consequence |
|---------|-------------|
| **Long tail of languages** | Rust, C#, Kotlin, Ruby, Swift, PHP cannot be supported without shipping code |
| **Framework-specific patterns** | Spring, Django, Rails, NestJS each require bespoke extraction logic woven into language plugins |
| **No community path** | External contributors cannot add support without understanding ArchGuard internals |

The goal of this proposal is to separate the **rule engine** (stable, shipped code) from
the **knowledge** (language/framework-specific data), enabling:

1. Built-in coverage of high-frequency languages and frameworks
2. Community-maintained online knowledge packs for the long tail
3. Runtime dynamic loading without any dependency on an LLM

---

## What Is a "Knowledge Pack"?

For a static analysis tool, the knowledge needed to understand a language or framework
falls into four independent layers:

| Layer | Content | Example |
|-------|---------|---------|
| **Grammar** | How to parse the language | Tree-sitter WASM grammar |
| **Module** | How files import each other | `require()`, `import`, `use`, `#include` |
| **Dependency** | How to read package metadata | `package.json`, `go.mod`, `Cargo.toml` |
| **Framework** | Framework-specific architectural conventions | Spring `@Controller`, Django `views.py` |

Each layer is expressed as **declarative data** — YAML/JSON rules interpreted by a
generic engine. No layer requires imperative code in the knowledge pack itself. The engine
is compiled into ArchGuard; the knowledge is loaded at startup.

---

## Knowledge Pack Structure

```
kotlin-pack/
├── manifest.json            # identity, version, engine compatibility range
├── grammar/
│   └── kotlin.wasm          # Tree-sitter grammar compiled to WASM
├── rules/
│   ├── modules.yaml         # import/export patterns
│   ├── dependencies.yaml    # package metadata file formats
│   └── frameworks/
│       ├── spring.yaml      # Spring Boot detection + entity mapping
│       ├── ktor.yaml        # Ktor HTTP framework
│       └── kotlinx.yaml     # kotlinx.coroutines concurrency patterns
└── patterns/
    └── architectural.yaml   # common idioms (data class, companion object, etc.)
```

### `manifest.json`

```json
{
  "name": "kotlin",
  "version": "1.2.0",
  "engine": ">=1.0.0 <2.0.0",
  "language": "kotlin",
  "extensions": [".kt", ".kts"],
  "frameworks": ["spring", "ktor", "kotlinx"],
  "sha256": "e3b0c44298fc1c149afb...",
  "repository": "https://github.com/archguard/packs"
}
```

### Framework rule format (`rules/frameworks/spring.yaml`)

```yaml
name: Spring Framework
detect:
  - file_match: "pom.xml"
    content_contains: "spring-boot"
  - file_match: "build.gradle*"
    content_contains: "spring-boot"
  - annotation_present: "@SpringBootApplication"

modules:
  controller:
    annotations: ["@Controller", "@RestController"]
    diagram_level: class
  service:
    annotations: ["@Service"]
    diagram_level: class
  repository:
    annotations: ["@Repository", "@JpaRepository"]
    diagram_level: class
  component:
    annotations: ["@Component", "@Bean"]
    diagram_level: class

entry_points:
  - annotation: "@GetMapping"
    protocol: http
    method: GET
    path_arg: value
  - annotation: "@PostMapping"
    protocol: http
    method: POST
    path_arg: value
  - annotation: "@RequestMapping"
    protocol: http
    path_arg: value
```

These rules are purely declarative. The engine evaluates them; knowledge packs contain
no executable code.

### Module import rules (`rules/modules.yaml`)

```yaml
import_patterns:
  - syntax: "import {names} from 'path'"
    type: esm
  - syntax: "import 'path'"
    type: esm_side_effect
  - syntax: "require('path')"
    type: commonjs
  - syntax: "import path"
    type: qualified     # Go-style
  - syntax: "using Namespace"
    type: csharp_using

path_resolution:
  root_relative: true
  extensions: [".kt", ".kts"]
  index_files: ["index.kt"]
```

---

## Built-in vs Online Split

### Built-in (shipped with ArchGuard binary)

High-frequency languages whose packs are embedded in the npm package at build time:

| Language | Core Frameworks |
|----------|----------------|
| TypeScript / JavaScript | Express, NestJS, Next.js, React |
| Go | net/http, gin, echo, chi, cobra, gRPC |
| Java | Spring Boot, Maven, Gradle |
| Python | Django, FastAPI, Flask, pip, poetry |

Built-in packs are located at `src/plugins/packs/` and loaded unconditionally. They are
versioned alongside ArchGuard itself and shipped as part of the npm package.

### Online (knowledge registry)

Maintained as a separate repository (`archguard/packs`) and distributed via a registry
endpoint. Fetched on demand, cached locally.

| Language | Examples |
|----------|---------|
| Rust | Cargo, Tokio, Actix |
| Kotlin | Spring, Ktor, kotlinx |
| C# / .NET | ASP.NET Core, NuGet |
| Ruby | Rails, Bundler |
| Swift | SwiftPM, Vapor |
| PHP | Composer, Laravel |
| Scala | sbt, Akka, Play |

---

## Runtime Loading (No LLM)

All knowledge pack evaluation is **deterministic rule matching**. No inference engine,
no LLM, no probabilistic scoring. The engine is a rule interpreter; packs are data.

### Resolution order

```
1. Project-local pack    ./archguard-packs/<lang>/
2. User cache            ~/.archguard/packs/<lang>@<version>/
3. Built-in              (embedded in binary)
4. Online registry       https://registry.archguard.dev/<lang>@<version>
```

The first match wins. Local and user-cache packs are preferred over built-ins, allowing
project-specific overrides.

### Pack loading flow

```
analyze -s ./src --lang kotlin
    │
    ▼
PackRegistry.resolve('kotlin')
    ├── check ./archguard-packs/kotlin/     (project-local)
    ├── check ~/.archguard/packs/kotlin/    (user cache, valid TTL?)
    ├── check built-in packs                (TypeScript/Go/Java/Python only)
    └── fetch registry.archguard.dev/kotlin@latest
            │
            ▼
        download manifest.json
        verify sha256
        download grammar.wasm + rules/
        store to ~/.archguard/packs/kotlin@1.2.0/
            │
            ▼
        PackLoader.load(packDir)
        RuleEngine.register(pack)
```

The fetch step is skipped entirely when running offline (`--offline` flag or
`ARCHGUARD_OFFLINE=true`). If no pack is found offline, analysis falls back to
generic import-graph extraction with no framework awareness.

### Rule engine interface

The rule engine is an internal ArchGuard module (`src/plugins/rule-engine/`) that:

1. **Detects** which frameworks are active using the `detect` stanzas
2. **Maps** AST nodes to ArchJSON entities using `modules` rules
3. **Extracts** entry points using `entry_points` rules
4. **Resolves** imports using `modules.yaml` patterns

The engine is stateless; packs are loaded once per `analyze` invocation and cached in
memory for the duration of the run.

---

## Registry and Continuous Maintenance

### Registry architecture

```
archguard/packs (GitHub repo)
├── packs/
│   ├── kotlin/
│   │   ├── 1.2.0/
│   │   │   ├── manifest.json
│   │   │   ├── grammar/kotlin.wasm
│   │   │   └── rules/...
│   │   └── latest -> 1.2.0
│   ├── rust/
│   └── ...
├── registry.json              # index: name → latest version + sha256
└── .github/workflows/
    ├── validate.yml           # CI: run acceptance tests per pack
    └── publish.yml            # on tag: update registry.json, create release
```

The registry endpoint returns `registry.json` — a static JSON file hosted on GitHub
Pages or a CDN. No server-side logic is required.

### Acceptance testing for packs

Each pack ships with a `tests/` directory containing reference projects:

```
packs/kotlin/tests/
├── spring-basic/          # minimal Spring Boot project
│   ├── src/main/kotlin/
│   └── expected.json      # expected ArchJSON output (entities + relations)
├── ktor-api/
│   └── ...
└── run-tests.sh           # invokes archguard, diffs against expected.json
```

CI runs `run-tests.sh` for every PR. A pack cannot be published if its acceptance tests
fail. The `expected.json` format is a subset of ArchJSON — only the fields the pack is
responsible for are asserted.

### Contribution model

1. Fork `archguard/packs`
2. Create `packs/<language>/` following the schema
3. Add at least one acceptance test project
4. Open a PR — CI validates grammar loading, rule parsing, and acceptance tests
5. Maintainer merges → `publish.yml` updates `registry.json` + creates a versioned release

### Versioning and stability

- Packs follow **semantic versioning**
- Engine compatibility is declared in `manifest.json` as a semver range (`engine`)
- Breaking changes to the rule schema require a major engine version bump and a migration
  note in `CHANGELOG.md`
- Packs may be yanked by removing them from `registry.json`; local cache entries are
  unaffected

---

## Integration with Existing Plugin System

The current `ILanguagePlugin` interface remains the primary extension point for complex
languages requiring imperative logic (e.g., TypeScript's ts-morph, Go's gopls). The
knowledge pack system provides a **complementary** path for languages where declarative
rules are sufficient.

A new `RuleBasedLanguagePlugin` adapter wraps a loaded pack and implements
`ILanguagePlugin`:

```typescript
// src/plugins/rule-engine/rule-based-plugin.ts
export class RuleBasedLanguagePlugin implements ILanguagePlugin {
  readonly language: string;
  readonly supportedLevels: readonly string[];

  constructor(private readonly pack: LoadedPack) {
    this.language = pack.manifest.language;
    this.supportedLevels = ['package', 'class'];
  }

  async initialize(projectRoot: string): Promise<void> {
    // grammar WASM already loaded; scan dependency files
  }

  async parseProject(root: string, pattern?: string): Promise<ArchJSON> {
    // 1. glob files by pack.manifest.extensions
    // 2. parse each file with pack.grammar (Tree-sitter WASM)
    // 3. apply pack.rules to extract entities and relations
    // 4. apply framework rules to enrich entry points
    // return ArchJSON
  }
}
```

The plugin registry (`src/plugins/registry.ts`) instantiates a `RuleBasedLanguagePlugin`
when a pack is found for a requested language and no imperative plugin is registered.
Imperative plugins always take precedence over rule-based plugins for the same language.

---

## Evolution Path

```
Phase 1 — Rule engine foundation
  Define pack schema (manifest, modules, dependencies, frameworks)
  Implement RuleEngine in src/plugins/rule-engine/
  Implement RuleBasedLanguagePlugin adapter
  Add PackRegistry with local-only resolution (no network)

Phase 2 — Migrate Java and Python to rule-based packs
  Validate that existing Java/Python analysis output is reproduced by rule-based packs
  Ship built-in packs for Java and Python alongside their imperative plugins (fallback)
  Remove imperative Java/Python plugins once packs reach parity

Phase 3 — Online registry
  Publish registry.json to archguard/packs on GitHub Pages
  Implement PackRegistry.fetchFromRegistry() with sha256 verification
  Implement ~/.archguard/packs/ cache with TTL (default: 7 days)
  Add --offline flag and ARCHGUARD_OFFLINE env var

Phase 4 — Community packs
  Publish pack schema and contribution guide
  Add CI acceptance test harness to archguard/packs
  Seed initial packs: Kotlin, Rust, C#
```

Phases 1 and 2 are internal refactors with no user-visible change. Phase 3 introduces
the first network dependency, behind an opt-out flag. Phase 4 opens the system to
external contributors.

---

## Open Questions

1. **Grammar WASM size**: Tree-sitter WASM grammars are typically 500 KB–2 MB each.
   The four built-in packs add ~4–8 MB to the npm package. Is this acceptable, or should
   even built-in grammars be lazily fetched?

2. **Registry hosting**: Self-hosted CDN vs npm registry vs GitHub Releases.
   Using npm (`@archguard/pack-kotlin`) would give version management and
   `node_modules`-style caching for free, at the cost of requiring `npm install` at
   runtime.

3. **Rule expressiveness ceiling**: YAML-based rules cannot express recursive patterns
   (e.g., transitive call graphs, nested annotation composition). At what complexity
   threshold should a language require an imperative plugin instead? Define a formal
   criterion.

4. **Enterprise offline mirror**: Should the pack registry support a full mirror mode
   (`ARCHGUARD_REGISTRY=https://internal.company.com/archguard-packs`)? This is needed
   for air-gapped environments.

5. **Pack trust model**: Packs from the official registry are signed (sha256 in
   `registry.json`). User-local packs in `./archguard-packs/` are untrusted and loaded
   with a warning. Should there be a way to sign local packs?
