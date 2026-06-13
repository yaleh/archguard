/**
 * Core interfaces for ArchGuard plugin system
 *
 * This module exports all core interfaces that plugins and the core system use.
 */

// Parser interfaces
export type { IParser, ParseConfig } from './parser.js';

// Dependency extraction interfaces
export type {
  IDependencyExtractor,
  Dependency,
  DependencyType,
  DependencyScope,
} from './dependency.js';

// Validation interfaces
export type {
  IValidator,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './validation.js';

// Language plugin interfaces
export type {
  ILanguagePlugin,
  PluginMetadata,
  PluginCapabilities,
  PluginInitConfig,
} from './language-plugin.js';

// CLI-layer facade interfaces (decouple processors from concrete parser/renderer)
export type { IParserFacade } from './parser-facade.js';
export type { IRendererFacade, MermaidOutputOptions, RenderJob } from './renderer-facade.js';

// Plugin error classes
export {
  PluginError,
  PluginInitializationError,
  PluginConfigError,
  ToolDependencyError,
  FileSystemError,
  ParseError,
} from './errors.js';
