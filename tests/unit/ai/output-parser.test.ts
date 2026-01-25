/**
 * Tests for OutputParser
 *
 * Phase 0: Stub file - Tests will be implemented in Phase 1
 */

import { describe, it, expect } from 'vitest';
import { OutputParser } from '../../../src/ai/output-parser.js';

describe('OutputParser (Phase 0 - Stub)', () => {
  describe('extractPlantUML', () => {
    it('should be defined', () => {
      const parser = new OutputParser();
      expect(parser.extractPlantUML).toBeDefined();
    });

    // Phase 1 tests will be added here:
    // - Extract from markdown code blocks
    // - Extract from raw PlantUML
    // - Handle multiple code blocks
    // - Error on no PlantUML found
  });
});
