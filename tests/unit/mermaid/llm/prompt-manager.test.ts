/**
 * Tests for PromptManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { PromptManager } from '../../../../src/mermaid/llm/prompt-manager.js';

describe('PromptManager', () => {
  let manager: PromptManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for test templates
    tempDir = path.join(process.cwd(), '.test-templates');
    await fs.ensureDir(tempDir);
    manager = new PromptManager(tempDir);
  });

  afterEach(async () => {
    // Clean up
    manager.clearCache();
    await fs.remove(tempDir);
  });

  describe('loadTemplate', () => {
    it('should load template from file', async () => {
      const templateContent = 'Hello {{NAME}}';
      await fs.writeFile(path.join(tempDir, 'test.txt'), templateContent);

      const result = await manager.loadTemplate('test');
      expect(result).toBe(templateContent);
    });

    it('should cache loaded templates', async () => {
      const templateContent = 'Test template';
      await fs.writeFile(path.join(tempDir, 'cached.txt'), templateContent);

      // First load
      await manager.loadTemplate('cached');

      // Remove file
      await fs.remove(path.join(tempDir, 'cached.txt'));

      // Should still work because of cache
      const result = await manager.loadTemplate('cached');
      expect(result).toBe(templateContent);
    });

    it('should throw error for missing template', async () => {
      await expect(manager.loadTemplate('missing')).rejects.toThrow(/Template 'missing' not found/);
    });
  });

  describe('render - simple variable substitution', () => {
    it('should replace simple variables', async () => {
      const template = 'Hello {{NAME}}, you are {{AGE}} years old.';
      await fs.writeFile(path.join(tempDir, 'simple.txt'), template);

      const result = await manager.render('simple', {
        ARCH_JSON: '{}',
        NAME: 'Alice',
        AGE: '30',
      });

      expect(result).toBe('Hello Alice, you are 30 years old.');
    });

    it('should keep placeholder for undefined variables', async () => {
      const template = 'Hello {{NAME}}, {{MISSING}}';
      await fs.writeFile(path.join(tempDir, 'undefined.txt'), template);

      const result = await manager.render('undefined', {
        ARCH_JSON: '{}',
        NAME: 'Bob',
      });

      expect(result).toBe('Hello Bob, {{MISSING}}');
    });
  });

  describe('render - simple conditionals', () => {
    it('should render if block when variable is truthy', async () => {
      const template = '{{#if SHOW}}Visible{{else}}Hidden{{/if}}';
      await fs.writeFile(path.join(tempDir, 'conditional.txt'), template);

      const result = await manager.render('conditional', {
        ARCH_JSON: '{}',
        SHOW: 'true',
      });

      expect(result).toBe('Visible');
    });

    it('should render else block when variable is falsy', async () => {
      const template = '{{#if SHOW}}Visible{{else}}Hidden{{/if}}';
      await fs.writeFile(path.join(tempDir, 'conditional.txt'), template);

      const result = await manager.render('conditional', {
        ARCH_JSON: '{}',
        SHOW: '',
      });

      expect(result).toBe('Hidden');
    });

    it('should handle conditional without else block', async () => {
      const template = 'Start {{#if SHOW}}Middle{{/if}} End';
      await fs.writeFile(path.join(tempDir, 'no-else.txt'), template);

      const resultTrue = await manager.render('no-else', {
        ARCH_JSON: '{}',
        SHOW: 'yes',
      });
      expect(resultTrue).toBe('Start Middle End');

      manager.clearCache();

      const resultFalse = await manager.render('no-else', {
        ARCH_JSON: '{}',
        SHOW: '',
      });
      expect(resultFalse).toBe('Start  End');
    });
  });

  describe('render - comparison conditionals', () => {
    it('should handle equality comparison', async () => {
      const template = '{{#if LEVEL == "high"}}High level{{else}}Other level{{/if}}';
      await fs.writeFile(path.join(tempDir, 'comparison.txt'), template);

      const resultMatch = await manager.render('comparison', {
        ARCH_JSON: '{}',
        LEVEL: 'high',
      });
      expect(resultMatch).toBe('High level');

      manager.clearCache();

      const resultNoMatch = await manager.render('comparison', {
        ARCH_JSON: '{}',
        LEVEL: 'low',
      });
      expect(resultNoMatch).toBe('Other level');
    });

    it('should handle comparison without else block', async () => {
      const template = 'Start {{#if TYPE == "special"}}Special{{/if}} End';
      await fs.writeFile(path.join(tempDir, 'comp-no-else.txt'), template);

      const resultMatch = await manager.render('comp-no-else', {
        ARCH_JSON: '{}',
        TYPE: 'special',
      });
      expect(resultMatch).toBe('Start Special End');

      manager.clearCache();

      const resultNoMatch = await manager.render('comp-no-else', {
        ARCH_JSON: '{}',
        TYPE: 'normal',
      });
      expect(resultNoMatch).toBe('Start  End');
    });
  });

  describe('render - DETAIL_LEVEL support', () => {
    const detailLevelTemplate = `
## Detail Level: {{DETAIL_LEVEL}}

{{#if DETAIL_LEVEL == "package"}}
### Package Level
- Show packages only
- No classes
{{/if}}

{{#if DETAIL_LEVEL == "class"}}
### Class Level
- Show classes
- Show public methods
{{/if}}

{{#if DETAIL_LEVEL == "method"}}
### Method Level
- Show all methods
- Show private members
{{/if}}

End of template.
`.trim();

    beforeEach(async () => {
      await fs.writeFile(path.join(tempDir, 'detail-level.txt'), detailLevelTemplate);
    });

    it('should render package level correctly', async () => {
      const result = await manager.render('detail-level', {
        ARCH_JSON: '{}',
        DETAIL_LEVEL: 'package',
      });

      expect(result).toContain('Detail Level: package');
      expect(result).toContain('### Package Level');
      expect(result).toContain('Show packages only');
      expect(result).not.toContain('### Class Level');
      expect(result).not.toContain('### Method Level');
    });

    it('should render class level correctly', async () => {
      const result = await manager.render('detail-level', {
        ARCH_JSON: '{}',
        DETAIL_LEVEL: 'class',
      });

      expect(result).toContain('Detail Level: class');
      expect(result).toContain('### Class Level');
      expect(result).toContain('Show public methods');
      expect(result).not.toContain('### Package Level');
      expect(result).not.toContain('### Method Level');
    });

    it('should render method level correctly', async () => {
      const result = await manager.render('detail-level', {
        ARCH_JSON: '{}',
        DETAIL_LEVEL: 'method',
      });

      expect(result).toContain('Detail Level: method');
      expect(result).toContain('### Method Level');
      expect(result).toContain('Show all methods');
      expect(result).not.toContain('### Package Level');
      expect(result).not.toContain('### Class Level');
    });

    it('should handle missing DETAIL_LEVEL gracefully', async () => {
      const result = await manager.render('detail-level', {
        ARCH_JSON: '{}',
      });

      expect(result).toContain('Detail Level: {{DETAIL_LEVEL}}');
      expect(result).not.toContain('### Package Level');
      expect(result).not.toContain('### Class Level');
      expect(result).not.toContain('### Method Level');
    });
  });

  describe('render - nested and complex conditionals', () => {
    it('should handle multiple conditionals in sequence', async () => {
      const template = `
{{#if A}}A is true{{/if}}
{{#if B}}B is true{{/if}}
{{#if C == "test"}}C is test{{/if}}
`.trim();
      await fs.writeFile(path.join(tempDir, 'multiple.txt'), template);

      const result = await manager.render('multiple', {
        ARCH_JSON: '{}',
        A: 'yes',
        B: '',
        C: 'test',
      });

      expect(result).toContain('A is true');
      expect(result).not.toContain('B is true');
      expect(result).toContain('C is test');
    });

    it('should handle multiline conditional blocks', async () => {
      const template = `
{{#if ENABLE}}
Line 1
Line 2
Line 3
{{else}}
Other line 1
Other line 2
{{/if}}
`.trim();
      await fs.writeFile(path.join(tempDir, 'multiline.txt'), template);

      const result = await manager.render('multiline', {
        ARCH_JSON: '{}',
        ENABLE: 'true',
      });

      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
      expect(result).not.toContain('Other line 1');
    });
  });

  describe('clearCache', () => {
    it('should clear template cache', async () => {
      const templateContent = 'Original content';
      await fs.writeFile(path.join(tempDir, 'cache-test.txt'), templateContent);

      // Load and cache
      await manager.loadTemplate('cache-test');

      // Modify file
      await fs.writeFile(path.join(tempDir, 'cache-test.txt'), 'New content');

      // Should still return cached version
      let result = await manager.loadTemplate('cache-test');
      expect(result).toBe('Original content');

      // Clear cache
      manager.clearCache();

      // Should return new content
      result = await manager.loadTemplate('cache-test');
      expect(result).toBe('New content');
    });
  });

  describe('getTemplatesDir', () => {
    it('should return templates directory path', () => {
      const result = manager.getTemplatesDir();
      expect(result).toBe(tempDir);
    });
  });
});
