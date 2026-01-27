import fs from 'fs-extra';
import { parseString } from 'xml2js';

export interface LayoutMetrics {
  width: number;
  height: number;
  aspectRatio: number;
  viewBox?: string;
}

export interface TestResult {
  filename: string;
  plan: 'A' | 'B';
  svgSize: LayoutMetrics;
  pngSize: { width: number; height: number };
  aspectRatioRatio: number; // width/height
  renderTime: number;
  success: boolean;
  error?: string;
}

/**
 * Calculate aspect ratio from SVG dimensions
 */
export function calculateAspectRatio(width: number, height: number): number {
  if (height === 0) return Infinity;
  return width / height;
}

/**
 * Parse SVG file and extract dimensions
 */
export async function parseSvgMetrics(svgPath: string): Promise<LayoutMetrics> {
  const svgContent = await fs.readFile(svgPath, 'utf-8');
  const xml2js = await import('xml2js');
  const parser = new xml2js.Parser();

  try {
    const result = await parser.parseStringPromise(svgContent);
    const svg = result.svg;

    if (!svg) {
      throw new Error('Invalid SVG: no root svg element');
    }

    const width = parseDimension(svg.$?.width || svg.$?.['view-box']?.split(' ')[2] || '0');
    const height = parseDimension(svg.$?.height || svg.$?.['view-box']?.split(' ')[3] || '0');

    return {
      width,
      height,
      aspectRatio: calculateAspectRatio(width, height),
      viewBox: svg.$?.viewBox
    };
  } catch (error) {
    // Fallback: try regex parsing
    const widthMatch = svgContent.match(/width="([^"]+)"/);
    const heightMatch = svgContent.match(/height="([^"]+)"/);

    const width = widthMatch ? parseDimension(widthMatch[1]) : 0;
    const height = heightMatch ? parseDimension(heightMatch[1]) : 0;

    return {
      width,
      height,
      aspectRatio: calculateAspectRatio(width, height)
    };
  }
}

/**
 * Parse dimension string (e.g., "100px", "100", "10cm")
 */
function parseDimension(dim: string): number {
  if (!dim) return 0;
  const match = dim.match(/^([\d.]+)(px|cm|mm|in|pt|pc)?$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2] || 'px';

  // Convert to pixels (simplified)
  const unitFactors: Record<string, number> = {
    px: 1,
    cm: 37.8,
    mm: 3.78,
    in: 96,
    pt: 1.33,
    pc: 16
  };

  return value * (unitFactors[unit] || 1);
}

/**
 * Parse PNG dimensions using sharp
 */
export async function parsePngMetrics(pngPath: string): Promise<{ width: number; height: number }> {
  const sharp = await import('sharp');
  const metadata = await sharp.default(pngPath).metadata();

  return {
    width: metadata.width || 0,
    height: metadata.height || 0
  };
}

/**
 * Check if aspect ratio is within acceptable range (0.5:1 to 2:1)
 */
export function isAspectRatioAcceptable(ratio: number): boolean {
  return ratio >= 0.5 && ratio <= 2.0;
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: LayoutMetrics): string {
  return `${metrics.width}×${metrics.height}px (ratio: ${metrics.aspectRatio.toFixed(2)}:1)`;
}

/**
 * Save test result as JSON
 */
export async function saveTestResult(result: TestResult, outputPath: string): Promise<void> {
  await fs.ensureDir(outputPath);
  const resultPath = `${outputPath}/${result.filename}-${result.plan}-result.json`;
  await fs.writeJSON(resultPath, result, { spaces: 2 });
}
