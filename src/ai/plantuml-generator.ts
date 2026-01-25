/**
 * PlantUML Generator
 * Generates PlantUML diagrams from ArchJSON using Claude Code CLI
 */

import { ClaudeCodeWrapper } from './claude-code-wrapper.js';
import { PlantUMLValidator } from './plantuml-validator.js';
import { ArchJSON } from '../types';

/**
 * Generator configuration
 */
export interface GeneratorConfig {
  model?: string;
  maxRetries?: number;
  timeout?: number;
  workingDir?: string;
}

/**
 * PlantUMLGenerator - main class for generating PlantUML diagrams
 */
export class PlantUMLGenerator {
  private wrapper: ClaudeCodeWrapper;
  private validator: PlantUMLValidator;

  constructor(config: GeneratorConfig = {}) {
    // Create ClaudeCodeWrapper with configuration
    this.wrapper = new ClaudeCodeWrapper({
      model: config.model,
      maxRetries: config.maxRetries,
      timeout: config.timeout,
      workingDir: config.workingDir,
    });

    // Create validator for output validation
    this.validator = new PlantUMLValidator();
  }

  /**
   * Generate PlantUML diagram from ArchJSON
   *
   * @param archJson - Architecture JSON data
   * @param previousPuml - Optional previous PlantUML for incremental updates
   * @returns PlantUML code
   * @throws Error if generation fails or validation fails
   */
  async generate(archJson: ArchJSON, previousPuml?: string): Promise<string> {
    // Generate PlantUML using Claude Code CLI wrapper
    const puml = await this.wrapper.generatePlantUML(archJson, previousPuml);

    // Validate output
    const validation = this.validator.validate(puml, archJson);

    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.issues.join(', ')}`);
    }

    return puml;
  }
}
