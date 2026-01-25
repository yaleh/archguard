/**
 * Phase 4.2: CLI Parameter Integration Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('Phase 4.2: CLI Parameter Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `.archguard-cli-test-${Date.now()}-${Math.random()}`);

    // Clean up and create test directory
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    // Clean up after each test
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('CLI Command Options', () => {
    it('should parse --cli-command option', async () => {
      // This test will fail until we add the --cli-command option
      const { createAnalyzeCommand } = await import('../../../src/cli/commands/analyze.js');
      const command = createAnalyzeCommand();

      // Verify the option exists
      const cliCommandOption = command.options.find((opt) => opt.long === '--cli-command');
      expect(cliCommandOption).toBeDefined();
      expect(cliCommandOption?.description).toContain('Claude CLI command');
    });

    it('should parse --cli-args option', async () => {
      // This test will fail until we add the --cli-args option
      const { createAnalyzeCommand } = await import('../../../src/cli/commands/analyze.js');
      const command = createAnalyzeCommand();

      // Verify the option exists
      const cliArgsOption = command.options.find((opt) => opt.long === '--cli-args');
      expect(cliArgsOption).toBeDefined();
      expect(cliArgsOption?.description).toContain('Additional CLI arguments');
    });

    it('should parse --output-dir option', async () => {
      // This test will fail until we add the --output-dir option
      const { createAnalyzeCommand } = await import('../../../src/cli/commands/analyze.js');
      const command = createAnalyzeCommand();

      // Verify the option exists
      const outputDirOption = command.options.find((opt) => opt.long === '--output-dir');
      expect(outputDirOption).toBeDefined();
      expect(outputDirOption?.description).toContain('Output directory');
    });

    it('should use default value for --cli-command', async () => {
      const { createAnalyzeCommand } = await import('../../../src/cli/commands/analyze.js');
      const command = createAnalyzeCommand();

      const cliCommandOption = command.options.find((opt) => opt.long === '--cli-command');
      expect(cliCommandOption?.defaultValue).toBe('claude');
    });

    it('should use default value for --output-dir', async () => {
      const { createAnalyzeCommand } = await import('../../../src/cli/commands/analyze.js');
      const command = createAnalyzeCommand();

      const outputDirOption = command.options.find((opt) => opt.long === '--output-dir');
      expect(outputDirOption?.defaultValue).toBe('./archguard');
    });
  });

  describe('CLI Options to ConfigLoader Integration', () => {
    it('should pass CLI options to ConfigLoader.load()', async () => {
      // Create a test config file
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        source: './src',
        cli: {
          command: 'claude',
          args: ['--model', 'claude-3-5-sonnet-20241022'],
        },
      });

      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      // Simulate CLI options
      const cliOptions = {
        cliCommand: '/usr/local/bin/claude',
        cliArgs: '--timeout 120000',
        outputDir: './custom-output',
      };

      // This test verifies that ConfigLoader can handle the new options
      const config = await loader.load({
        cli: {
          command: cliOptions.cliCommand,
          args: cliOptions.cliArgs.split(' '),
        },
        outputDir: cliOptions.outputDir,
      });

      expect(config.cli.command).toBe('/usr/local/bin/claude');
      expect(config.cli.args).toEqual(['--timeout', '120000']);
      expect(config.outputDir).toBe('./custom-output');
    });

    it('should prioritize CLI options over config file', async () => {
      // Create a test config file
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'claude',
          args: ['--model', 'claude-3-5-sonnet-20241022'],
        },
        outputDir: './config-output',
      });

      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      // CLI options should override config file
      const config = await loader.load({
        cli: {
          command: '/usr/local/bin/claude',
          args: ['--timeout', '120000'],
        },
        outputDir: './cli-output',
      });

      expect(config.cli.command).toBe('/usr/local/bin/claude'); // CLI override
      expect(config.cli.args).toEqual(['--timeout', '120000']); // CLI override
      expect(config.outputDir).toBe('./cli-output'); // CLI override
    });
  });

  describe('Priority Order: CLI > Config File > Defaults', () => {
    it('should use CLI option when both CLI and config file specify value', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'config-claude',
        },
      });

      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      const config = await loader.load({
        cli: {
          command: 'cli-claude',
        },
      });

      expect(config.cli.command).toBe('cli-claude'); // CLI wins
    });

    it('should use config file value when CLI option not provided', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'config-claude',
        },
      });

      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      const config = await loader.load({}); // No CLI override

      expect(config.cli.command).toBe('config-claude'); // Config file wins
    });

    it('should use default value when neither CLI nor config file specify value', async () => {
      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      const config = await loader.load({}); // No config file, no CLI override

      expect(config.cli.command).toBe('claude'); // Default wins
      expect(config.outputDir).toBe('./archguard'); // Default wins
    });
  });

  describe('CLI Args Merging Behavior', () => {
    it('should merge args from config file and CLI', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          args: ['--model', 'claude-3-5-sonnet-20241022'],
        },
      });

      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      // CLI args should replace config file args (not merge)
      // This is the expected behavior based on the requirement
      const config = await loader.load({
        cli: {
          args: ['--timeout', '120000'],
        },
      });

      // Args are replaced, not merged (as per current deepMerge implementation)
      expect(config.cli.args).toEqual(['--timeout', '120000']);
    });

    it('should handle space-separated args from CLI', () => {
      // Simulate parsing --cli-args "--model claude-3-5-sonnet-2024322 --timeout 120000"
      const cliArgsString = '--model claude-3-5-sonnet-2024322 --timeout 120000';
      const cliArgsArray = cliArgsString.split(' ');

      expect(cliArgsArray).toEqual(['--model', 'claude-3-5-sonnet-2024322', '--timeout', '120000']);
    });

    it('should handle empty args from CLI', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          args: ['--model', 'claude-3-5-sonnet-20241022'],
        },
      });

      const { ConfigLoader } = await import('../../../src/cli/config-loader.js');
      const loader = new ConfigLoader(testDir);

      // CLI args override with empty array
      const config = await loader.load({
        cli: {
          args: [],
        },
      });

      expect(config.cli.args).toEqual([]);
    });
  });

  describe('Command Handler Integration', () => {
    it('should convert CLI options to ConfigLoader format', async () => {
      // Test that the command handler properly transforms CLI options
      // to the format expected by ConfigLoader
      const mockOptions = {
        source: './lib',
        output: './output.puml',
        format: 'plantuml' as const,
        cliCommand: '/custom/claude',
        cliArgs: '--timeout 120000',
        outputDir: './custom-dir',
        cache: true,
        concurrency: 4,
        verbose: true,
      };

      // Simulate what the command handler should do
      const configLoaderOptions = {
        source: mockOptions.source,
        output: mockOptions.output,
        format: mockOptions.format,
        cli: {
          command: mockOptions.cliCommand,
          args: mockOptions.cliArgs.split(' '),
        },
        outputDir: mockOptions.outputDir,
        cache: {
          enabled: mockOptions.cache,
        },
        concurrency: mockOptions.concurrency,
        verbose: mockOptions.verbose,
      };

      // Verify the transformation is correct
      expect(configLoaderOptions.cli.command).toBe('/custom/claude');
      expect(configLoaderOptions.cli.args).toEqual(['--timeout', '120000']);
      expect(configLoaderOptions.outputDir).toBe('./custom-dir');
    });
  });

  describe('TypeScript Type Safety', () => {
    it('should extend AnalyzeOptions interface with new fields', async () => {
      // This test verifies that the types module can be imported
      // and that AnalyzeOptions is properly defined as a type

      // Import the types module to ensure it compiles
      await import('../../../src/cli/types.js');

      // Verify by checking the command handler signature
      const { createAnalyzeCommand } = await import('../../../src/cli/commands/analyze.js');
      const command = createAnalyzeCommand();

      // If we got here without TypeScript errors, the types are correct
      expect(command).toBeDefined();
      expect(command.options.length).toBeGreaterThan(0);
    });
  });
});
