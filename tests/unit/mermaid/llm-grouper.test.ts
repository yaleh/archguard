/**
 * Unit tests for LLMGrouper
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMGrouper } from '../../../src/mermaid/grouper';
import { ArchJSON } from '../../../src/types';
import type { Config } from '../../../src/cli/config-loader';

// Mock the ClaudeCodeWrapper
vi.mock('../../../src/ai/claude-code-wrapper', () => ({
  ClaudeCodeWrapper: vi.fn().mockImplementation(() => ({
    callCLI: vi.fn(),
  })),
}));

// Mock the PromptTemplateManager
vi.mock('../../../src/ai/prompt-template-manager', () => ({
  PromptTemplateManager: vi.fn().mockImplementation(() => ({
    render: vi.fn(),
  })),
}));

describe('LLMGrouper', () => {
  const mockConfig: Config = {
    outputDir: './archguard',
    format: 'mermaid',
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
    concurrency: 4,
    verbose: false,
    diagrams: [],
  };

  const archJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-26T10:00:00Z',
    sourceFiles: [
      'src/parser/TypeScriptParser.ts',
      'src/parser/extractors/ClassExtractor.ts',
      'src/ai/claude-code-wrapper.ts',
      'src/ai/plantuml-generator.ts',
      'src/cli/commands/analyze.ts',
      'src/cli/config-loader.ts',
    ],
    entities: [
      {
        id: 'TypeScriptParser',
        name: 'TypeScriptParser',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/parser/TypeScriptParser.ts', startLine: 1, endLine: 50 },
      },
      {
        id: 'ClassExtractor',
        name: 'ClassExtractor',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/parser/extractors/ClassExtractor.ts', startLine: 1, endLine: 30 },
      },
      {
        id: 'ClaudeCodeWrapper',
        name: 'ClaudeCodeWrapper',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/ai/claude-code-wrapper.ts', startLine: 1, endLine: 40 },
      },
      {
        id: 'PlantUMLGenerator',
        name: 'PlantUMLGenerator',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/ai/plantuml-generator.ts', startLine: 1, endLine: 35 },
      },
      {
        id: 'AnalyzeCommand',
        name: 'AnalyzeCommand',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/cli/commands/analyze.ts', startLine: 1, endLine: 60 },
      },
      {
        id: 'ConfigLoader',
        name: 'ConfigLoader',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/cli/config-loader.ts', startLine: 1, endLine: 45 },
      },
    ],
    relations: [
      {
        from: 'ClassExtractor',
        to: 'TypeScriptParser',
        type: 'dependency',
      },
      {
        from: 'PlantUMLGenerator',
        to: 'ClaudeCodeWrapper',
        type: 'dependency',
      },
    ],
  };

  describe('initialization', () => {
    it('should initialize with config', () => {
      const grouper = new LLMGrouper(mockConfig);
      expect(grouper).toBeDefined();
    });
  });

  describe('getLLMGrouping', () => {
    it('should call LLM with correct prompt', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockResponse = `
Here's the grouping:

\`\`\`json
{
  "packages": [
    {
      "name": "Parser Layer",
      "entities": ["TypeScriptParser", "ClassExtractor"],
      "description": "TypeScript parsing and extraction"
    },
    {
      "name": "AI Layer",
      "entities": ["ClaudeCodeWrapper", "PlantUMLGenerator"],
      "description": "AI integration and diagram generation"
    },
    {
      "name": "CLI Layer",
      "entities": ["AnalyzeCommand", "ConfigLoader"],
      "description": "Command-line interface and configuration"
    }
  ],
  "layout": {
    "direction": "LR",
    "reasoning": "Left-to-right for small architecture (6 entities)"
  }
}
\`\`\`
      `;

      const mockCallCLI = vi.fn().mockResolvedValue(mockResponse);
      const mockRender = vi.fn().mockResolvedValue('rendered prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);
      const result = await grouper.getLLMGrouping(archJson, 'class');

      // Verify LLM was called
      expect(mockCallCLI).toHaveBeenCalledWith('rendered prompt');

      // Verify template was rendered with correct variables
      expect(mockRender).toHaveBeenCalledWith('mermaid-grouping', expect.objectContaining({
        ENTITY_COUNT: '6', // Converted to string
        RELATION_COUNT: '2', // Converted to string
        DETAIL_LEVEL: 'class',
        ENTITIES_LIST: expect.stringContaining('TypeScriptParser'),
      }));

      // Verify result structure
      expect(result.packages).toHaveLength(3);
      expect(result.packages[0].name).toBe('Parser Layer');
      expect(result.packages[0].entities).toEqual(['TypeScriptParser', 'ClassExtractor']);
      expect(result.layout.direction).toBe('LR');
      expect(result.layout.reasoning).toBeDefined();
    });

    it('should extract JSON from markdown code blocks', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockResponse = `
Some text here...

\`\`\`json
{
  "packages": [
    {
      "name": "Test Layer",
      "entities": ["TypeScriptParser"],
      "description": "Test"
    }
  ],
  "layout": {
    "direction": "TB",
    "reasoning": "Test layout"
  }
}
\`\`\`

More text here...
      `;

      const mockCallCLI = vi.fn().mockResolvedValue(mockResponse);
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);
      const result = await grouper.getLLMGrouping(archJson, 'class');

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].name).toBe('Test Layer');
    });

    it('should handle plain JSON response (no markdown)', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockResponse = JSON.stringify({
        packages: [
          {
            name: 'Plain Layer',
            entities: ['TypeScriptParser'],
            description: 'Plain JSON',
          },
        ],
        layout: {
          direction: 'TB',
          reasoning: 'Plain response',
        },
      });

      const mockCallCLI = vi.fn().mockResolvedValue(mockResponse);
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);
      const result = await grouper.getLLMGrouping(archJson, 'class');

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].name).toBe('Plain Layer');
    });

    it('should throw error if JSON extraction fails', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockResponse = 'No JSON here at all!';

      const mockCallCLI = vi.fn().mockResolvedValue(mockResponse);
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);

      await expect(grouper.getLLMGrouping(archJson, 'class')).rejects.toThrow(
        'Failed to extract JSON from LLM response'
      );
    });

    it('should throw error if JSON parsing fails', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockResponse = `
\`\`\`json
{
  "packages": [
    {
      "name": "Broken",
      "entities": ["Entity"]
  ]
}
\`\`\`
      `; // Missing closing brace

      const mockCallCLI = vi.fn().mockResolvedValue(mockResponse);
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);

      await expect(grouper.getLLMGrouping(archJson, 'class')).rejects.toThrow();
    });
  });

  describe('groupWithFallback', () => {
    it('should use LLM grouping when successful', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockResponse = `
\`\`\`json
{
  "packages": [
    {
      "name": "LLM Layer",
      "entities": ["TypeScriptParser"],
      "description": "LLM grouping"
    }
  ],
  "layout": {
    "direction": "LR",
    "reasoning": "LLM layout"
  }
}
\`\`\`
      `;

      const mockCallCLI = vi.fn().mockResolvedValue(mockResponse);
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);
      const result = await grouper.groupWithFallback(archJson);

      expect(result.packages[0].name).toBe('LLM Layer');
      expect(result.layout.reasoning).toBe('LLM layout');
    });

    it('should fall back to heuristic when LLM fails', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockCallCLI = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      // Spy on console.warn
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const grouper = new LLMGrouper(mockConfig);
      const result = await grouper.groupWithFallback(archJson);

      // Should have logged warning
      expect(consoleWarnSpy).toHaveBeenCalled();
      const firstArg = consoleWarnSpy.mock.calls[0][0];
      expect(firstArg).toContain('⚠️');
      expect(firstArg).toContain('LLM grouping failed');

      // Should have heuristic result (not LLM result)
      expect(result.packages.length).toBeGreaterThan(0);
      expect(result.packages[0].name).not.toBe('LLM Layer');

      consoleWarnSpy.mockRestore();
    });

    it('should fall back to heuristic when JSON parsing fails', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockCallCLI = vi.fn().mockResolvedValue('Invalid response without JSON');
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const grouper = new LLMGrouper(mockConfig);
      const result = await grouper.groupWithFallback(archJson);

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(result.packages.length).toBeGreaterThan(0);

      consoleWarnSpy.mockRestore();
    });
  });

  describe('token consumption', () => {
    it('should generate prompt within token limits', async () => {
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      let capturedPrompt: string | null = null;

      const mockRender = vi.fn().mockImplementation(async (template: string, variables: any) => {
        const prompt = `Template: ${template}\nVariables: ${JSON.stringify(variables)}`;
        capturedPrompt = prompt;
        return prompt;
      });

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);

      try {
        await grouper.getLLMGrouping(archJson, 'class');
      } catch (error) {
        // Expected to fail because we didn't mock ClaudeCodeWrapper properly
      }

      // Verify prompt was generated
      expect(capturedPrompt).not.toBeNull();

      // Estimate tokens (roughly: characters / 4)
      const estimatedTokens = capturedPrompt!.length / 4;

      // Should be under 3000 tokens
      expect(estimatedTokens).toBeLessThan(3000);
    });
  });

  describe('entity list generation', () => {
    it('should format entity list correctly', async () => {
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      let capturedVariables: any = null;

      const mockRender = vi.fn().mockImplementation(async (template: string, variables: any) => {
        capturedVariables = variables;
        return 'prompt';
      });

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);

      try {
        await grouper.getLLMGrouping(archJson, 'class');
      } catch (error) {
        // Expected
      }

      expect(capturedVariables).toBeDefined();
      expect(capturedVariables.ENTITIES_LIST).toBeDefined();

      // Should contain all entities
      expect(capturedVariables.ENTITIES_LIST).toContain('TypeScriptParser');
      expect(capturedVariables.ENTITIES_LIST).toContain('ClassExtractor');
      expect(capturedVariables.ENTITIES_LIST).toContain('ClaudeCodeWrapper');

      // Should format correctly: "- id: name (type) in file"
      expect(capturedVariables.ENTITIES_LIST).toMatch(/- TypeScriptParser: TypeScriptParser \(class\) in/);
    });
  });

  describe('error handling', () => {
    it('should handle timeout errors gracefully', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockCallCLI = vi.fn().mockRejectedValue(new Error('CLI timeout'));
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);

      await expect(grouper.getLLMGrouping(archJson, 'class')).rejects.toThrow('CLI timeout');
    });

    it('should handle network errors gracefully', async () => {
      const { ClaudeCodeWrapper } = await import('../../../src/ai/claude-code-wrapper');
      const { PromptTemplateManager } = await import('../../../src/ai/prompt-template-manager');

      const mockCallCLI = vi.fn().mockRejectedValue(new Error('Network error'));
      const mockRender = vi.fn().mockResolvedValue('prompt');

      vi.mocked(ClaudeCodeWrapper).mockImplementation(
        () =>
          ({
            callCLI: mockCallCLI,
          } as any)
      );

      vi.mocked(PromptTemplateManager).mockImplementation(
        () =>
          ({
            render: mockRender,
          } as any)
      );

      const grouper = new LLMGrouper(mockConfig);

      await expect(grouper.getLLMGrouping(archJson, 'class')).rejects.toThrow('Network error');
    });
  });
});
