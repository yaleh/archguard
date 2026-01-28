/**
 * AI module exports
 * Handles Claude Code CLI integration and Mermaid generation
 *
 * @deprecated This module is deprecated. Use @/mermaid/llm instead.
 * These re-exports are maintained for backward compatibility only.
 */

// Re-export from new locations for backward compatibility
export { ClaudeClient, ClaudeClientOptions } from '../mermaid/llm/claude-client.js';

export { PromptManager, TemplateVariables } from '../mermaid/llm/prompt-manager.js';

export { ResponseParser } from '../mermaid/llm/response-parser.js';

// Legacy class name aliases for backward compatibility
export { ClaudeClient as ClaudeCodeWrapper } from '../mermaid/llm/claude-client.js';
export { PromptManager as PromptTemplateManager } from '../mermaid/llm/prompt-manager.js';
export { ResponseParser as OutputParser } from '../mermaid/llm/response-parser.js';
