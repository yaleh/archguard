/**
 * Plugin-specific error classes
 *
 * These error types extend the base error types from @/cli/errors.js
 * to provide plugin-specific error handling.
 */

/**
 * Base error class for all plugin-related errors
 */
export class PluginError extends Error {
  /**
   * Error code for programmatic identification
   */
  public readonly code: string;

  /**
   * Name of the plugin that threw the error
   */
  public readonly pluginName: string;

  /**
   * Original error that caused this error (if any)
   */
  public override readonly cause?: Error;

  constructor(message: string, code: string, pluginName: string, cause?: Error) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.pluginName = pluginName;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when plugin initialization fails
 */
export class PluginInitializationError extends PluginError {
  constructor(pluginName: string, message: string, cause?: Error) {
    super(
      `Failed to initialize plugin '${pluginName}': ${message}`,
      'PLUGIN_INIT_FAILED',
      pluginName,
      cause
    );
    this.name = 'PluginInitializationError';
  }
}

/**
 * Error thrown when plugin configuration is invalid
 */
export class PluginConfigError extends PluginError {
  /**
   * Configuration field that caused the error
   */
  public readonly field?: string;

  constructor(pluginName: string, message: string, field?: string, cause?: Error) {
    super(
      `Invalid configuration for plugin '${pluginName}': ${message}`,
      'PLUGIN_CONFIG_INVALID',
      pluginName,
      cause
    );
    this.name = 'PluginConfigError';
    this.field = field;
  }
}

/**
 * Error thrown when a required external tool is missing
 * @example Go plugin requires 'go' command, Java plugin requires 'javac'
 */
export class ToolDependencyError extends PluginError {
  /**
   * Name of the missing tool
   */
  public readonly toolName: string;

  /**
   * Minimum required version (if applicable)
   */
  public readonly requiredVersion?: string;

  constructor(pluginName: string, toolName: string, requiredVersion?: string) {
    const versionInfo = requiredVersion ? ` (>= ${requiredVersion})` : '';
    super(
      `Plugin '${pluginName}' requires '${toolName}'${versionInfo} to be installed`,
      'TOOL_DEPENDENCY_MISSING',
      pluginName
    );
    this.name = 'ToolDependencyError';
    this.toolName = toolName;
    this.requiredVersion = requiredVersion;
  }
}

/**
 * Error thrown when parsing fails during plugin operations
 */
export class ParseError extends PluginError {
  /**
   * Path to the file that caused the parsing error
   */
  public readonly file: string;

  /**
   * Line number where the error occurred (if known)
   */
  public readonly line?: number;

  constructor(message: string, pluginName: string, file: string, line?: number, cause?: Error) {
    super(message, 'PARSE_ERROR', pluginName, cause);
    this.name = 'ParseError';
    this.file = file;
    this.line = line;
  }
}

/**
 * Error thrown when file system operations fail during plugin operations
 */
export class FileSystemError extends PluginError {
  /**
   * Path to the file/directory that caused the error
   */
  public readonly path: string;

  /**
   * Type of operation that failed
   */
  public readonly operation: 'read' | 'write' | 'delete' | 'create' | 'stat';

  constructor(
    pluginName: string,
    operation: 'read' | 'write' | 'delete' | 'create' | 'stat',
    path: string,
    cause?: Error
  ) {
    super(
      `Failed to ${operation} '${path}' in plugin '${pluginName}'`,
      'FILESYSTEM_ERROR',
      pluginName,
      cause
    );
    this.name = 'FileSystemError';
    this.path = path;
    this.operation = operation;
  }
}
