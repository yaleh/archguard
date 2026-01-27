/**
 * Isomorphic Mermaid Renderer
 * Renders Mermaid diagrams to SVG and PNG using isomorphic-mermaid and sharp
 */

import fs from 'fs-extra';
import path from 'path';
import mermaid from 'isomorphic-mermaid';
import sharp from 'sharp';
import type {
  MermaidRendererOptions,
  MermaidOutputPaths,
} from './types.js';

/**
 * Renderer for Mermaid diagrams supporting SVG and PNG output
 */
export class IsomorphicMermaidRenderer {
  private readonly options: Required<MermaidRendererOptions>;
  private initialized = false;

  constructor(options?: Partial<MermaidRendererOptions>) {
    this.options = {
      format: options?.format ?? 'svg',
      theme: options?.theme ?? { name: 'default' },
      backgroundColor: options?.backgroundColor ?? 'white',
      width: options?.width ?? 2000,
      height: options?.height ?? 2000,
    };
  }

  /**
   * Render Mermaid code to SVG string
   */
  async renderSVG(mermaidCode: string): Promise<string> {
    this.ensureInitialized();

    try {
      // Generate SVG from Mermaid code
      const { svg } = await mermaid.render(this.generateId(), mermaidCode);

      // Add background color to SVG root element (if not transparent)
      if (this.options.backgroundColor !== 'transparent') {
        // Check if the SVG already has a style attribute
        const styleMatch = svg.match(/<svg[^>]*style="([^"]*)"/);

        if (styleMatch) {
          // SVG already has a style attribute, append background-color to it
          return svg.replace(
            /(<svg[^>]*style=")([^"]*)(")/,
            `$1$2; background-color: ${this.options.backgroundColor};$3`
          );
        } else {
          // SVG doesn't have a style attribute, add one
          return svg.replace(
            /<svg/,
            `<svg style="background-color: ${this.options.backgroundColor};"`
          );
        }
      }

      return svg;
    } catch (error) {
      throw new Error(
        `Failed to render SVG: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Render Mermaid code to PNG file
   */
  async renderPNG(mermaidCode: string, outputPath: string): Promise<void> {
    try {
      // First render to SVG
      const svg = await this.renderSVG(mermaidCode);

      // Convert SVG to PNG using sharp
      const svgBuffer = Buffer.from(svg);

      // Ensure output directory exists
      await fs.ensureDir(path.dirname(outputPath));

      // Use sharp to convert SVG to PNG
      const pipeline = sharp(svgBuffer, {
        density: 150, // DPI for better quality
      }).resize(this.options.width, this.options.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });

      // Add solid background if not transparent
      if (this.options.backgroundColor !== 'transparent') {
        pipeline.flatten({
          background: this.parseBackgroundColor(this.options.backgroundColor),
        });
      }

      await pipeline.png().toFile(outputPath);
    } catch (error) {
      throw new Error(
        `Failed to render PNG to ${outputPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Render and save Mermaid diagram in all formats
   */
  async renderAndSave(mermaidCode: string, paths: MermaidOutputPaths): Promise<void> {
    try {
      // Ensure output directories exist
      await fs.ensureDir(path.dirname(paths.mmd));
      await fs.ensureDir(path.dirname(paths.svg));
      await fs.ensureDir(path.dirname(paths.png));

      // Save .mmd (Mermaid source)
      await fs.writeFile(paths.mmd, mermaidCode, 'utf-8');

      // Render and save SVG
      const svg = await this.renderSVG(mermaidCode);
      await fs.writeFile(paths.svg, svg, 'utf-8');

      // Render and save PNG
      await this.renderPNG(mermaidCode, paths.png);
    } catch (error) {
      throw new Error(
        `Failed to render and save: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Ensure mermaid is initialized with config
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      const config = {
        startOnLoad: false,
        theme: this.options.theme.name ?? 'default',
        securityLevel: 'loose' as const,
        themeVariables: this.options.theme.variables,
      };

      mermaid.initialize(config);
      this.initialized = true;
    }
  }

  /**
   * Generate unique ID for mermaid rendering
   */
  private generateId(): string {
    return `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current renderer options
   */
  getOptions(): MermaidRendererOptions {
    return { ...this.options };
  }

  /**
   * Update renderer options
   */
  setOptions(options: Partial<MermaidRendererOptions>): void {
    if (options.format !== undefined) {
      this.options.format = options.format;
    }
    if (options.theme !== undefined) {
      this.options.theme = options.theme;
    }
    if (options.backgroundColor !== undefined) {
      this.options.backgroundColor = options.backgroundColor;
    }
    if (options.width !== undefined) {
      this.options.width = options.width;
    }
    if (options.height !== undefined) {
      this.options.height = options.height;
    }

    // Re-initialize mermaid with new options
    if (this.initialized) {
      this.initialized = false;
      this.ensureInitialized();
    }
  }

  /**
   * Parse background color string to format accepted by Sharp
   */
  private parseBackgroundColor(color: string): string {
    // If already in rgb/rgba format, return as-is
    if (color.startsWith('rgb')) {
      return color;
    }

    // Named colors - map common colors
    const namedColors: Record<string, string> = {
      white: '#FFFFFF',
      black: '#000000',
      red: '#FF0000',
      green: '#00FF00',
      blue: '#0000FF',
      yellow: '#FFFF00',
      cyan: '#00FFFF',
      magenta: '#FF00FF',
      gray: '#808080',
      grey: '#808080',
      lightgray: '#D3D3D3',
      lightgrey: '#D3D3D3',
      darkgray: '#A9A9A9',
      darkgrey: '#A9A9A9',
    };

    const lowerColor = color.toLowerCase();
    if (namedColors[lowerColor]) {
      return namedColors[lowerColor];
    }

    // Return as-is (hex format or other)
    return color;
  }
}
