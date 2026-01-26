/**
 * PlantUML Generator
 * Generates PlantUML diagrams from ArchJSON using Claude Code CLI
 */

import fs from 'fs-extra';
import { ClaudeCodeWrapper } from './claude-code-wrapper.js';
import { PlantUMLValidator } from './plantuml-validator.js';
import { PlantUMLRenderer } from './plantuml-renderer.js';
import { ArchJSON } from '../types';
import type { Config } from '../cli/config-loader.js';
import type { PathResolution } from '../cli/utils/output-path-resolver.js';
import type { DetailLevel } from '../types/config.js';

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
   * @param level - Detail level for the diagram (default: 'class')
   * @returns PlantUML code
   * @throws Error if generation fails or validation fails
   */
  async generate(archJson: ArchJSON, previousPuml?: string, level: DetailLevel = 'class'): Promise<string> {
    // Generate PlantUML using Claude Code CLI wrapper
    const puml = await this.wrapper.generatePlantUML(archJson, previousPuml, level);

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
   * @param level - Detail level for the diagram (default: 'class')
   * @returns Promise resolving when PNG is saved
   * @throws Error if generation or rendering fails
   */
  async generateAndRender(
    archJson: ArchJSON,
    pathOrResolution: PathResolution | string,
    level: DetailLevel = 'class'
  ): Promise<void> {
    // Generate PlantUML code
    const puml = await this.wrapper.generatePlantUML(archJson, undefined, level, false);

    // Determine paths
    let pumlPath: string;
    let pngPath: string;

    if (typeof pathOrResolution === 'string') {
      // Legacy behavior: raw string path (backward compatibility)
      pumlPath = pathOrResolution.replace(/\.png$/, '.puml');
      pngPath = pathOrResolution;
    } else {
      // New behavior: PathResolution object
      // Support both .puml (legacy) and .mmd (new mermaid format)
      // @ts-ignore - transitional compatibility during mermaid migration
      pumlPath = pathOrResolution.paths.puml;
      // @ts-ignore - transitional compatibility during mermaid migration
      pngPath = pathOrResolution.paths.png;

      // Fallback to mmd if puml is not available (for mermaid diagrams)
      if (!pumlPath && pathOrResolution.paths.mmd) {
        pumlPath = pathOrResolution.paths.mmd;
      }
    }

    // Save PlantUML file
    await fs.writeFile(pumlPath, puml);

    // Validate and attempt repair if needed
    const validation = this.validator.validate(puml, archJson);
    if (!validation.isValid) {
      const errorMessage = `Validation failed: ${validation.issues.join(', ')}`;
      await this.wrapper.repairPlantUML(pumlPath, archJson, errorMessage);

      const repairedPuml = await fs.readFile(pumlPath, 'utf-8');
      const repairedValidation = this.validator.validate(repairedPuml, archJson);
      if (!repairedValidation.isValid) {
        const locallyRepaired = this.applyLocalRepair(repairedPuml, archJson, repairedValidation.issues);
        const localValidation = this.validator.validate(locallyRepaired, archJson);
        if (!localValidation.isValid) {
          throw new Error(`Validation failed after repair: ${localValidation.issues.join(', ')}`);
        }

        await fs.writeFile(pumlPath, locallyRepaired);
        await this.renderer.render(locallyRepaired, pngPath);
        return;
      }

      await this.renderer.render(repairedPuml, pngPath);
      return;
    }

    // Render to PNG
    await this.renderer.render(puml, pngPath);
  }

  private applyLocalRepair(puml: string, archJson: ArchJSON, issues: string[]): string {
    const missingEntities = new Set<string>();
    const linesToRemove = new Set<string>();

    for (const issue of issues) {
      if (issue.startsWith('Missing entity: ')) {
        missingEntities.add(issue.replace('Missing entity: ', '').trim());
        continue;
      }

      if (issue.startsWith('Missing: ')) {
        missingEntities.add(issue.replace('Missing: ', '').trim());
        continue;
      }

      if (issue.startsWith('Relationship references undefined entity:')) {
        const lineMatch = issue.match(/line:\s*\"(.*)\"\)?$/);
        if (lineMatch && lineMatch[1]) {
          linesToRemove.add(lineMatch[1].trim());
        }
        continue;
      }

      if (issue.startsWith('Invalid entity declaration: ')) {
        const line = issue.replace('Invalid entity declaration: ', '').trim();
        linesToRemove.add(line);
        const nameMatch = line.match(/^(class|interface|enum)\s+(.+?)(\s+as\s+.+)?(\s*\{)?$/);
        if (nameMatch && nameMatch[2]) {
          let rawName = nameMatch[2].trim();
          rawName = rawName.replace(/^"|"$/g, '');
          rawName = rawName.replace(/<[^>]*>/g, '');
          rawName = rawName.split(/\s+/)[0] ?? rawName;
          if (rawName && archJson.entities.some((entity) => entity.name === rawName)) {
            missingEntities.add(rawName);
          }
        }
        continue;
      }

      if (issue.startsWith('Invalid relationship endpoint: ')) {
        linesToRemove.add(issue.replace('Invalid relationship endpoint: ', '').trim());
        continue;
      }
    }

    let updated = puml;

    if (linesToRemove.size > 0) {
      const lines = updated.split('\n');
      updated = lines
        .filter((line) => {
          const trimmed = line.trim();
          return trimmed.length === 0 || !linesToRemove.has(trimmed);
        })
        .join('\n');
    }

    if (missingEntities.size > 0) {
      const declarations: string[] = [];
      for (const name of missingEntities) {
        const entity = archJson.entities.find((item) => item.name === name);
        const type = entity?.type === 'interface' || entity?.type === 'enum' ? entity.type : 'class';
        declarations.push(`  ${type} ${name} { }`);
      }

      if (declarations.length > 0) {
        const block = ['package "Auto Added" {', ...declarations, '}'].join('\n');
        if (updated.includes('@enduml')) {
          updated = updated.replace('@enduml', `${block}\n\n@enduml`);
        } else {
          updated = `${updated}\n\n${block}`;
        }
      }
    }

    return updated;
  }
}
