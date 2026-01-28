/**
 * Tests for ResponseParser
 *
 * @deprecated This test file is maintained for backward compatibility.
 * New tests are in tests/unit/mermaid/llm/response-parser.test.ts
 */

import { describe, it, expect } from 'vitest';
import { ResponseParser } from '../../../src/mermaid/llm/response-parser.js';

describe('ResponseParser (Phase 0 - Stub)', () => {
  describe('extractMermaid', () => {
    it('should be defined', () => {
      const parser = new ResponseParser();
      expect(parser.extractMermaid).toBeDefined();
    });

    // Phase 1 tests will be added here:
    // - Extract from markdown code blocks
    // - Extract from raw PlantUML
    // - Handle multiple code blocks
    // - Error on no PlantUML found
  });
});
