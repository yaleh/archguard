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
 * Inlines fill:none on flowchart edge paths to work around librsvg's
 * limited CSS class-selector support (sharp uses librsvg for SVG→PNG).
 * Without this, <path class="... flowchart-link ..."> gets SVG default
 * fill (black) instead of the CSS-specified fill:none.
 */
export function inlineEdgeStyles(svg: string): string {
  // 1. Fix edge bezier path fills: flowchart-link paths have no inline fill:none,
  //    relying on CSS which librsvg (used by sharp) doesn't apply for ID-scoped selectors.
  let result = svg.replace(
    /(<path\b[^>]*class="[^"]*\bflowchart-link\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_, pre, style, post) => {
      if (/\bfill\s*:\s*none\b/.test(style)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      return `${pre}${trimmed ? trimmed + ';' : ''}fill:none;${post}`;
    }
  );

  // 2. Fix edge-label background rects: <rect class="background" style=""> have no
  //    inline fill, so librsvg renders them black instead of the CSS-intended transparent.
  //    Only patch rects that have an explicit (possibly empty) style attribute — rects
  //    without a style attribute are dimensionless placeholders and need no change.
  result = result.replace(
    /(<rect\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_, pre, style, post) => {
      if (/\bfill\s*:/.test(style)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      return `${pre}${trimmed ? trimmed + ';' : ''}fill:none;${post}`;
    }
  );

  return result;
}

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
      const svg = await this.renderSVG(mermaidCode);
      await this.convertSVGToPNG(svg, outputPath);
    } catch (error) {
      throw new Error(
        `Failed to render PNG to ${outputPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Convert an already-rendered SVG string to a PNG file.
   * Does NOT call renderSVG; the caller must supply the svg string.
   */
  async convertSVGToPNG(svg: string, outputPath: string): Promise<void> {
    const processed = inlineEdgeStyles(svg);
    const svgBuffer = Buffer.from(processed);
    await fs.ensureDir(path.dirname(outputPath));

    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    let density = 300;
    let resizeWidth: number | undefined;
    let resizeHeight: number | undefined;
    const maxPixels = 32767;

    if (viewBoxMatch) {
      const [, , vbWidth, vbHeight] = viewBoxMatch[1].split(/\s+/).map(Number);
      const svgWidth = vbWidth || 0;
      const svgHeight = vbHeight || 0;
      const estimatedWidth = svgWidth * (300 / 72);
      const estimatedHeight = svgHeight * (300 / 72);

      if (svgWidth > maxPixels || svgHeight > maxPixels) {
        const scale = Math.min(maxPixels / svgWidth, maxPixels / svgHeight);
        resizeWidth = Math.floor(svgWidth * scale);
        resizeHeight = Math.floor(svgHeight * scale);
        density = 72;
      } else if (estimatedWidth > maxPixels || estimatedHeight > maxPixels) {
        const maxDimension = Math.max(svgWidth, svgHeight);
        density = Math.floor(((maxPixels * 0.9) / maxDimension) * 72);
        density = Math.max(72, Math.min(300, density));
      }
    }

    let pipeline = sharp(svgBuffer, { density, limitInputPixels: false });
    const capWidth = resizeWidth ?? maxPixels;
    const capHeight = resizeHeight ?? maxPixels;
    pipeline = pipeline.resize(capWidth, capHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (this.options.backgroundColor !== 'transparent') {
      pipeline.flatten({
        background: this.parseBackgroundColor(this.options.backgroundColor),
      });
    }

    await pipeline.png().toFile(outputPath);
  }

  /**
   * Render and save Mermaid diagram in all formats
   */
  async renderAndSave(mermaidCode: string, paths: MermaidOutputPaths): Promise<void> {
    try {
      await Promise.all([
        fs.ensureDir(path.dirname(paths.mmd)),
        fs.ensureDir(path.dirname(paths.svg)),
        fs.ensureDir(path.dirname(paths.png)),
      ]);

      // Stage 1: write .mmd and render SVG concurrently (independent)
      const [svg] = await Promise.all([
        this.renderSVG(mermaidCode),
        fs.writeFile(paths.mmd, mermaidCode, 'utf-8'),
      ]);

      // Stage 2: write .svg and convert to PNG concurrently
      await Promise.all([
        fs.writeFile(paths.svg, svg, 'utf-8'),
        this.convertSVGToPNG(svg, paths.png),
      ]);
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
