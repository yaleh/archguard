/**
 * Integration test for custom config file paths and config-loading contract
 * (TASK-74, A 类第二批 — config 语义 E2E 稳定化).
 *
 * Covers the user-facing `archguard.config.json` contract through ConfigLoader:
 *   1. Custom config path loading (relative / absolute / .js / precedence over default)
 *   2. Documented field defaults when no config file exists
 *   3. CLI-overrides-config override semantics (nested merge, array replacement)
 *   4. Invalid-config error messages (exit-path contract at the loader level)
 *
 * Contract basis (from src/cli/config-loader.ts, read-only audit — no
 * implementation changes; test assertions only):
 *  - load(): configSchema.parse() applies schema defaults, then
 *    resolveDirectoryDefaults() derives outputDir / cache.dir from workDir
 *    (config-loader.ts:355-375, 397-412).
 *  - Zod schema defaults: workDir './.archguard', format 'mermaid',
 *    mermaid {renderer:'isomorphic', theme:'default', transparentBackground:false},
 *    exclude [test/spec globs under node_modules-glob defaults] (see source),
 *    cli {command:'claude', args:[], timeout:60000},
 *    cache {enabled:true, ttl:86400}, concurrency os.cpus().length,
 *    verbose false, diagrams [] (config-loader.ts:141-275).
 *  - deepMerge(): nested objects merged recursively; arrays replaced (not
 *    merged); source values override target values (config-loader.ts:420-448).
 *  - Zod failure formatting: "Configuration validation failed:" followed by one
 *    "  - <field.path>: <issue.message>" line per issue (config-loader.ts:361-374).
 *  - loadFromFile(): a provided-but-missing custom path throws
 *    "Config file not found: <path>" (config-loader.ts:463-480).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('Custom Config Path Integration', () => {
  const testDir = path.join(os.tmpdir(), '.archguard-custom-config-test');

  beforeEach(async () => {
    // Clean up and create test directory
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    // Clean up after tests
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  it('should load custom config with multiple diagrams', async () => {
    // Create a custom config similar to archguard.test-v2.config.json
    const customConfigPath = path.join(testDir, 'my-custom.config.json');
    await fs.writeJson(customConfigPath, {
      outputDir: './custom-output',
      format: 'mermaid',
      diagrams: [
        {
          name: 'overview',
          sources: ['./src/cli', './src/parser'],
          level: 'package',
          description: 'High-level overview',
        },
        {
          name: 'detailed',
          sources: ['./src/cli'],
          level: 'class',
          description: 'Detailed class view',
        },
      ],
    });

    // Load config from custom path
    const loader = new ConfigLoader(testDir);
    const config = await loader.load({}, customConfigPath);

    // Verify the config is loaded correctly
    expect(config.diagrams).toHaveLength(2);
    expect(config.diagrams[0].name).toBe('overview');
    expect(config.diagrams[0].level).toBe('package');
    expect(config.diagrams[1].name).toBe('detailed');
    expect(config.diagrams[1].level).toBe('class');
    expect(config.outputDir).toBe('./custom-output');
  });

  it('should support relative paths for custom config', async () => {
    const customConfigPath = path.join(testDir, 'configs', 'project.config.json');
    await fs.ensureDir(path.join(testDir, 'configs'));
    await fs.writeJson(customConfigPath, {
      diagrams: [
        {
          name: 'architecture',
          sources: ['./src'],
          level: 'class',
        },
      ],
      format: 'json',
    });

    const loader = new ConfigLoader(testDir);
    const relativePath = path.relative(process.cwd(), customConfigPath);
    const config = await loader.load({}, relativePath);

    expect(config.diagrams).toHaveLength(1);
    expect(config.format).toBe('json');
  });

  it('should support absolute paths for custom config', async () => {
    const customConfigPath = path.join(testDir, 'absolute.config.json');
    await fs.writeJson(customConfigPath, {
      diagrams: [
        {
          name: 'test-diagram',
          sources: ['./test'],
          level: 'method',
        },
      ],
    });

    const loader = new ConfigLoader(testDir);
    const absolutePath = path.resolve(customConfigPath);
    const config = await loader.load({}, absolutePath);

    expect(config.diagrams).toHaveLength(1);
    expect(config.diagrams[0].level).toBe('method');
  });

  it('should override custom config with CLI options', async () => {
    const customConfigPath = path.join(testDir, 'base.config.json');
    await fs.writeJson(customConfigPath, {
      diagrams: [
        {
          name: 'base-diagram',
          sources: ['./src'],
          level: 'class',
        },
      ],
      format: 'json',
      outputDir: './base-output',
    });

    const loader = new ConfigLoader(testDir);
    const config = await loader.load(
      {
        format: 'mermaid',
        outputDir: './override-output',
      },
      customConfigPath
    );

    // CLI options should override config file
    expect(config.format).toBe('mermaid');
    expect(config.outputDir).toBe('./override-output');
    // But diagrams should come from config file
    expect(config.diagrams[0].name).toBe('base-diagram');
  });

  it('should throw clear error for non-existent custom config', async () => {
    const loader = new ConfigLoader(testDir);
    const nonExistentPath = path.join(testDir, 'does-not-exist.config.json');

    await expect(loader.load({}, nonExistentPath)).rejects.toThrow(
      'Config file not found: ' + nonExistentPath
    );
  });

  it('should support .js config files with custom path', async () => {
    const customConfigPath = path.join(testDir, 'dynamic.config.js');
    const jsContent = `export default {
  diagrams: [
    {
      name: 'js-diagram',
      sources: ['./src'],
      level: 'package',
    },
  ],
  format: 'mermaid',
};
`;
    await fs.writeFile(customConfigPath, jsContent);

    const loader = new ConfigLoader(testDir);
    const config = await loader.load({}, customConfigPath);

    expect(config.diagrams).toHaveLength(1);
    expect(config.diagrams[0].name).toBe('js-diagram');
    expect(config.format).toBe('mermaid');
  });

  it('should ignore default config when custom path is provided', async () => {
    // Create default config
    const defaultConfigPath = path.join(testDir, 'archguard.config.json');
    await fs.writeJson(defaultConfigPath, {
      diagrams: [
        {
          name: 'default-diagram',
          sources: ['./default'],
          level: 'class',
        },
      ],
    });

    // Create custom config
    const customConfigPath = path.join(testDir, 'custom.config.json');
    await fs.writeJson(customConfigPath, {
      diagrams: [
        {
          name: 'custom-diagram',
          sources: ['./custom'],
          level: 'package',
        },
      ],
    });

    // Load with custom path
    const loader = new ConfigLoader(testDir);
    const config = await loader.load({}, customConfigPath);

    // Should load custom, not default
    expect(config.diagrams[0].name).toBe('custom-diagram');
    expect(config.diagrams[0].sources).toEqual(['./custom']);
  });
});

describe('Config defaults (no config file)', () => {
  const testDir = path.join(os.tmpdir(), '.archguard-config-defaults-test');

  beforeEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  it('applies documented field defaults when no config file exists', async () => {
    // No archguard.config.{json,js} in testDir → load() falls back to empty
    // file config and Zod applies every schema default (config-loader.ts:141-275).
    const loader = new ConfigLoader(testDir);
    const config = await loader.load({});

    expect(config.workDir).toBe('./.archguard');
    expect(config.format).toBe('mermaid');
    expect(config.mermaid).toEqual({
      renderer: 'isomorphic',
      theme: 'default',
      transparentBackground: false,
    });
    expect(config.exclude).toEqual(['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']);
    expect(config.cli).toEqual({ command: 'claude', args: [], timeout: 60000 });
    expect(config.verbose).toBe(false);
    expect(config.diagrams).toEqual([]);
    expect(config.concurrency).toBe(os.cpus().length);
  });

  it('derives outputDir and cache.dir from workDir when not specified', async () => {
    // resolveDirectoryDefaults(): outputDir = workDir/output, cache.dir =
    // workDir/cache when neither is set explicitly (config-loader.ts:397-412).
    const loader = new ConfigLoader(testDir);
    const config = await loader.load({ workDir: './custom-work' });

    expect(config.outputDir).toBe(path.join('custom-work', 'output'));
    expect(config.cache?.dir).toBe(path.join('custom-work', 'cache'));
    // Remaining cache defaults still apply.
    expect(config.cache?.enabled).toBe(true);
    expect(config.cache?.ttl).toBe(86400);
  });

  it('loads the default archguard.config.json from the config dir', async () => {
    // Default search: <configDir>/archguard.config.json before .js
    // (config-loader.ts:482-501).
    await fs.writeJson(path.join(testDir, 'archguard.config.json'), {
      format: 'json',
      verbose: true,
      diagrams: [{ name: 'from-default', sources: ['./src'], level: 'class' }],
    });

    const config = await new ConfigLoader(testDir).load({});

    expect(config.format).toBe('json');
    expect(config.verbose).toBe(true);
    expect(config.diagrams).toHaveLength(1);
    expect(config.diagrams[0].name).toBe('from-default');
  });
});

describe('Config override semantics (deepMerge)', () => {
  const testDir = path.join(os.tmpdir(), '.archguard-config-override-test');

  beforeEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  it('merges nested mermaid objects recursively (CLI field wins, sibling kept)', async () => {
    // deepMerge(): nested objects are merged recursively; source (CLI) values
    // override target (file) values (config-loader.ts:420-448).
    const configPath = path.join(testDir, 'base.config.json');
    await fs.writeJson(configPath, {
      mermaid: { theme: 'forest', renderer: 'cli' },
    });

    const config = await new ConfigLoader(testDir).load({ mermaid: { theme: 'dark' } }, configPath);

    expect(config.mermaid?.theme).toBe('dark');
    expect(config.mermaid?.renderer).toBe('cli'); // sibling preserved
  });

  it('replaces arrays instead of merging them', async () => {
    // deepMerge(): arrays are replaced, not concatenated (config-loader.ts:420-448).
    const configPath = path.join(testDir, 'base.config.json');
    await fs.writeJson(configPath, {
      exclude: ['**/fixture/**', '**/vendor/**'],
      diagrams: [{ name: 'from-file', sources: ['./src'], level: 'class' }],
    });

    const config = await new ConfigLoader(testDir).load(
      {
        exclude: ['**/*.test.ts'],
        diagrams: [{ name: 'from-cli', sources: ['./lib'], level: 'package' }],
      },
      configPath
    );

    // CLI arrays fully replace file arrays — no merging.
    expect(config.exclude).toEqual(['**/*.test.ts']);
    expect(config.diagrams).toEqual([{ name: 'from-cli', sources: ['./lib'], level: 'package' }]);
  });

  it('preserves file fields not touched by CLI overrides', async () => {
    const configPath = path.join(testDir, 'base.config.json');
    await fs.writeJson(configPath, {
      verbose: true,
      cli: { command: 'claude', args: [], timeout: 30000 },
    });

    const config = await new ConfigLoader(testDir).load({ format: 'json' }, configPath);

    // The override only touches format; verbose and cli come from the file.
    expect(config.format).toBe('json');
    expect(config.verbose).toBe(true);
    expect(config.cli?.timeout).toBe(30000);
  });
});

