/**
 * PlantUML Renderer
 * Renders PlantUML diagrams to PNG images using node-plantuml
 */

import plantuml from '@entrofi/node-plantuml';
import fs from 'fs';

/**
 * Render configuration
 */
export interface RenderConfig {
  /** Output format (default: png) */
  format?: 'png' | 'svg' | 'eps';
  /** Theme for the diagram */
  theme?: string;
  /** Background color */
  backgroundColor?: string;
}

/**
 * PlantUMLRenderer - renders PlantUML code to images
 */
export class PlantUMLRenderer {
  private readonly defaultConfig: RenderConfig = {
    format: 'png',
    theme: 'plain',
    backgroundColor: 'white',
  };

  constructor(private config: RenderConfig = {}) {}

  /**
   * Render PlantUML code to PNG
   *
   * @param pumlCode - PlantUML source code
   * @param outputPath - Path to save the PNG file
   * @returns Promise resolving when rendering is complete
   */
  async render(pumlCode: string, outputPath: string): Promise<void> {
    // Apply theme and background color if not already in the code
    const processedCode = this.preprocessCode(pumlCode);

    return new Promise((resolve, reject) => {
      const gen = plantuml.generate(processedCode, { format: 'png' });
      const chunks: Buffer[] = [];

      gen.out.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      gen.out.on('end', () => {
        try {
          const pngBuffer = Buffer.concat(chunks);
          fs.writeFileSync(outputPath, pngBuffer);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      gen.out.on('error', (error: Error) => {
        reject(new Error(`Failed to render PNG: ${error.message}`));
      });
    });
  }

  /**
   * Render PlantUML file to PNG
   *
   * @param pumlPath - Path to PlantUML source file
   * @param outputPath - Path to save the PNG file (default: same as pumlPath with .png extension)
   * @returns Promise resolving when rendering is complete
   */
  async renderFile(pumlPath: string, outputPath?: string): Promise<void> {
    const pumlCode = fs.readFileSync(pumlPath, 'utf-8');
    const finalOutputPath = outputPath || pumlPath.replace(/\.puml$/, '.png');

    await this.render(pumlCode, finalOutputPath);
  }

  /**
   * Preprocess PlantUML code to apply default theme and background
   *
   * @private
   * @param code - PlantUML source code
   * @returns Preprocessed PlantUML code
   */
  private preprocessCode(code: string): string {
    const lines = code.split('\n');
    const processed: string[] = [];
    let hasTheme = false;
    let hasBackgroundColor = false;

    for (const line of lines) {
      // Check if theme is already set
      if (line.trim().startsWith('!theme')) {
        hasTheme = true;
      }
      // Check if background color is already set
      if (line.trim().startsWith('skinparam backgroundColor')) {
        hasBackgroundColor = true;
      }
      processed.push(line);
    }

    // Insert theme after @startuml if not present
    if (!hasTheme) {
      const startIdx = processed.findIndex(l => l.trim().startsWith('@startuml'));
      if (startIdx !== -1 && !processed[startIdx + 1]?.trim().startsWith('!theme')) {
        processed.splice(startIdx + 1, 0, `!theme ${this.config.theme || this.defaultConfig.theme}`);
      }
    }

    // Insert background color after theme if not present
    if (!hasBackgroundColor) {
      const themeIdx = processed.findIndex(l => l.trim().startsWith('!theme'));
      if (themeIdx !== -1 && !processed[themeIdx + 1]?.trim().startsWith('skinparam backgroundColor')) {
        processed.splice(
          themeIdx + 1,
          0,
          `skinparam backgroundColor ${this.config.backgroundColor || this.defaultConfig.backgroundColor}`
        );
      }
    }

    return processed.join('\n');
  }
}
