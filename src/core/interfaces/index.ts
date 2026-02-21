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

// Plugin error classes
export {
  PluginError,
  PluginInitializationError,
  PluginConfigError,
  ToolDependencyError,
  FileSystemError,
  ParseError,
} from './errors.js';
