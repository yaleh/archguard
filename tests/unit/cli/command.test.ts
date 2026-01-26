/**
 * Story 1: Basic CLI Framework Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { createCLI } from '@/cli/index';

describe('Story 1: Basic CLI Framework', () => {
  let program: Command;

  beforeEach(() => {
    // Reset program before each test
    program = createCLI();
  });

  describe('CLI Program', () => {
    it('should create a CLI program with name "archguard"', () => {
      expect(program.name()).toBe('archguard');
    });

    it('should have a version number', () => {
      const version = program.version();
      expect(version).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should have a description', () => {
      const description = program.description();
      expect(description).toBeTruthy();
      expect(description).toContain('ArchGuard');
    });
  });

  describe('Analyze Command', () => {
    it('should register analyze command', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      expect(analyzeCmd).toBeDefined();
      expect(analyzeCmd?.description()).toContain('Analyze');
    });

    it('should have --sources option (plural)', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const sourcesOption = analyzeCmd?.options.find((opt) => opt.long === '--sources');

      expect(sourcesOption).toBeDefined();
      expect(sourcesOption?.short).toBe('-s');
    });

    it('should have --level option with default value class', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const levelOption = analyzeCmd?.options.find((opt) => opt.long === '--level');

      expect(levelOption).toBeDefined();
      expect(levelOption?.short).toBe('-l');
      expect(levelOption?.defaultValue).toBe('class');
    });

    it('should have --name option with default value architecture', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const nameOption = analyzeCmd?.options.find((opt) => opt.long === '--name');

      expect(nameOption).toBeDefined();
      expect(nameOption?.short).toBe('-n');
      expect(nameOption?.defaultValue).toBe('architecture');
    });

    it('should have --format option', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const formatOption = analyzeCmd?.options.find((opt) => opt.long === '--format');

      expect(formatOption).toBeDefined();
      expect(formatOption?.short).toBe('-f');
      // Format default is set in config, not CLI
    });

    it('should have --exclude option', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const excludeOption = analyzeCmd?.options.find((opt) => opt.long === '--exclude');

      expect(excludeOption).toBeDefined();
      expect(excludeOption?.short).toBe('-e');
    });

    it('should have --no-cache option', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const cacheOption = analyzeCmd?.options.find((opt) => opt.long === '--no-cache');

      expect(cacheOption).toBeDefined();
    });

    it('should have --concurrency option', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const concurrencyOption = analyzeCmd?.options.find((opt) => opt.long === '--concurrency');

      expect(concurrencyOption).toBeDefined();
      expect(concurrencyOption?.short).toBe('-c');
    });

    it('should have --verbose option', () => {
      const analyzeCmd = program.commands.find((cmd) => cmd.name() === 'analyze');
      const verboseOption = analyzeCmd?.options.find((opt) => opt.long === '--verbose');

      expect(verboseOption).toBeDefined();
      expect(verboseOption?.short).toBe('-v');
    });
  });

  describe('Command Parsing', () => {
    it('should parse sources directory option (plural)', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      // Suppress process.exit during tests
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      // Replace the action handler with mock
      const analyzeCmd = testProgram.commands.find((cmd) => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze', '-s', './custom-src'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      // Sources is now returned as an array (plural)
      expect(callArgs[0]).toMatchObject({ sources: ['./custom-src'] });

      exitSpy.mockRestore();
    });

    it('should parse level option', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const analyzeCmd = testProgram.commands.find((cmd) => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze', '-l', 'package'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toMatchObject({ level: 'package' });

      exitSpy.mockRestore();
    });

    it('should parse name option', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const analyzeCmd = testProgram.commands.find((cmd) => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze', '-n', 'my-diagram'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toMatchObject({ name: 'my-diagram' });

      exitSpy.mockRestore();
    });

    it('should parse format option', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const analyzeCmd = testProgram.commands.find((cmd) => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze', '-f', 'json'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toMatchObject({ format: 'json' });

      exitSpy.mockRestore();
    });

    it('should use default values when options not specified', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const analyzeCmd = testProgram.commands.find((cmd) => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      // v2.0 defaults: level=class, name=architecture
      expect(callArgs[0]).toMatchObject({
        level: 'class',
        name: 'architecture',
      });

      exitSpy.mockRestore();
    });
  });
});
