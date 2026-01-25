/**
 * Tests for CLI Detector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectClaudeCodeCLI, isClaudeCodeAvailable } from '../../../src/utils/cli-detector.js';

describe('CLI Detector', () => {
  describe('detectClaudeCodeCLI', () => {
    it('should detect CLI availability', async () => {
      const result = await detectClaudeCodeCLI();

      expect(result).toHaveProperty('available');
      expect(typeof result.available).toBe('boolean');

      if (result.available) {
        expect(result.version).toBeDefined();
        expect(typeof result.version).toBe('string');
      } else {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    });

    it('should return error message when CLI is not found', async () => {
      // This test assumes Claude Code CLI is not installed
      // If it is installed, this test will be skipped
      const result = await detectClaudeCodeCLI();

      if (!result.available) {
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Claude Code CLI');
      }
    });
  });

  describe('isClaudeCodeAvailable', () => {
    it('should return boolean result', async () => {
      const result = await isClaudeCodeAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should match detectClaudeCodeCLI result', async () => {
      const detectionResult = await detectClaudeCodeCLI();
      const simpleResult = await isClaudeCodeAvailable();

      expect(simpleResult).toBe(detectionResult.available);
    });
  });
});
