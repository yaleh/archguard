import type { CustomEntityTypeDeclaration } from './interfaces/language-plugin.js';

/**
 * Registry for custom entity types declared by language plugins.
 *
 * Plugins register their custom types during initialization so that the
 * Mermaid renderer and query engine can handle them gracefully without
 * requiring hard-coded knowledge of plugin-specific types.
 */
export class EntityTypeRegistry {
  private readonly entries = new Map<string, CustomEntityTypeDeclaration>();

  /**
   * Register a custom entity type declaration.
   * If the same type is registered twice, the second call overwrites the first.
   */
  register(decl: CustomEntityTypeDeclaration): void {
    this.entries.set(decl.type, decl);
  }

  /**
   * Retrieve the declaration for a given type string.
   * Returns undefined if the type has not been registered.
   */
  get(type: string): CustomEntityTypeDeclaration | undefined {
    return this.entries.get(type);
  }

  /**
   * Return all registered custom type strings.
   */
  listCustomTypes(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Remove all registered entries.
   * Primarily used in tests to reset state between test cases.
   */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * Module-level singleton. Import this in plugins and renderers.
 */
export const globalEntityTypeRegistry = new EntityTypeRegistry();
