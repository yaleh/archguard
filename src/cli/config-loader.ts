/**
 * Configuration Loader - Load and validate configuration from files
 * v2.0.0 Breaking Change: Complete redesign of configuration structure
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { z } from 'zod';
export type { ArchGuardConfig } from '../types/config.js';

/**
 * Configuration schema with validation (v2.0)
 *
 * Breaking Changes from v1.x:
 * - Removed: source, output fields
 * - Added: diagrams[] array
 * - Removed: ai config (deprecated)
 *
 * Breaking Changes from v2.0 to v2.1:
 * - Changed default format from 'plantuml' to 'mermaid'
 * - Added mermaid-specific configuration
 * - Removed plantuml and svg formats (only 'mermaid' and 'json' supported)
 */

// Mermaid configuration schema
const MermaidConfigSchema = z.object({
  renderer: z.enum(['isomorphic', 'cli']).optional(),
  theme: z.enum(['default', 'forest', 'dark', 'neutral']).optional(),
  transparentBackground: z.boolean().optional(),
});

// v2.1.0: Diagram metadata schema
const DiagramMetadataSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  purpose: z.string().optional(),
  primaryActors: z.array(z.string()).optional(),
  input: z
    .object({
      type: z.string(),
      description: z.string().optional(),
      example: z.string().optional(),
    })
    .optional(),
  output: z
    .object({
      description: z.string(),
      formats: z.array(z.string()).optional(),
      example: z.string().optional(),
    })
    .optional(),
});

// v2.1.0: Design pattern schema
const DesignPatternInfoSchema = z.object({
  name: z.string(),
  category: z.enum(['creational', 'structural', 'behavioral', 'concurrency']),
  participants: z.array(z.string()),
  description: z.string(),
  codeExample: z.string().optional(),
});

