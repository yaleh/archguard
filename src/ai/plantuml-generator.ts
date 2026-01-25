/**
 * PlantUML Generator
 * Generates PlantUML diagrams from ArchJSON using Claude Code CLI
 */

import { ClaudeCodeWrapper } from './claude-code-wrapper.js';
import { PlantUMLValidator } from './plantuml-validator.js';
import { PlantUMLRenderer } from './plantuml-renderer.js';
import { ArchJSON } from '../types';
import type { Config } from '../cli/config-loader.js';
import type { PathResolution } from '../cli/utils/output-path-resolver.js';

/**
 * Generator configuration
 * @deprecated Use Config object instead. Maintained for backward compatibility.
 */
export interface GeneratorConfig {
  model?: string;
  maxRetries?: number;
  timeout?: number;
  workingDir?: string;
}

/**
 * PlantUMLGenerator - main class for generating PlantUML diagrams
 *
 * Supports both Config objects (preferred) and GeneratorConfig (deprecated, for backward compatibility).
 */
export class PlantUMLGenerator {
  private wrapper: ClaudeCodeWrapper;
  private validator: PlantUMLValidator;
  private renderer: PlantUMLRenderer;

  constructor(configOrOptions?: Config | GeneratorConfig) {
    // Detect if we received a Config object (has 'cli' property) or GeneratorConfig
    const isConfig = configOrOptions && 'cli' in configOrOptions;

    if (isConfig) {
      // Full Config object (preferred path)
      const config = configOrOptions;
      this.wrapper = new ClaudeCodeWrapper(config);
    } else {
      // GeneratorConfig (deprecated, backward compatibility)
      const options = (configOrOptions as GeneratorConfig) || {};
      this.wrapper = new ClaudeCodeWrapper({
        timeout: options.timeout,
        maxRetries: options.maxRetries,
        workingDir: options.workingDir,
        model: options.model,
      });
    }

    // Create validator for output validation
    this.validator = new PlantUMLValidator();

    // Create renderer for PNG generation
    this.renderer = new PlantUMLRenderer();
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

  /**
   * Generate PlantUML diagram and render to PNG
   *
   * @param archJson - Architecture JSON data
   * @param pathOrResolution - Either a PathResolution object or output path string (deprecated)
   * @param previousPuml - Optional previous PlantUML for incremental updates
   * @returns Promise resolving when PNG is saved
   * @throws Error if generation or rendering fails
   */
  async generateAndRender(
    archJson: ArchJSON,
    pathOrResolution: PathResolution | string,
    previousPuml?: string
  ): Promise<void> {
    // Generate PlantUML code
    const puml = await this.generate(archJson, previousPuml);

    // Determine paths
    let pumlPath: string;
    let pngPath: string;

    if (typeof pathOrResolution === 'string') {
      // Legacy behavior: raw string path (backward compatibility)
      pumlPath = pathOrResolution.replace(/\.png$/, '.puml');
      pngPath = pathOrResolution;
    } else {
      // New behavior: PathResolution object
      pumlPath = pathOrResolution.paths.puml;
      pngPath = pathOrResolution.paths.png;
    }

    // Save PlantUML file
    await import('fs').then((fs) => fs.promises.writeFile(pumlPath, puml));

    // Render to PNG
    await this.renderer.render(puml, pngPath);
  }
}
