/**
 * Integration test for custom config file paths
 * Tests the --config CLI option functionality
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
      format: 'plantuml',
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
        format: 'plantuml',
        outputDir: './override-output',
      },
      customConfigPath
    );

    // CLI options should override config file
    expect(config.format).toBe('plantuml');
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
  format: 'svg',
};
`;
    await fs.writeFile(customConfigPath, jsContent);

    const loader = new ConfigLoader(testDir);
    const config = await loader.load({}, customConfigPath);

    expect(config.diagrams).toHaveLength(1);
    expect(config.diagrams[0].name).toBe('js-diagram');
    expect(config.format).toBe('svg');
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
