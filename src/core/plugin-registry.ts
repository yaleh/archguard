/**
 * Plugin Registry for managing language plugins
 *
 * Provides centralized plugin registration, discovery, and version management.
 */

import { pathToFileURL } from 'node:url';
import type { ILanguagePlugin } from './interfaces/index.js';

/**
 * Options for plugin registration
 */
export interface RegisterOptions {
  /**
   * Whether to overwrite existing plugin with same name/version
   * @default false
   */
  overwrite?: boolean;
}

/**
 * Registry for managing language plugins
 *
 * Responsibilities:
 * - Plugin registration with version management
 * - File extension to plugin mapping
 * - Directory-based plugin detection
 * - Plugin discovery and loading
 */
export class PluginRegistry {
  /**
   * Map of plugin name -> version -> plugin instance
   */
  private plugins: Map<string, Map<string, ILanguagePlugin>> = new Map();

  /**
   * Map of file extension -> plugin instances
   * Multiple plugins can handle the same extension
   */
  private extensionMap: Map<string, ILanguagePlugin[]> = new Map();

  /**
   * Register a plugin in the registry
   *
   * @param plugin - The plugin to register
   * @param options - Registration options
   * @throws {Error} When plugin with same name/version exists and overwrite is false
   */
  register(plugin: ILanguagePlugin, options: RegisterOptions = {}): void {
    const { name, version, fileExtensions } = plugin.metadata;
    const { overwrite = false } = options;

    // Check for duplicate registration
    if (!this.plugins.has(name)) {
      this.plugins.set(name, new Map());
    }

    const versionMap = this.plugins.get(name)!;
    if (versionMap.has(version) && !overwrite) {
      throw new Error(
        `Plugin '${name}@${version}' is already registered. Use overwrite option to replace.`
      );
    }

    // Register plugin
    versionMap.set(version, plugin);

    // Register file extensions
    for (const ext of fileExtensions) {
      if (!this.extensionMap.has(ext)) {
        this.extensionMap.set(ext, []);
      }
      const plugins = this.extensionMap.get(ext)!;

      // Remove old version if overwriting
      if (overwrite) {
        const index = plugins.findIndex(
          (p) => p.metadata.name === name && p.metadata.version === version
        );
        if (index !== -1) {
          plugins.splice(index, 1);
        }
      }

      plugins.push(plugin);

      // Sort by version (highest first) for priority
      plugins.sort((a, b) => this.compareVersions(b.metadata.version, a.metadata.version));
    }
  }

  /**
   * Get plugin by name and optional version
   *
   * @param name - Plugin name
   * @param version - Optional version. If not specified, returns latest version
   * @returns Plugin instance or null if not found
   */
  getByName(name: string, version?: string): ILanguagePlugin | null {
    const versionMap = this.plugins.get(name);
    if (!versionMap) {
      return null;
    }

    if (version) {
      return versionMap.get(version) ?? null;
    }

    // Return latest version
    const versions = Array.from(versionMap.keys());
    if (versions.length === 0) {
      return null;
    }

    versions.sort((a, b) => this.compareVersions(b, a));
    const latestVersion = versions[0];
    return versionMap.get(latestVersion) ?? null;
  }

  /**
   * Get plugin by file extension
   *
   * @param extension - File extension (e.g., '.ts', '.go')
   * @returns Plugin instance or null if no plugin handles this extension
   */
  getByExtension(extension: string): ILanguagePlugin | null {
    const plugins = this.extensionMap.get(extension);
    if (!plugins || plugins.length === 0) {
      return null;
    }

    // Return highest priority plugin (first in sorted list)
    return plugins[0];
  }

  /**
   * Detect plugin for a directory based on project markers
   *
   * @param directoryPath - Path to directory
   * @returns Plugin instance or null if no plugin detected
   */
  detectPluginForDirectory(directoryPath: string): ILanguagePlugin | null {
    // This will be implemented with filesystem checks
    // For now, return null as placeholder
    // Future implementation will check for:
    // - package.json -> TypeScript plugin
    // - go.mod -> Go plugin
    // - pom.xml -> Java plugin
    // - requirements.txt -> Python plugin
    // - Cargo.toml -> Rust plugin
    return null;
  }

  /**
   * List all versions of a plugin
   *
   * @param name - Plugin name
   * @returns Array of version strings, sorted ascending
   */
  listVersions(name: string): string[] {
    const versionMap = this.plugins.get(name);
    if (!versionMap) {
      return [];
    }

    const versions = Array.from(versionMap.keys());
    versions.sort((a, b) => this.compareVersions(a, b));
    return versions;
  }

  /**
   * List all registered plugins
   *
   * @returns Array of all plugin instances
   */
  listAll(): ILanguagePlugin[] {
    const allPlugins: ILanguagePlugin[] = [];

    for (const versionMap of this.plugins.values()) {
      for (const plugin of versionMap.values()) {
        allPlugins.push(plugin);
      }
    }

    return allPlugins;
  }

  /**
   * Check if a plugin is registered
   *
   * @param name - Plugin name
   * @param version - Optional version
   * @returns true if plugin exists
   */
  has(name: string, version?: string): boolean {
    const versionMap = this.plugins.get(name);
    if (!versionMap) {
      return false;
    }

    if (version) {
      return versionMap.has(version);
    }

    return versionMap.size > 0;
  }

  /**
   * Load a plugin from a file path (ESM dynamic import)
   *
   * @param pluginPath - Absolute path to plugin module
   * @returns Promise resolving to plugin instance
   */
  async loadFromPath(pluginPath: string): Promise<ILanguagePlugin> {
    // Convert path to file URL for ESM import
    const pluginUrl = pathToFileURL(pluginPath).href;

    // Dynamic import
    const module = await import(pluginUrl);

    // Extract default export or named export
    const PluginClass = module.default || module.Plugin;

    if (!PluginClass) {
      throw new Error(
        `Plugin at '${pluginPath}' must export a default class or named 'Plugin' export`
      );
    }

    // Instantiate plugin
    const plugin = new PluginClass();

    return plugin as ILanguagePlugin;
  }

  /**
   * Compare two semantic versions
   *
   * @param a - First version
   * @param b - Second version
   * @returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map((n) => parseInt(n, 10));
    const partsB = b.split('.').map((n) => parseInt(n, 10));

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;

      if (numA < numB) return -1;
      if (numA > numB) return 1;
    }

    return 0;
  }
}
