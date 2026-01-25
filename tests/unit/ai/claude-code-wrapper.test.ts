/**
 * Tests for ClaudeCodeWrapper
 *
 * Phase 4.3: Config-based initialization and CLI execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeCodeWrapper } from '../../../src/ai/claude-code-wrapper.js';
import type { Config } from '../../../src/cli/config-loader.js';
import { execa } from 'execa';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('ClaudeCodeWrapper - Phase 4.3 (Config-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor with Config object', () => {
    it('should accept full Config object and extract cli settings', () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude',
          args: ['--model', 'claude-3-5-sonnet-20241022'],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);
      expect(wrapper.options.timeout).toBe(60000);
      expect(wrapper.options.maxRetries).toBe(2);
    });

    it('should use default cli.command when not specified', () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);
      expect(wrapper.options.timeout).toBe(60000);
    });

    it('should use custom cli.timeout from config', () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude-glm',
          args: [],
          timeout: 120000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);
      expect(wrapper.options.timeout).toBe(120000);
    });
  });

  describe('callCLI method with config', () => {
    it('should use config.cli.command when calling execa', async () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);

      // Mock execa to return success
      vi.mocked(execa).mockResolvedValue({
        stdout: '@startuml\nTest content\n@enduml',
        stderr: '',
        command: 'claude',
        escapedCommand: '',
        failed: false,
        isCanceled: false,
        killed: false,
        exitCode: 0,
        exitCodeName: 'SUCCESS',
      } as any);

      await wrapper.callCLI('test prompt');

      expect(execa).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should spread config.cli.args when calling execa', async () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude',
          args: ['--model', 'claude-3-5-sonnet-20241022', '--verbose'],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);

      // Mock execa to return success
      vi.mocked(execa).mockResolvedValue({
        stdout: '@startuml\nTest content\n@enduml',
        stderr: '',
        command: 'claude',
        escapedCommand: '',
        failed: false,
        isCanceled: false,
        killed: false,
        exitCode: 0,
        exitCodeName: 'SUCCESS',
      } as any);

      await wrapper.callCLI('test prompt');

      expect(execa).toHaveBeenCalledWith(
        'claude',
        ['--model', 'claude-3-5-sonnet-20241022', '--verbose'],
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should use config.cli.timeout for execa timeout setting', async () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude-glm',
          args: [],
          timeout: 90000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);

      // Mock execa to return success
      vi.mocked(execa).mockResolvedValue({
        stdout: '@startuml\nTest content\n@enduml',
        stderr: '',
        command: 'claude-glm',
        escapedCommand: '',
        failed: false,
        isCanceled: false,
        killed: false,
        exitCode: 0,
        exitCodeName: 'SUCCESS',
      } as any);

      await wrapper.callCLI('test prompt');

      expect(execa).toHaveBeenCalledWith(
        'claude-glm',
        [],
        expect.objectContaining({
          timeout: 90000,
        })
      );
    });
  });

  describe('CLI command variants', () => {
    it('should work with full path to claude command', async () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: '/usr/local/bin/claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);

      vi.mocked(execa).mockResolvedValue({
        stdout: '@startuml\nTest content\n@enduml',
        stderr: '',
        command: '/usr/local/bin/claude',
        escapedCommand: '',
        failed: false,
        isCanceled: false,
        killed: false,
        exitCode: 0,
        exitCodeName: 'SUCCESS',
      } as any);

      await wrapper.callCLI('test prompt');

      expect(execa).toHaveBeenCalledWith('/usr/local/bin/claude', [], expect.any(Object));
    });

    it('should work with claude-glm command', async () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude-glm',
          args: ['--model', 'claude-3-5-sonnet-20241022'],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };

      const wrapper = new ClaudeCodeWrapper(config);

      vi.mocked(execa).mockResolvedValue({
        stdout: '@startuml\nTest content\n@enduml',
        stderr: '',
        command: 'claude-glm',
        escapedCommand: '',
        failed: false,
        isCanceled: false,
        killed: false,
        exitCode: 0,
        exitCodeName: 'SUCCESS',
      } as any);

      await wrapper.callCLI('test prompt');

      expect(execa).toHaveBeenCalledWith(
        'claude-glm',
        ['--model', 'claude-3-5-sonnet-20241022'],
        expect.any(Object)
      );
    });
  });

  describe('Backward compatibility', () => {
    it('should still accept ClaudeCodeOptions for backward compatibility', () => {
      const wrapper = new ClaudeCodeWrapper({
        timeout: 45000,
        maxRetries: 3,
        workingDir: '/test/dir',
      });

      expect(wrapper.options.timeout).toBe(45000);
      expect(wrapper.options.maxRetries).toBe(3);
      expect(wrapper.options.workingDir).toBe('/test/dir');
    });

    it('should use default values when no options provided', () => {
      const wrapper = new ClaudeCodeWrapper();
      expect(wrapper.options.timeout).toBe(30000);
      expect(wrapper.options.maxRetries).toBe(2);
    });
  });
});
