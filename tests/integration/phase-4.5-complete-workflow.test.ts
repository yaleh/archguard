/**
 * Phase 4.5: Integration Tests for Complete Workflow
 *
 * Tests the complete flow from CLI options → ConfigLoader → ClaudeClient → Output
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import { ClaudeClient } from '@/mermaid/llm/claude-client';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execa } from 'execa';

// Mock execa for CLI execution
vi.mock('execa');
const mockedExeca = vi.mocked(execa);

describe('Phase 4.5: Integration Tests - Complete Workflow', () => {
  const testDir = path.join(os.tmpdir(), '.archguard-integration-test');
  let configLoader: ConfigLoader;

  beforeEach(async () => {
    configLoader = new ConfigLoader(testDir);
    // Clean up before each test
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
    vi.clearAllMocks();
  });

  describe('CLI Options → ConfigLoader → ClaudeClient Flow', () => {
    it('should flow CLI options through to ClaudeClient configuration', async () => {
      // Step 1: Create config with CLI settings
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: '/custom/claude',
          args: ['--model', 'claude-opus-4-20250514'],
          timeout: 120000,
        },
      });

      // Step 2: Load configuration
      const config = await configLoader.load();

      // Step 3: Create ClaudeClient with config
      const wrapper = new ClaudeClient(config);

      // Step 4: Verify wrapper has correct CLI configuration
      expect(wrapper.internalConfig.cliCommand).toBe('/custom/claude');
      expect(wrapper.internalConfig.cliArgs).toEqual(['--model', 'claude-opus-4-20250514']);
      expect(wrapper.internalConfig.timeout).toBe(120000);
    });

    it('should merge CLI options with file config correctly', async () => {
      // Step 1: Create base config file
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'claude',
          args: ['--model', 'claude-sonnet-4-20250514'],
          timeout: 60000,
        },
      });

      // Step 2: Override with CLI options
      const config = await configLoader.load({
        cli: {
          timeout: 120000,
        },
      });

      // Step 3: Verify merge worked correctly
      expect(config.cli.command).toBe('claude'); // From file
      expect(config.cli.args).toEqual(['--model', 'claude-sonnet-4-20250514']); // From file
      expect(config.cli.timeout).toBe(120000); // From CLI override
    });

    it('should handle complete workflow with all components', async () => {
      // Step 1: Create comprehensive config
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        source: './src',
        outputDir: './output/diagrams',
        cli: {
          command: 'claude',
          args: ['--model', 'claude-opus-4-20250514'],
          timeout: 120000,
        },
      });

      // Step 2: Load configuration
      const config = await configLoader.load();

      // Step 3: Create OutputPathResolver
      const pathResolver = new OutputPathResolver(config);

      // Step 4: Create ClaudeClient
      const wrapper = new ClaudeClient(config);

      // Step 5: Verify all components are configured correctly
      expect(config.outputDir).toBe('./output/diagrams');
      expect(wrapper.internalConfig.cliCommand).toBe('claude');
      expect(wrapper.internalConfig.cliArgs).toEqual(['--model', 'claude-opus-4-20250514']);
      expect(wrapper.internalConfig.timeout).toBe(120000);

      // Step 6: Verify path resolution
      const paths = pathResolver.resolve({});
      expect(paths.outputDir).toContain('output/diagrams');
    });
  });

  describe('Output Path Resolution from CLI to File Generation', () => {
    it('should resolve paths from CLI options', async () => {
      // Load config with CLI outputDir override
      const config = await configLoader.load({
        outputDir: './custom/output',
      });

      const pathResolver = new OutputPathResolver(config);
      const paths = pathResolver.resolve({});

      expect(paths.outputDir).toContain('custom/output');
    });

    it('should resolve paths from config file', async () => {
      // Create config with outputDir
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        outputDir: './diagrams',
      });

      const config = await configLoader.load();
      const pathResolver = new OutputPathResolver(config);
      const paths = pathResolver.resolve({});

      expect(paths.outputDir).toContain('diagrams');
    });

    it('should prioritize CLI outputDir over config file', async () => {
      // Create config with outputDir
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        outputDir: './config-output',
      });

      // Override with CLI
      const config = await configLoader.load({
        outputDir: './cli-output',
      });

      const pathResolver = new OutputPathResolver(config);
      const paths = pathResolver.resolve({});

      expect(paths.outputDir).toContain('cli-output');
      expect(paths.outputDir).not.toContain('config-output');
    });

    it('should create output directory if it does not exist', async () => {
      const customOutputDir = path.join(testDir, 'nonexistent', 'output');

      const config = await configLoader.load({
        outputDir: customOutputDir,
      });

      const pathResolver = new OutputPathResolver(config);

      // Directory should not exist yet
      expect(await fs.pathExists(customOutputDir)).toBe(false);

      // Ensure directory
      await pathResolver.ensureDirectory();

      // Directory should now exist
      expect(await fs.pathExists(customOutputDir)).toBe(true);
    });

    it('should resolve all output paths correctly', async () => {
      const config = await configLoader.load({
        outputDir: './diagrams',
      });

      const pathResolver = new OutputPathResolver(config);
      const paths = pathResolver.resolve({});

      // Verify all path types are resolved
      expect(paths.paths).toBeDefined();
      expect(paths.paths.mmd).toBeDefined();
      expect(paths.paths.png).toBeDefined();
      expect(paths.paths.svg).toBeDefined();

      // Verify paths use outputDir
      expect(paths.paths.png).toContain('diagrams');
      expect(paths.paths.mmd).toContain('diagrams');
    });
  });

  describe('v2.0 Configuration Scenarios', () => {
    it('should load CLI configuration from config file', async () => {
      // Create v2.0 config
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        cli: {
          model: 'claude-sonnet-4-20250514',
          timeout: 120000,
        },
      });

      // Load config
      const config = await configLoader.load();

      // Verify config loaded
      expect(config.diagrams).toHaveLength(1);
      expect(config.cli.timeout).toBe(120000);
    });

    it('should work with ClaudeClient with v2.0 config', async () => {
      // Create v2.0 config
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        cli: {
          command: 'claude',
          args: ['--model', 'claude-opus-4-20250514'],
          timeout: 90000,
        },
      });

      // Load config
      const config = await configLoader.load();

      // Create wrapper
      const wrapper = new ClaudeClient(config);

      // Verify wrapper receives config
      expect(wrapper.internalConfig.cliArgs).toEqual(['--model', 'claude-opus-4-20250514']);
      expect(wrapper.internalConfig.timeout).toBe(90000);
    });

    it('should validate diagrams array in config', async () => {
      // Create config with multiple diagrams
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          { name: 'overview', sources: ['./src'], level: 'package' },
          { name: 'modules/cli', sources: ['./src/cli'], level: 'class' },
        ],
        cli: {
          command: 'claude',
          args: ['--custom-arg'],
          timeout: 60000,
        },
      });

      // Load config
      const config = await configLoader.load();

      // Verify diagrams
      expect(config.diagrams).toHaveLength(2);
      expect(config.diagrams[0].level).toBe('package');
      expect(config.diagrams[1].level).toBe('class');
      expect(config.cli.args).toEqual(['--custom-arg']);
      expect(config.cli.command).toBe('claude');
      expect(config.cli.timeout).toBe(60000);
    });
  });

  describe('End-to-End Workflow Tests', () => {
    it('should handle complete analysis workflow with custom CLI', async () => {
      // This test verifies the configuration flow without actually running CLI

      // Step 1: Create comprehensive config
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        outputDir: './test-output',
        cli: {
          command: '/usr/bin/claude',
          args: ['--model', 'claude-opus-4-20250514', '--verbose'],
          timeout: 120000,
        },
        format: 'mermaid',
        cache: {
          enabled: false,
        },
      });

      // Step 2: Load configuration
      const config = await configLoader.load();

      // Step 3: Initialize all components
      const pathResolver = new OutputPathResolver(config);
      const wrapper = new ClaudeClient(config);

      // Step 4: Verify component configuration
      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('overview');
      expect(config.outputDir).toBe('./test-output');
      expect(config.format).toBe('mermaid');
      expect(config.cache.enabled).toBe(false);

      expect(wrapper.internalConfig.cliCommand).toBe('/usr/bin/claude');
      expect(wrapper.internalConfig.cliArgs).toEqual([
        '--model',
        'claude-opus-4-20250514',
        '--verbose',
      ]);
      expect(wrapper.internalConfig.timeout).toBe(120000);

      // Step 5: Verify path setup
      const paths = pathResolver.resolve({});
      expect(paths.outputDir).toContain('test-output');
    });

    it('should handle CLI option overrides correctly', async () => {
      // Create base config
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        cli: {
          command: 'claude',
          args: ['--model', 'claude-sonnet-4-20250514'],
          timeout: 60000,
        },
        outputDir: './default-output',
      });

      // Simulate CLI option overrides
      const config = await configLoader.load({
        cli: {
          command: '/usr/local/bin/claude',
          timeout: 120000,
        },
        outputDir: './cli-output',
      });

      // Create components
      const pathResolver = new OutputPathResolver(config);
      const wrapper = new ClaudeClient(config);

      // Verify CLI overrides took effect
      expect(wrapper.internalConfig.cliCommand).toBe('/usr/local/bin/claude'); // CLI override
      expect(wrapper.internalConfig.cliArgs).toEqual(['--model', 'claude-sonnet-4-20250514']); // From file
      expect(wrapper.internalConfig.timeout).toBe(120000); // CLI override

      expect(pathResolver.resolve({}).outputDir).toContain('cli-output'); // CLI override
    });

    it('should validate complete workflow with default values', async () => {
      // Load config without any file or CLI options (pure defaults)
      const config = await configLoader.load();

      // Create components
      const pathResolver = new OutputPathResolver(config);
      const wrapper = new ClaudeClient(config);

      // Verify all defaults are applied
      expect(config.cli.command).toBe('claude');
      expect(config.cli.args).toEqual([]);
      expect(config.cli.timeout).toBe(60000);
      expect(config.outputDir).toBe('./archguard');
      expect(config.diagrams).toEqual([]);
      expect(config.format).toBe('mermaid');
      expect(config.cache.enabled).toBe(true);

      expect(wrapper.internalConfig.cliCommand).toBe('claude');
      expect(wrapper.internalConfig.cliArgs).toEqual([]);
      expect(wrapper.internalConfig.timeout).toBe(60000);

      const paths = pathResolver.resolve({});
      expect(paths.outputDir).toContain('archguard');
    });
  });

  describe('Error Handling and Validation', () => {
    it('should validate CLI configuration', async () => {
      // Create config with invalid CLI timeout (negative)
      const configPath = path.join(testDir, 'archguard.config.json');

      // Note: Current schema allows any number for timeout
      // This test documents current behavior
      await fs.writeJson(configPath, {
        cli: {
          timeout: -1000,
        },
      });

      // Config should load (schema allows it)
      const config = await configLoader.load();
      expect(config.cli.timeout).toBe(-1000);
    });

    it('should handle missing CLI configuration gracefully', async () => {
      // Create config without cli section
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
      });

      // Load config - should use defaults
      const config = await configLoader.load();

      // Verify defaults applied
      expect(config.cli.command).toBe('claude');
      expect(config.cli.args).toEqual([]);
      expect(config.cli.timeout).toBe(60000);
    });

    it('should validate outputDir path resolution', async () => {
      // Test with various outputDir values
      const testCases = [
        './relative/path',
        '/absolute/path',
        '.',
        '..',
        './path/with/../../segments',
      ];

      for (const outputDir of testCases) {
        const config = await configLoader.load({ outputDir });
        const pathResolver = new OutputPathResolver(config);

        // Should not throw
        expect(() => pathResolver.resolve({})).not.toThrow();
      }
    });
  });

  describe('Configuration Priority Tests', () => {
    it('should respect priority: CLI > config file > defaults', async () => {
      // Create config file
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'config-cli',
          timeout: 30000,
        },
        outputDir: './config-output',
      });

      // Load with CLI overrides
      const config = await configLoader.load({
        cli: {
          timeout: 90000,
        },
        outputDir: './cli-output',
      });

      // Verify priority
      expect(config.cli.command).toBe('config-cli'); // From config file
      expect(config.cli.timeout).toBe(90000); // CLI override
      expect(config.outputDir).toBe('./cli-output'); // CLI override
    });

    it('should handle deep merge correctly for nested objects', async () => {
      // Create config with nested cli settings
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'claude',
          args: ['--model', 'claude-sonnet-4-20250514'],
          timeout: 60000,
        },
      });

      // Override only timeout via CLI
      const config = await configLoader.load({
        cli: {
          timeout: 120000,
        },
      });

      // Verify deep merge
      expect(config.cli.command).toBe('claude'); // Preserved from file
      expect(config.cli.args).toEqual(['--model', 'claude-sonnet-4-20250514']); // Preserved from file
      expect(config.cli.timeout).toBe(120000); // Overridden by CLI
    });
  });
});
