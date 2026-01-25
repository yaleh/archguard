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
  format: z.enum(['plantuml', 'json', 'svg']).default('plantuml'),
  exclude: z.array(z.string()).default(['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']),

  // ✅ SIMPLIFIED: No apiKey, maxTokens, temperature
  ai: z
    .object({
      model: z.string().optional(),
      timeout: z.number().optional(),
    })
    .optional()
    .default({}),

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

    // ✅ BACKWARD COMPATIBILITY: Show deprecation warning for apiKey
    if (fileConfig.ai && 'apiKey' in fileConfig.ai) {
      console.warn(
        'Warning: ai.apiKey is deprecated and will be ignored.\n' +
        'Claude Code CLI uses its own authentication.\n' +
        'Please remove apiKey from your config file.'
      );

      // Remove apiKey from config
      delete (fileConfig.ai as any).apiKey;
    }

    // Remove maxTokens and temperature if present (deprecated)
    if (fileConfig.ai && 'maxTokens' in fileConfig.ai) {
      delete (fileConfig.ai as any).maxTokens;
    }
    if (fileConfig.ai && 'temperature' in fileConfig.ai) {
      delete (fileConfig.ai as any).temperature;
    }

    const merged = { ...fileConfig, ...cliOptions };

    try {
      return configSchema.parse(merged);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
        throw new Error(`Configuration validation failed:\n${issues.join('\n')}`);
      }
      throw error;
    }
  }

  /**
   * Load configuration from file
   * Tries archguard.config.json first, then archguard.config.js
   */
  private async loadFromFile(): Promise<Partial<Config>> {
    // Try .json first
    const jsonPath = path.join(this.configDir, 'archguard.config.json');
    if (await fs.pathExists(jsonPath)) {
      return await fs.readJson(jsonPath);
    }

    // Try .js
    const jsPath = path.join(this.configDir, 'archguard.config.js');
    if (await fs.pathExists(jsPath)) {
      // Dynamic import for ES modules
      const module = await import(`file://${jsPath}`);
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
