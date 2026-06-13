import type { GlobalConfig } from '@/types/config.js';
import type { ParseCache } from '@/parser/parse-cache.js';
import type { PluginRegistry } from '@/core/plugin-registry.js';

export interface ArchJsonProviderOptions {
  globalConfig: GlobalConfig;
  parseCache?: ParseCache;
  registry?: PluginRegistry;
}

export interface ArchJsonGetOptions {
  /**
   * True when any diagram in the current source group has level === 'package'.
   * Computed by the caller (processSourceGroup) as `diagrams.some(d => d.level === 'package')`.
   * The provider must not re-derive this — it's a group-level property, not a single-diagram property.
   */
  needsModuleGraph: boolean;
}
