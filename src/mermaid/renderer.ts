/**
 * Isomorphic Mermaid Renderer
 * Renders Mermaid diagrams to SVG and PNG using isomorphic-mermaid and sharp
 */

import fs from 'fs-extra';
import path from 'path';
import mermaid from 'isomorphic-mermaid';
import sharp from 'sharp';
import type { MermaidRendererOptions, MermaidOutputPaths } from './types.js';

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

      // Parse SVG viewBox to get dimensions
      const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
      let density = 300; // Default high DPI
      let resizeWidth: number | undefined;
      let resizeHeight: number | undefined;
      const maxPixels = 32767; // Sharp's maximum dimension limit

      if (viewBoxMatch) {
        const [, , vbWidth, vbHeight] = viewBoxMatch[1].split(/\s+/).map(Number);
        const svgWidth = vbWidth || 0;
        const svgHeight = vbHeight || 0;

        // Calculate estimated output size at 300 DPI
        // SVG default is 72 DPI, so 300 DPI is ~4.17x scaling
        const estimatedWidth = svgWidth * (300 / 72);
        const estimatedHeight = svgHeight * (300 / 72);

        // If SVG viewBox itself exceeds limit, we need to scale it down
        if (svgWidth > maxPixels || svgHeight > maxPixels) {
          const scale = Math.min(maxPixels / svgWidth, maxPixels / svgHeight);
          resizeWidth = Math.floor(svgWidth * scale);
          resizeHeight = Math.floor(svgHeight * scale);
          density = 72; // Use base DPI to avoid further scaling
        }
        // If estimated size exceeds limit, reduce DPI
        else if (estimatedWidth > maxPixels || estimatedHeight > maxPixels) {
          const maxDimension = Math.max(svgWidth, svgHeight);
          // Calculate DPI that keeps within limit (with some margin)
          density = Math.floor(((maxPixels * 0.9) / maxDimension) * 72);
          // Ensure minimum DPI of 72 for reasonable quality
          density = Math.max(72, Math.min(300, density));
        }
      }

      // Use sharp to convert SVG to PNG with adaptive DPI
      let pipeline = sharp(svgBuffer, { density });

      // Apply resize if needed for oversized SVGs
      if (resizeWidth && resizeHeight) {
        pipeline = pipeline.resize(resizeWidth, resizeHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

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