const DesignInfoSchema = z.object({
  architectureStyle: z.enum(['layered', 'event-driven', 'microkernel', 'serverless']).optional(),
  patterns: z.array(DesignPatternInfoSchema).optional(),
  principles: z.array(z.string()).optional(),
  decisions: z
    .array(
      z.object({
        topic: z.string(),
        decision: z.string(),
        rationale: z.string(),
        alternatives: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

// v2.1.0: Process info schema
const ProcessStageSchema = z.object({
  order: z.number(),
  name: z.string(),
  description: z.string(),
  namespace: z.string().optional(),
  patterns: z.array(z.string()).optional(),
});

const ProcessInfoSchema = z.object({
  stages: z.number().optional(),
  stageList: z.array(ProcessStageSchema).optional(),
  dataFlow: z.string().optional(),
  keyDependencies: z.array(z.string()).optional(),
});

// v2.1.0: Annotation config schema
// v2.1.1: Added visible title support
const AnnotationConfigSchema = z.object({
  enableComments: z.boolean().optional(),
  highlightPatterns: z.boolean().optional(),
  showExternalDeps: z.boolean().optional(),
  includeUsageExample: z.boolean().optional(),
  // v2.1.1: Visible title in rendered images
  enableVisibleTitle: z.boolean().optional(),
  visibleTitleSections: z
    .array(
      z.enum([
        'title',
        'subtitle',
        'purpose',
        'input',
        'output',
        'patterns',
        'principles',
        'process',
      ])
    )
    .optional(),
  titlePosition: z.enum(['top', 'bottom']).optional(),
});

const ClassAnnotationSchema = z.object({
  className: z.string(),
  note: z.string().optional(),
  stereotypes: z.array(z.string()).optional(),
  responsibility: z.string().optional(),
});

const ClassHighlightConfigSchema = z.object({
  highlightClasses: z.array(z.string()).optional(),
  annotateClasses: z.array(ClassAnnotationSchema).optional(),
  visibility: z
    .object({
      show: z.array(z.string()).optional(),
      hide: z.array(z.string()).optional(),
    })
    .optional(),
});

const configSchema = z.object({
  // ========== Global Configuration ==========
  outputDir: z.string().default('./archguard'),
  format: z.enum(['mermaid', 'json']).default('mermaid'),
  mermaid: MermaidConfigSchema.optional(),
  exclude: z.array(z.string()).default(['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']),

  // ========== CLI Configuration ==========
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

  // ========== Cache Configuration ==========
  cache: z
    .object({
      enabled: z.boolean().default(true),
      ttl: z.number().default(86400), // 24 hours in seconds
    })
    .default({
      enabled: true,
      ttl: 86400,
    }),

  // ========== Other Configuration ==========
  concurrency: z.number().default(os.cpus().length),
  verbose: z.boolean().default(false),

  // ========== v2.1.0: Root Metadata (Optional) ==========
  metadata: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      system: z.string().optional(),
      author: z.string().optional(),
      projectUrl: z.string().optional(),
      keywords: z.array(z.string()).optional(),
    })
    .optional(),

  // ========== Diagrams Configuration (v2.0 Core Change + v2.1.0 Enhancement) ==========
  /**
   * Array of diagram definitions
   *
   * Core Design: "Everything is a Diagram"
   * - Empty array: Use CLI shortcut or default diagram
   * - Single diagram: diagrams.length === 1
   * - Multiple diagrams: diagrams.length > 1
   */
  diagrams: z
    .array(
      z.object({
        /** Diagram output name (supports subdirectories) */
        name: z.string(),
        /** Source paths or glob patterns */
        sources: z.array(z.string()),
        /** Detail level: package, class, or method */
        level: z.enum(['package', 'class', 'method']),
        /** Human-readable description */
        description: z.string().optional(),
        /** Output format override */
        format: z.enum(['mermaid', 'json']).optional(),
        /** Exclude patterns override */
        exclude: z.array(z.string()).optional(),
        /** v2.1.0: Diagram metadata */
        metadata: DiagramMetadataSchema.optional(),
        /** v2.1.0: Design information */
        design: DesignInfoSchema.optional(),
        /** v2.1.0: Process information */
        process: ProcessInfoSchema.optional(),
        /** v2.1.0: Annotation configuration */
        annotations: AnnotationConfigSchema.optional(),
        /** v2.1.0: Class-level annotations */
        classes: ClassHighlightConfigSchema.optional(),
      })
    )
    .default([]),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Intermediate configuration type for file loading (v2.0)
 *
 * Breaking Change: Removed all deprecated fields
 */
interface FileConfig {
  outputDir?: string;
  format?: 'mermaid' | 'json';
  mermaid?: {
    renderer?: 'isomorphic' | 'cli';
    theme?: 'default' | 'forest' | 'dark' | 'neutral';
    transparentBackground?: boolean;
  };
  exclude?: string[];
  cli?: {
    command?: string;
    args?: string[];
    timeout?: number;
  };
  cache?: {
    enabled?: boolean;
    ttl?: number;
  };
  concurrency?: number;
  verbose?: boolean;
  diagrams?: Array<{
    name: string;
    sources: string[];
    level: 'package' | 'class' | 'method';
    description?: string;
    format?: 'mermaid' | 'json';
    exclude?: string[];
  }>;
}

/**
 * ConfigLoader loads and validates configuration from files (v2.0)
 *
 * Features:
 * - Support for archguard.config.json
 * - Support for archguard.config.js (with module.exports)
 * - CLI options override config file values
 * - Zod schema validation
 * - Default value handling
 * - Config file generation (init command)
 *
 * Breaking Changes from v1.x:
 * - Removed backward compatibility with deprecated options
 * - Configuration structure completely redesigned
 * - Old config files will NOT work with v2.0
 */
export class ConfigLoader {
  private configDir: string;

  constructor(configDir: string = process.cwd()) {
    this.configDir = configDir;
  }

  /**
   * Load configuration from file and merge with CLI options
   *
   * @param cliOptions - CLI options to override config file values
   * @param configPath - Optional custom config file path
   */
  async load(cliOptions: Partial<Config> = {}, configPath?: string): Promise<Config> {
    const fileConfig = await this.loadFromFile(configPath);
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
   * Normalize configuration (v2.0 - simplified, no backward compatibility)
   *
   * In v2.0, we no longer migrate deprecated fields.
   * Old configuration files will fail validation with clear error messages.
   */
  private normalizeConfig(config: FileConfig): FileConfig {
    // Simply return the config as-is
    // All validation is handled by Zod schema
    return { ...config };
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
   *
   * @param configPath - Optional custom config file path
   */
  private async loadFromFile(configPath?: string): Promise<FileConfig> {
    // If configPath is provided, load it directly
    if (configPath) {
      const resolvedPath = path.resolve(configPath);
      if (await fs.pathExists(resolvedPath)) {
        if (resolvedPath.endsWith('.json')) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return await fs.readJson(resolvedPath);
        } else if (resolvedPath.endsWith('.js')) {
          // Dynamic import for ES modules
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          const module = await import(`file://${resolvedPath}`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
          return module.default ?? module;
        }
      }
      throw new Error(`Config file not found: ${configPath}`);
    }

    // Otherwise, use default search behavior
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
