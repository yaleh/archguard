/**
 * Unit tests for ClaudeConnector
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeConnector } from '../../../src/ai/claude-connector';

describe('ClaudeConnector', () => {
  describe('initialization', () => {
    it('should initialize with API key', () => {
      const connector = new ClaudeConnector('test-api-key');

      expect(connector).toBeDefined();
      expect(connector.getModel()).toBe('claude-3-5-sonnet-20241022');
    });

    it('should throw error when API key is missing', () => {
      expect(() => new ClaudeConnector('')).toThrow('API key is required');
    });

    it('should accept custom model', () => {
      const connector = new ClaudeConnector('test-api-key', {
        model: 'claude-opus-4-5-20251101',
      });

      expect(connector.getModel()).toBe('claude-opus-4-5-20251101');
    });

    it('should accept custom max tokens', () => {
      const connector = new ClaudeConnector('test-api-key', {
        maxTokens: 8192,
      });

      expect(connector.getMaxTokens()).toBe(8192);
    });
  });

  describe('token estimation', () => {
    it('should estimate tokens for short text', () => {
      const connector = new ClaudeConnector('test-api-key');
      const text = 'Hello, world!'; // ~3 tokens
      const estimate = connector.estimateTokens(text);

      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(10);
    });

    it('should estimate tokens for long text', () => {
      const connector = new ClaudeConnector('test-api-key');
      const text = 'a'.repeat(4000); // ~1000 tokens
      const estimate = connector.estimateTokens(text);

      expect(estimate).toBeGreaterThan(900);
      expect(estimate).toBeLessThan(1100);
    });

    it('should handle empty string', () => {
      const connector = new ClaudeConnector('test-api-key');
      const estimate = connector.estimateTokens('');

      expect(estimate).toBe(0);
    });
  });

  describe('input validation', () => {
    it('should reject extremely long input', () => {
      const connector = new ClaudeConnector('test-api-key');
      const longInput = 'a'.repeat(500000); // > 100k tokens

      expect(() => connector.validateInput(longInput)).toThrow('Input exceeds token limit');
    });

    it('should accept valid input', () => {
      const connector = new ClaudeConnector('test-api-key');
      const validInput = 'This is a valid prompt';

      expect(() => connector.validateInput(validInput)).not.toThrow();
    });

    it('should reject empty input', () => {
      const connector = new ClaudeConnector('test-api-key');

      expect(() => connector.validateInput('')).toThrow('Input cannot be empty');
    });
  });

  describe('chat functionality', () => {
    it('should handle successful API call', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Hello from Claude!' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      const response = await connector.chat('Hello, Claude!');

      expect(response.text).toBe('Hello from Claude!');
      expect(response.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
      });
      expect(mockClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: 'Hello, Claude!',
          },
        ],
      });
    });

    it('should handle API authentication error', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockRejectedValue({
            status: 401,
            message: 'Invalid API key',
          }),
        },
      };

      const connector = new ClaudeConnector('invalid-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      await expect(connector.chat('Test')).rejects.toThrow('API authentication failed');
    });

    it('should handle API timeout error', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockRejectedValue({
            status: 408,
            message: 'Request timeout',
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      await expect(connector.chat('Test')).rejects.toThrow('API timeout');
    });

    it('should handle rate limit error', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockRejectedValue({
            status: 429,
            message: 'Rate limit exceeded',
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      await expect(connector.chat('Test')).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle server error', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockRejectedValue({
            status: 500,
            message: 'Internal server error',
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      await expect(connector.chat('Test')).rejects.toThrow('API server error');
    });

    it('should handle network error', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('Network connection failed')),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      await expect(connector.chat('Test')).rejects.toThrow('Network error');
    });
  });

  describe('system prompts', () => {
    it('should support system prompts', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 20, output_tokens: 5 },
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      await connector.chat('User message', {
        systemPrompt: 'You are a helpful assistant',
      });

      expect(mockClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system: 'You are a helpful assistant',
        messages: [
          {
            role: 'user',
            content: 'User message',
          },
        ],
      });
    });
  });

  describe('response extraction', () => {
    it('should extract text from single content block', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Single response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      const response = await connector.chat('Test');

      expect(response.text).toBe('Single response');
    });

    it('should extract text from multiple content blocks', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
            ],
            usage: { input_tokens: 10, output_tokens: 8 },
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      const response = await connector.chat('Test');

      expect(response.text).toBe('Part 1Part 2');
    });

    it('should handle empty content', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [],
            usage: { input_tokens: 10, output_tokens: 0 },
          }),
        },
      };

      const connector = new ClaudeConnector('test-api-key');
      // @ts-ignore - inject mock client for testing
      connector.client = mockClient;

      const response = await connector.chat('Test');

      expect(response.text).toBe('');
    });
  });
});