describe('Config validation errors (invalid config)', () => {
  const testDir = path.join(os.tmpdir(), '.archguard-config-invalid-test');

  beforeEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  it('rejects an invalid format enum with the field-path error message', async () => {
    // Zod failure formatting: "Configuration validation failed:" then a
    // "  - <field.path>: <issue.message>" line (config-loader.ts:361-374).
    const loader = new ConfigLoader(testDir);

    await expect(loader.load({ format: 'plantuml' as never })).rejects.toThrow(
      'Configuration validation failed:'
    );
    await expect(loader.load({ format: 'plantuml' as never })).rejects.toThrow(
      / {2}- format: Invalid option: expected one of "mermaid"\|"json"/
    );
  });

  it('rejects an invalid diagram level with a dotted field path', async () => {
    const loader = new ConfigLoader(testDir);

    await expect(
      loader.load({
        diagrams: [{ name: 'x', sources: ['./src'], level: 'bogus' as never }],
      })
    ).rejects.toThrow('Configuration validation failed:');
    await expect(
      loader.load({
        diagrams: [{ name: 'x', sources: ['./src'], level: 'bogus' as never }],
      })
    ).rejects.toThrow(
      / {2}- diagrams\.0\.level: Invalid option: expected one of "package"\|"class"\|"method"/
    );
  });

  it('rejects an invalid field type (concurrency as string)', async () => {
    const loader = new ConfigLoader(testDir);

    await expect(loader.load({ concurrency: 'abc' as never })).rejects.toThrow(
      'Configuration validation failed:'
    );
    await expect(loader.load({ concurrency: 'abc' as never })).rejects.toThrow(
      / {2}- concurrency: Invalid input: expected number, received string/
    );
  });

  it('surfaces validation errors from an invalid config file via custom path', async () => {
    // Same validation formatting applies when the bad value comes from a file
    // loaded through a custom path, not just from CLI options.
    const configPath = path.join(testDir, 'bad.config.json');
    await fs.writeJson(configPath, { format: 'plantuml' });

    await expect(new ConfigLoader(testDir).load({}, configPath)).rejects.toThrow(
      'Configuration validation failed:'
    );
    await expect(new ConfigLoader(testDir).load({}, configPath)).rejects.toThrow(
      / {2}- format: Invalid option: expected one of "mermaid"\|"json"/
    );
  });
});
