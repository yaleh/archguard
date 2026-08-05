/**
 * ArchGuard core barrel (TASK-63).
 *
 * Re-exports the core plugin-registry and the knowledge-pack registry /
 * rule-engine modules so consumers can import from '@/core/index.js'.
 */

export { PluginRegistry } from './plugin-registry.js';
export type { RegisterOptions } from './plugin-registry.js';

export { PackRegistry, PackNotFoundError, KnowledgePackSchema } from './pack-registry/index.js';
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
  PackRegistryOptions,
} from './pack-registry/index.js';

export { RuleEngine, RuleBasedLanguagePlugin } from './rule-engine/index.js';
export type { RuleEngineFileResult, RuleEngineOptions } from './rule-engine/index.js';
