/**
 * PackRegistry — loads and validates knowledge packs (TASK-63, Phase A).
 *
 * Resolution order for a language (per the design proposal):
 *   1. Project-local pack  ./archguard-packs/<lang>/
 *   2. User cache          ~/.archguard/packs/<lang>/
 *   3. Built-in            src/plugins/packs/<lang>/
 *   4. Online registry     (Phase 3, deferred)
 *
 * This task implements built-in resolution only. `resolve()` consults the
 * built-in packs root; the online/community layers are explicitly out of
 * scope for Phases 1-2.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { KnowledgePackSchema } from './knowledge-pack-schema.js';
import { PackNotFoundError } from './errors.js';
import type { LoadedPack } from './types.js';

/** Default built-in packs root, resolved relative to this module. */
function defaultBuiltinPacksRoot(): string {
  // src/core/pack-registry/ → src/plugins/packs/
  return fileURLToPath(new URL('../../plugins/packs/', import.meta.url));
}

/**
 * Recursively convert snake_case object keys to camelCase.
 *
 * The pack YAML files use snake_case (per the design proposal, e.g.
 * `import_patterns`, `path_resolution`, `diagram_level`); the TypeScript
 * schema consumes camelCase. String values and arrays are left untouched.
 */
function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeKeys(v));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[toCamelCase(key)] = normalizeKeys(val);
    }
    return out;
  }
  return value;
}

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

export interface PackRegistryOptions {
  /** Root directory containing built-in packs (one subdirectory per language). */
  builtinPacksRoot?: string;
}

/**
 * Loads knowledge packs from disk, validates them with the Zod schema, and
 * exposes built-in pack resolution per language.
 */
export class PackRegistry {
  private readonly builtinPacksRoot: string;

  constructor(options: PackRegistryOptions = {}) {
    this.builtinPacksRoot = options.builtinPacksRoot ?? defaultBuiltinPacksRoot();
  }

  /** Absolute path of the built-in packs root (test visibility). */
  get packsRoot(): string {
    return this.builtinPacksRoot;
  }

  /**
   * Load and validate a knowledge pack from a directory.
   *
   * @throws {PackNotFoundError} when manifest.json is missing
   * @throws {ZodError} when the pack fails schema validation
   */
  async load(packDir: string): Promise<LoadedPack> {
    const resolved = path.resolve(packDir);
    const manifestPath = path.join(resolved, 'manifest.json');
    if (!(await fs.pathExists(manifestPath))) {
      throw new PackNotFoundError(resolved);
    }

    const manifest = (await fs.readJson(manifestPath)) as Record<string, unknown>;
    const modules = await this.readYaml(path.join(resolved, 'rules', 'modules.yaml'));
    const dependencies = await this.readYaml(path.join(resolved, 'rules', 'dependencies.yaml'));
    const frameworks = await this.readFrameworks(path.join(resolved, 'rules', 'frameworks'));
    const patterns = await this.readYaml(path.join(resolved, 'patterns', 'architectural.yaml'));

    const parsed = KnowledgePackSchema.parse({
      manifest,
      modules: modules ?? {},
      dependencies: dependencies ?? {},
      frameworks: frameworks ?? [],
      patterns: patterns ?? [],
    });

    return { ...parsed, rootPath: resolved };
  }

  /**
   * Resolve the built-in pack for a language.
   *
   * @returns the loaded pack, or undefined when no built-in pack exists for
   *   the language (a missing directory or a directory without a manifest).
   */
  async resolve(language: string): Promise<LoadedPack | undefined> {
    const packDir = path.join(this.builtinPacksRoot, language);
    if (!(await fs.pathExists(packDir))) {
      return undefined;
    }
    try {
      return await this.load(packDir);
    } catch (error) {
      if (error instanceof PackNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /** List languages that have a built-in pack directory. */
  async list(): Promise<string[]> {
    if (!(await fs.pathExists(this.builtinPacksRoot))) {
      return [];
    }
    const entries = await fs.readdir(this.builtinPacksRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  private async readYaml(filePath: string): Promise<unknown> {
    if (!(await fs.pathExists(filePath))) {
      return undefined;
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return normalizeKeys(yaml.load(content));
  }

  private async readFrameworks(dir: string): Promise<unknown[]> {
    if (!(await fs.pathExists(dir))) {
      return [];
    }
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    const result: unknown[] = [];
    for (const file of files) {
      const rule = await this.readYaml(path.join(dir, file));
      if (rule !== undefined) {
        result.push(rule);
      }
    }
    return result;
  }
}
