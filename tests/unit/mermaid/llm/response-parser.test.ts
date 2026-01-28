/**
 * Tests for ResponseParser
 */

import { describe, it, expect } from 'vitest';
import { ResponseParser } from '../../../../src/mermaid/llm/response-parser.js';

describe('ResponseParser', () => {
  describe('extractMermaid', () => {
    it('should extract mermaid from markdown code blocks with language', () => {
      const parser = new ResponseParser();
      const output = '```mermaid\ngraph TD\nA-->B\n```';
      const result = parser.extractMermaid(output);
      expect(result).toBe('graph TD\nA-->B');
    });

    it('should extract mermaid from any markdown code block', () => {
      const parser = new ResponseParser();
      const output = '```\ngraph TD\nA-->B\n```';
      const result = parser.extractMermaid(output);
      expect(result).toBe('graph TD\nA-->B');
    });

    it('should return entire output if no code blocks', () => {
      const parser = new ResponseParser();
      const output = 'graph TD\nA-->B';
      const result = parser.extractMermaid(output);
      expect(result).toBe('graph TD\nA-->B');
    });

    it('should handle empty output', () => {
      const parser = new ResponseParser();
      expect(() => parser.extractMermaid('')).toThrow();
    });

    it('should handle output with explanatory text', () => {
      const parser = new ResponseParser();
      const output = "Here is the diagram:\n```mermaid\ngraph TD\nA-->B\n```\nThat's it!";
      const result = parser.extractMermaid(output);
      expect(result).toBe('graph TD\nA-->B');
    });
  });

  describe('extractPlantUML - backward compatibility', () => {
    it('should call extractMermaid for backward compatibility', () => {
      const parser = new ResponseParser();
      const output = '```mermaid\ngraph TD\nA-->B\n```';
      const result = parser.extractPlantUML(output);
      expect(result).toBe('graph TD\nA-->B');
    });
  });
});
