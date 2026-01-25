/**
 * PlantUML Generator
 * Generates PlantUML diagrams from ArchJSON using Claude AI
 */

import { ClaudeConnector, ChatResponse } from './claude-connector';
import { PromptBuilder } from './prompt-builder';
import { PlantUMLValidator } from './plantuml-validator';
import { ArchJSON } from '../types';

/**
 * Generator configuration
 */
export interface GeneratorConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  maxTokens?: number;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * PlantUMLGenerator - main class for generating PlantUML diagrams
 */
export class PlantUMLGenerator {
  public connector: ClaudeConnector;
  private promptBuilder: PromptBuilder;
  private validator: PlantUMLValidator;
  private maxRetries: number;
  private lastUsage?: TokenUsage;

  constructor(config: GeneratorConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('API key is required for PlantUMLGenerator');
    }

    this.connector = new ClaudeConnector(config.apiKey, {
      model: config.model,
      maxTokens: config.maxTokens,
    });

    this.promptBuilder = new PromptBuilder();
    this.validator = new PlantUMLValidator();
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Generate PlantUML diagram from ArchJSON
   */
  async generate(archJson: ArchJSON): Promise<string> {
    const prompt = this.promptBuilder.buildClassDiagramPrompt(archJson);
    const systemPrompt = this.promptBuilder.getSystemPrompt();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Call Claude API
        const response: ChatResponse = await this.connector.chat(prompt, {
          systemPrompt,
        });

        // Track usage
        this.lastUsage = {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.inputTokens + response.usage.outputTokens,
        };

        // Extract PlantUML from response
        const puml = this.extractPlantUML(response.text);

        // Validate output
        const validation = this.validator.validate(puml, archJson);

        if (validation.isValid && puml) {
          return puml;
        }

        // Validation failed
        if (attempt < this.maxRetries) {
          console.warn(`Validation failed (attempt ${attempt}/${this.maxRetries}), retrying...`);
          console.warn(`Issues: ${validation.issues.join(', ')}`);

          // Wait a bit before retrying
          await this.sleep(1000 * attempt);
        } else {
          throw new Error(
            `Validation failed after ${this.maxRetries} attempts: ${validation.issues.join(', ')}`
          );
        }
      } catch (error: any) {
        if (attempt === this.maxRetries) {
          throw new Error(
            `Failed to generate PlantUML after ${this.maxRetries} attempts: ${error.message}`
          );
        }

        console.warn(`API call failed (attempt ${attempt}/${this.maxRetries}), retrying...`);
        console.warn(`Error: ${error.message}`);

        // Wait before retrying (exponential backoff)
        await this.sleep(1000 * attempt);
      }
    }

    throw new Error('Failed to generate valid PlantUML');
  }

  /**
   * Extract PlantUML code from Claude's response
   */
  extractPlantUML(response: string): string {
    // Try to find PlantUML in markdown code block with language specifier
    let match = response.match(/```plantuml\s*([\s\S]*?)```/);
    if (match && match[1]) {
      return match[1].trim();
    }

    // Try to find PlantUML in markdown code block without language specifier
    match = response.match(/```\s*([\s\S]*?)```/);
    if (match && match[1]) {
      const content = match[1].trim();
      // Check if it looks like PlantUML
      if (content.includes('@startuml') || content.includes('@enduml')) {
        return content;
      }
    }

    // Try to find raw PlantUML (from @startuml to @enduml)
    match = response.match(/@startuml[\s\S]*?@enduml/);
    if (match) {
      return match[0].trim();
    }

    // If all else fails, return the whole response trimmed
    return response.trim();
  }

  /**
   * Get the last token usage information
   */
  getLastUsage(): TokenUsage | undefined {
    return this.lastUsage;
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
