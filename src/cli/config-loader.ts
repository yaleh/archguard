/**
 * Configuration Loader - Load and validate configuration from files
 */

import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';

/**
 * Configuration schema with validation
 */
const configSchema = z.object({
  source: z.string().default('./src'),
  output: z.string().optional(),
  outputDir: z.string().default('./archguard'),
  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
  exclude: z.array(z.string()).default(['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']),

  // CLI Configuration
  cli: z
    .object({
      command: z.string().default('claude'),
      args: z.array(z.string()).default([]),
      timeout: z.number().default(60000),
    })
    .default({
      command: 'claude',
      args: [],
      timeout: 60000,
    }),

  // ✅ BACKWARD COMPATIBILITY: ai config (deprecated but still supported)
  // Note: This field is removed by normalizeConfig if empty after migration
  ai: z
    .object({
      model: z.string().optional(),
      timeout: z.number().optional(),
    })
    .optional(),

  cache: z
    .object({
      enabled: z.boolean().default(true),
      ttl: z.number().default(86400), // 24 hours in seconds
    })
    .default({
      enabled: true,
      ttl: 86400,
    }),
  concurrency: z.number().optional(),
  verbose: z.boolean().optional(),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Intermediate configuration type for file loading
 * Includes deprecated fields that will be migrated/removed
 */
interface FileConfig {
  source?: string;
  output?: string;
  outputDir?: string;
  format?: 'plantuml' | 'json' | 'svg';
  exclude?: string[];
  cli?: {
    command?: string;
    args?: string[];
    timeout?: number;
  };
  ai?: {
    model?: string;
    timeout?: number;
    apiKey?: string;
    maxTokens?: number;
    temperature?: number;
  };
  cache?: {
    enabled?: boolean;
    ttl?: number;
  };
  concurrency?: number;
  verbose?: boolean;
}

/**
 * ConfigLoader loads and validates configuration from files
 * Features:
 * - Support for archguard.config.json
 * - Support for archguard.config.js (with module.exports)
 * - CLI options override config file values
 * - Zod schema validation
 * - Default value handling
 * - Config file generation (init command)
 * - Backward compatibility with deprecated options
 */
export class ConfigLoader {
  private configDir: string;

  constructor(configDir: string = process.cwd()) {
    this.configDir = configDir;
  }

  /**
   * Load configuration from file and merge with CLI options
   */
  async load(cliOptions: Partial<Config> = {}): Promise<Config> {
    const fileConfig = await this.loadFromFile();
    const normalized = this.normalizeConfig(fileConfig);
    const merged = this.deepMerge(normalized, cliOptions);

    try {
      return configSchema.parse(merged);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((issue) => {
            const path = issue.path.join('.');
            return `  - ${path}: ${issue.message}`;
          })
          .join('\n');
        throw new Error(`Configuration validation failed:\n${issues}`);
      }
      throw error;
    }
  }

  /**
   * Normalize configuration by migrating deprecated fields
   * - ai.model -> cli.args
   * - ai.timeout -> cli.timeout
   * - Remove deprecated fields: apiKey, maxTokens, temperature
   */
  private normalizeConfig(config: FileConfig): FileConfig {
    const normalized = { ...config };

    // Show deprecation warning for apiKey
    if (normalized.ai && 'apiKey' in normalized.ai) {
      console.warn(
        'Warning: ai.apiKey is deprecated and will be ignored.\n' +
          'Claude Code CLI uses its own authentication.\n' +
          'Please remove apiKey from your config file.'
      );
    }

    // ai.model -> cli.args
    if (normalized.ai?.model && !normalized.cli?.args) {
      normalized.cli = normalized.cli || {};
      normalized.cli.args = ['--model', normalized.ai.model];
    }

    // ai.timeout -> cli.timeout
    if (normalized.ai?.timeout && !normalized.cli?.timeout) {
      normalized.cli = normalized.cli || {};
      normalized.cli.timeout = normalized.ai.timeout;
    }

    // Remove deprecated config
    if (normalized.ai) {
      delete normalized.ai.apiKey;
      delete normalized.ai.maxTokens;
      delete normalized.ai.temperature;
      delete normalized.ai.model;
      delete normalized.ai.timeout;

      if (Object.keys(normalized.ai).length === 0) {
        delete normalized.ai;
      }
    }

    return normalized;
  }

  /**
   * Deep merge two objects
   * - Nested objects are merged recursively
   * - Arrays are replaced (not merged)
   * - Source values override target values
   */
  private deepMerge(target: FileConfig, source: Partial<Config>): FileConfig {
    const output: FileConfig = { ...target };

    if (this.isObject(target) && this.isObject(source)) {
      (Object.keys(source) as Array<keyof typeof source>).forEach((key) => {
        const sourceValue = source[key];
        if (sourceValue && this.isObject(sourceValue)) {
          if (!(key in target)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            (output as any)[key] = sourceValue;
          } else {
            const targetValue = target[key];
            if (targetValue && this.isObject(targetValue)) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              (output as any)[key] = this.deepMerge(
                targetValue as FileConfig,
                sourceValue as Partial<Config>
              );
            }
          }
        } else if (sourceValue !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          (output as any)[key] = sourceValue;
        }
      });
    }

    return output;
  }

  /**
   * Check if value is a plain object (not array, null, etc.)
   */
  private isObject(item: unknown): item is Record<string, unknown> {
    return item !== null && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Load configuration from file
   * Tries archguard.config.json first, then archguard.config.js
   */
  private async loadFromFile(): Promise<FileConfig> {
    // Try .json first
    const jsonPath = path.join(this.configDir, 'archguard.config.json');
    if (await fs.pathExists(jsonPath)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return await fs.readJson(jsonPath);
    }

    // Try .js
    const jsPath = path.join(this.configDir, 'archguard.config.js');
    if (await fs.pathExists(jsPath)) {
      // Dynamic import for ES modules
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const module = await import(`file://${jsPath}`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
      return module.default ?? module;
    }

    // No config file found, return empty object (will use defaults)
    return {};
  }

  /**
   * Initialize a new configuration file
   */
  async init(options: { format?: 'json' | 'js' } = {}): Promise<void> {
    const format = options.format ?? 'json';
    const configPath = path.join(this.configDir, `archguard.config.${format}`);

    if (await fs.pathExists(configPath)) {
      throw new Error('Configuration file already exists');
    }

    const defaultConfig: Config = configSchema.parse({});

    if (format === 'json') {
      await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    } else {
      // Generate .js config
      const jsContent = `export default ${JSON.stringify(defaultConfig, null, 2)};
`;
      await fs.writeFile(configPath, jsContent);
    }
  }

  /**
   * Get config file path if it exists
   */
  async getConfigPath(): Promise<string | null> {
    const jsonPath = path.join(this.configDir, 'archguard.config.json');
    if (await fs.pathExists(jsonPath)) {
      return jsonPath;
    }

    const jsPath = path.join(this.configDir, 'archguard.config.js');
    if (await fs.pathExists(jsPath)) {
      return jsPath;
    }

    return null;
  }
}
