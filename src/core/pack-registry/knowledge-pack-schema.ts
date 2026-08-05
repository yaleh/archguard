/**
 * Zod schema validators for knowledge packs (TASK-63).
 *
 * A knowledge pack is a union of five layers:
 *   manifest.json            → identity + extensions
 *   rules/modules.yaml       → import patterns + entity-node rules
 *   rules/dependencies.yaml  → package metadata file names
 *   rules/frameworks/*.yaml  → framework detection + module roles
 *   patterns/architectural.yaml → common idioms
 *
 * `KnowledgePackSchema.parse()` is the single validation entry point used by
 * PackRegistry.load(). A malformed pack (e.g. a manifest without a `language`
 * field) throws a ZodError whose message names the offending path.
 */

import { z } from 'zod';

export const KnowledgePackManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  engine: z.string(),
  language: z.string(),
  extensions: z.array(z.string()),
  frameworks: z.array(z.string()).default([]),
  sha256: z.string().optional(),
  repository: z.string().optional(),
});

export const ImportPatternRuleSchema = z.object({
  type: z.string(),
  pattern: z.string(),
  moduleGroup: z.number().int().positive().optional(),
});

export const EntityNodeRuleSchema = z.object({
  nodeType: z.string(),
  entityType: z.string(),
  abstractEntityType: z.string().optional(),
  nameField: z.string(),
  bodyField: z.string().optional(),
  methodNode: z.string().optional(),
  fieldNode: z.string().optional(),
  constructorNode: z.string().optional(),
  extendsField: z.string().optional(),
  implementsField: z.string().optional(),
  typeIdentifierNode: z.string().optional(),
  functionNode: z.string().optional(),
  baseClassField: z.string().optional(),
});

/** Fully-defaulted layer values. Zod v4 `.default()` uses the value as-is
 * (it does not re-parse), so object defaults must be complete, not `{}`. */
const EMPTY_PATH_RESOLUTION = { rootRelative: true, extensions: [], indexFiles: [] };
const DEFAULT_RELATIONS = {
  inheritance: true,
  implementation: true,
  fieldDependency: true,
  parameterDependency: true,
  importDependency: true,
};
const EMPTY_MODULE_RULE_SET = {
  importPatterns: [],
  entityNodes: [],
  relations: DEFAULT_RELATIONS,
  pathResolution: EMPTY_PATH_RESOLUTION,
};
const EMPTY_DEPENDENCY_RULE_SET = { packageFiles: [] };

export const RelationEmissionConfigSchema = z
  .object({
    inheritance: z.boolean().default(true),
    implementation: z.boolean().default(true),
    fieldDependency: z.boolean().default(true),
    parameterDependency: z.boolean().default(true),
    importDependency: z.boolean().default(true),
  })
  .default(DEFAULT_RELATIONS);

export const ModuleRuleSetSchema = z
  .object({
    importPatterns: z.array(ImportPatternRuleSchema).default([]),
    entityNodes: z.array(EntityNodeRuleSchema).default([]),
    relations: RelationEmissionConfigSchema,
    pathResolution: z
      .object({
        rootRelative: z.boolean().default(true),
        extensions: z.array(z.string()).default([]),
        indexFiles: z.array(z.string()).default([]),
      })
      .default(EMPTY_PATH_RESOLUTION),
  })
  .default(EMPTY_MODULE_RULE_SET);

export const DependencyRuleSetSchema = z
  .object({
    packageFiles: z.array(z.string()).default([]),
  })
  .default(EMPTY_DEPENDENCY_RULE_SET);

export const DetectRuleSchema = z.object({
  fileMatch: z.string().optional(),
  contentContains: z.string().optional(),
  annotationPresent: z.string().optional(),
});

export const FrameworkModuleRuleSchema = z.object({
  annotations: z.array(z.string()).default([]),
  diagramLevel: z.string().default('class'),
});

export const EntryPointRuleSchema = z.object({
  annotation: z.string(),
  protocol: z.string().optional(),
  method: z.string().optional(),
  pathArg: z.string().optional(),
});

export const FrameworkRuleSchema = z.object({
  name: z.string(),
  detect: z.array(DetectRuleSchema).default([]),
  modules: z.record(z.string(), FrameworkModuleRuleSchema).default({}),
  entryPoints: z.array(EntryPointRuleSchema).default([]),
});

export const ArchitecturalPatternSchema = z.object({
  name: z.string(),
  pattern: z.string(),
  description: z.string().optional(),
});

export const KnowledgePackSchema = z.object({
  manifest: KnowledgePackManifestSchema,
  modules: ModuleRuleSetSchema,
  dependencies: DependencyRuleSetSchema,
  frameworks: z.array(FrameworkRuleSchema).default([]),
  patterns: z.array(ArchitecturalPatternSchema).default([]),
});

export type KnowledgePackSchemaInput = z.input<typeof KnowledgePackSchema>;
export type KnowledgePackSchemaOutput = z.output<typeof KnowledgePackSchema>;
