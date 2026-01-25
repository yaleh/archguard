/**
 * Claude API Connector
 * Handles communication with Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Configuration options for ClaudeConnector
 */
export interface ClaudeConnectorConfig {
  model?: string;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Chat response from Claude API
 */
export interface ChatResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Chat options
 */
export interface ChatOptions {
  systemPrompt?: string;
}

/**
 * Custom error types for better error handling
 */
export class ClaudeAPIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

/**
 * ClaudeConnector - manages interactions with Claude API
 */
export class ClaudeConnector {
  public client: Anthropic;
  private model: string;
  private maxTokens: number;

  // Token limit for input (Claude Sonnet has ~200k context)
  private readonly INPUT_TOKEN_LIMIT = 100000;

  constructor(apiKey: string, config: ClaudeConnectorConfig = {}) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key is required');
    }

    this.model = config.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = config.maxTokens || 4096;

    this.client = new Anthropic({
      apiKey: apiKey.trim(),
      timeout: config.timeout || 60000, // 60 seconds default
    });
  }

  /**
   * Get the current model being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the maximum output tokens
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Estimate tokens for a given text
   * Rough estimation: ~4 characters per token for English
   */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    // Simple estimation: 4 characters ≈ 1 token
    return Math.ceil(text.length / 4);
  }

  /**
   * Validate input before sending to API
   */
  validateInput(input: string): void {
    if (!input || input.trim().length === 0) {
      throw new ClaudeAPIError(
        'Input cannot be empty',
        'INVALID_INPUT',
        false
      );
    }

    const estimatedTokens = this.estimateTokens(input);
    if (estimatedTokens > this.INPUT_TOKEN_LIMIT) {
      throw new ClaudeAPIError(
        `Input exceeds token limit (estimated: ${estimatedTokens}, limit: ${this.INPUT_TOKEN_LIMIT})`,
        'TOKEN_LIMIT_EXCEEDED',
        false
      );
    }
  }

  /**
   * Send a chat message to Claude and get a response
   */
  async chat(
    prompt: string,
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    // Validate input
    this.validateInput(prompt);

    try {
      const requestParams: Anthropic.MessageCreateParams = {
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      };

      // Add system prompt if provided
      if (options.systemPrompt) {
        requestParams.system = options.systemPrompt;
      }

      const response = await this.client.messages.create(requestParams);

      // Extract text from response
      const text = this.extractTextFromResponse(response);

      return {
        text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error: any) {
      // Handle specific API errors
      if (error.status) {
        switch (error.status) {
          case 401:
            throw new ClaudeAPIError(
              'API authentication failed: Invalid API key',
              'AUTH_FAILED',
              false
            );
          case 408:
            throw new ClaudeAPIError(
              'API timeout: Request took too long',
              'TIMEOUT',
              true
            );
          case 429:
            throw new ClaudeAPIError(
              'Rate limit exceeded: Too many requests',
              'RATE_LIMIT',
              true
            );
          case 500:
          case 502:
          case 503:
            throw new ClaudeAPIError(
              'API server error: Service temporarily unavailable',
              'SERVER_ERROR',
              true
            );
          default:
            throw new ClaudeAPIError(
              `API error: ${error.message}`,
              'API_ERROR',
              false
            );
        }
      }

      // Handle network errors
      if (error.message && error.message.includes('Network')) {
        throw new ClaudeAPIError(
          'Network error: Failed to connect to API',
          'NETWORK_ERROR',
          true
        );
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  /**
   * Extract text content from Claude API response
   */
  private extractTextFromResponse(
    response: Anthropic.Message
  ): string {
    if (!response.content || response.content.length === 0) {
      return '';
    }

    // Combine all text blocks
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => {
        if (block.type === 'text') {
          return block.text;
        }
        return '';
      })
      .join('');
  }
}
