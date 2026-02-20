/**
 * Dependency extraction interface for language plugins
 */

/**
 * Types of dependency management systems
 */
export type DependencyType = 'npm' | 'gomod' | 'pip' | 'maven' | 'cargo';

/**
 * Scope/purpose of a dependency
 */
export type DependencyScope = 'runtime' | 'development' | 'optional' | 'peer';

/**
 * Represents a project dependency
 */
export interface Dependency {
  /**
   * Package/module name
   */
  name: string;

  /**
   * Version specifier or constraint
   */
  version: string;

  /**
   * Type of dependency management system
   */
  type: DependencyType;

  /**
   * Scope/purpose of the dependency
   */
  scope: DependencyScope;

  /**
   * Source file where dependency is declared
   */
  source: string;

  /**
   * Whether this is a direct dependency (vs transitive)
   */
  isDirect: boolean;
}

/**
 * Interface for extracting project dependencies
 *
 * Plugins can optionally implement this interface to provide
 * dependency extraction capabilities for their target language.
 */
export interface IDependencyExtractor {
  /**
   * Extract all dependencies from a project
   *
   * Analyzes dependency manifest files (package.json, go.mod, etc.)
   * and returns a list of project dependencies with metadata.
   *
   * @param workspaceRoot - Root directory of the project
   * @returns Promise resolving to array of dependencies
   * @throws {FileError} When dependency manifest files cannot be read
   * @throws {ParseError} When dependency manifest files have invalid syntax
   */
  extractDependencies(workspaceRoot: string): Promise<Dependency[]>;
}
