/**
 * Knowledge pack type definitions (TASK-63).
 *
 * A "knowledge pack" is the declarative unit of language/framework knowledge
 * that the rule engine interprets. Packs are stored as YAML/JSON under
 * src/plugins/packs/<lang>/ and validated by the Zod schemas in
 * knowledge-pack-schema.ts. The engine ships as code; the knowledge is data.
 */

/** Identity + metadata of a language pack (from manifest.json). */
export interface KnowledgePackManifest {
  /** Unique pack name (lowercase, hyphen-separated), e.g. 'java'. */
  name: string;
  /** Semantic version of the pack. */
  version: string;
  /** Engine compatibility range, e.g. '>=1.0.0 <2.0.0'. */
  engine: string;
  /** Target language code, e.g. 'java', 'python'. */
  language: string;
  /** File extensions handled by this pack (e.g. ['.java']). */
  extensions: string[];
  /** Framework names referenced by this pack's framework rules. */
  frameworks: string[];
  /** Optional content hash for registry distribution. */
  sha256?: string;
  /** Optional source repository URL. */
  repository?: string;
}

/** Regex-based import pattern describing how files reference each other. */
export interface ImportPatternRule {
  /** Pattern identifier, e.g. 'java_import', 'python_from'. */
  type: string;
  /** Regex string applied against the source (multiline-safe). */
  pattern: string;
  /** Capture group index holding the module path (default 1). */
  moduleGroup?: number;
}

/**
 * Declarative entity-node extraction rule.
 *
 * Maps a tree-sitter node type to an ArchJSON entity kind, describing where
 * the name, body, and structural relations (extends/implements) live.
 */
export interface EntityNodeRule {
  /** Tree-sitter node type that declares the entity (e.g. 'class_declaration'). */
  nodeType: string;
  /** ArchJSON entity type produced, e.g. 'class' | 'interface' | 'enum'. */
  entityType: string;
  /** Entity type used when an 'abstract' modifier is present. */
  abstractEntityType?: string;
  /** Field name holding the entity's simple name. */
  nameField: string;
  /** Field name of the entity body (members live here). */
  bodyField?: string;
  /** Child node type for methods. */
  methodNode?: string;
  /** Child node type for fields. */
  fieldNode?: string;
  /** Child node type for constructors. */
  constructorNode?: string;
  /** Field name holding the superclass/extends target. */
  extendsField?: string;
  /** Field name holding the implemented interfaces. */
  implementsField?: string;
  /** Tree-sitter node type for type references inside extends/implements. */
  typeIdentifierNode?: string;
  /** Node type for module-level functions (Python). */
  functionNode?: string;
  /** Field name holding the base-class list (Python). */
  baseClassField?: string;
}

/** Which relation kinds the rule engine emits for this language.
 * Mirrors the imperative plugin's relation surface so packs can reach parity
 * (e.g. the imperative Java plugin emits field/parameter dependencies but not
 * import relations; Python emits import relations but not field dependencies). */
export interface RelationEmissionConfig {
  inheritance: boolean;
  implementation: boolean;
  fieldDependency: boolean;
  parameterDependency: boolean;
  importDependency: boolean;
}

/** Module-layer knowledge: import patterns + entity declaration rules. */
export interface ModuleRuleSet {
  importPatterns: ImportPatternRule[];
  entityNodes: EntityNodeRule[];
  relations: RelationEmissionConfig;
  pathResolution: {
    rootRelative: boolean;
    extensions: string[];
    indexFiles: string[];
  };
}

/** Dependency-layer knowledge: how package metadata is read. */
export interface DependencyRuleSet {
  /** Package metadata file names, e.g. ['pom.xml', 'build.gradle']. */
  packageFiles: string[];
}

/** Framework detection rule stanza (any match in a `detect` list activates it). */
export interface DetectRule {
  /** Project-relative file path to probe, e.g. 'pom.xml'. */
  fileMatch?: string;
  /** Substring that must be present in the matched file. */
  contentContains?: string;
  /** Annotation name that, when present in a source entity, activates the framework. */
  annotationPresent?: string;
}

/** A framework module role (controller/service/...) described by annotations. */
export interface FrameworkModuleRule {
  annotations: string[];
  diagramLevel: string;
}

/** Entry-point annotation rule (protocol/method/path metadata). */
export interface EntryPointRule {
  annotation: string;
  protocol?: string;
  method?: string;
  pathArg?: string;
}

/** Framework knowledge pack layer. */
export interface FrameworkRule {
  name: string;
  detect: DetectRule[];
  modules: Record<string, FrameworkModuleRule>;
  entryPoints: EntryPointRule[];
}

/** Common architectural idiom description. */
export interface ArchitecturalPattern {
  name: string;
  pattern: string;
  description?: string;
}

/** Fully validated, typed knowledge pack (the union of all layers). */
export interface KnowledgePack {
  manifest: KnowledgePackManifest;
  modules: ModuleRuleSet;
  dependencies: DependencyRuleSet;
  frameworks: FrameworkRule[];
  patterns: ArchitecturalPattern[];
}

/** A knowledge pack bound to the directory it was loaded from. */
export interface LoadedPack extends KnowledgePack {
  /** Absolute path of the pack directory. */
  rootPath: string;
}
