/**
 * Knowledge pack registry barrel (TASK-63, Phase A).
 */

export { PackRegistry } from './pack-registry.js';
export type { PackRegistryOptions } from './pack-registry.js';
export { PackNotFoundError } from './errors.js';
export { KnowledgePackSchema } from './knowledge-pack-schema.js';
export type {
  KnowledgePackSchemaInput,
  KnowledgePackSchemaOutput,
} from './knowledge-pack-schema.js';
export type {
  KnowledgePack,
  KnowledgePackManifest,
  LoadedPack,
  ModuleRuleSet,
  DependencyRuleSet,
  RelationEmissionConfig,
  FrameworkRule,
  FrameworkModuleRule,
  EntityNodeRule,
  ImportPatternRule,
  DetectRule,
  EntryPointRule,
  ArchitecturalPattern,
} from './types.js';
