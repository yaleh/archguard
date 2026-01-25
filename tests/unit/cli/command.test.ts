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
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      expect(analyzeCmd).toBeDefined();
      expect(analyzeCmd?.description()).toContain('Analyze');
    });

    it('should have --source option with default value', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const sourceOption = analyzeCmd?.options.find(opt => opt.long === '--source');

      expect(sourceOption).toBeDefined();
      expect(sourceOption?.short).toBe('-s');
      expect(sourceOption?.defaultValue).toBe('./src');
    });

    it('should have --output option', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const outputOption = analyzeCmd?.options.find(opt => opt.long === '--output');

      expect(outputOption).toBeDefined();
      expect(outputOption?.short).toBe('-o');
    });

    it('should have --format option with default plantuml', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const formatOption = analyzeCmd?.options.find(opt => opt.long === '--format');

      expect(formatOption).toBeDefined();
      expect(formatOption?.short).toBe('-f');
      expect(formatOption?.defaultValue).toBe('plantuml');
    });

    it('should have --exclude option', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const excludeOption = analyzeCmd?.options.find(opt => opt.long === '--exclude');

      expect(excludeOption).toBeDefined();
      expect(excludeOption?.short).toBe('-e');
    });

    it('should have --no-cache option', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const cacheOption = analyzeCmd?.options.find(opt => opt.long === '--no-cache');

      expect(cacheOption).toBeDefined();
    });

    it('should have --concurrency option', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const concurrencyOption = analyzeCmd?.options.find(opt => opt.long === '--concurrency');

      expect(concurrencyOption).toBeDefined();
      expect(concurrencyOption?.short).toBe('-c');
    });

    it('should have --verbose option', () => {
      const analyzeCmd = program.commands.find(cmd => cmd.name() === 'analyze');
      const verboseOption = analyzeCmd?.options.find(opt => opt.long === '--verbose');

      expect(verboseOption).toBeDefined();
      expect(verboseOption?.short).toBe('-v');
    });
  });

  describe('Command Parsing', () => {
    it('should parse source directory option', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      // Suppress process.exit during tests
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      // Replace the action handler with mock
      const analyzeCmd = testProgram.commands.find(cmd => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze', '-s', './custom-src'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toMatchObject({ source: './custom-src' });

      exitSpy.mockRestore();
    });

    it('should parse output file option', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const analyzeCmd = testProgram.commands.find(cmd => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze', '-o', 'output.puml'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toMatchObject({ output: 'output.puml' });

      exitSpy.mockRestore();
    });

    it('should parse format option', async () => {
      const mockAction = vi.fn();
      const testProgram = createCLI();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const analyzeCmd = testProgram.commands.find(cmd => cmd.name() === 'analyze');
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

      const analyzeCmd = testProgram.commands.find(cmd => cmd.name() === 'analyze');
      if (analyzeCmd) {
        analyzeCmd.action(mockAction);
      }

      await testProgram.parseAsync(['analyze'], { from: 'user' });

      expect(mockAction).toHaveBeenCalled();
      const callArgs = mockAction.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[0]).toMatchObject({
        source: './src',
        format: 'plantuml'
      });

      exitSpy.mockRestore();
    });
  });
});
