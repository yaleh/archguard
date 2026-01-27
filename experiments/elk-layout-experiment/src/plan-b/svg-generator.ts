import fs from 'fs-extra';
import * as path from 'path';
import sharp from 'sharp';
import { ElkNode } from 'elkjs';

export interface SVGGenerationOptions {
  outputDir: string;
  filename: string;
  nodeWidth?: number;
  nodeHeight?: number;
  fontSize?: number;
  padding?: number;
  theme?: 'light' | 'dark';
}

/**
 * Generate SVG from ELK layout with full class details
 */
export async function generateSVGFromELK(
  layoutedGraph: ElkNode,
  options: SVGGenerationOptions
): Promise<{ svgPath: string; pngPath: string; svgContent: string; success: boolean; error?: string }> {
  const {
    outputDir,
    filename,
    nodeWidth = 200,  // 增加宽度以容纳属性和方法
    fontSize = 11,
    padding = 10,
    theme = 'light'
  } = options;

  try {
    await fs.ensureDir(outputDir);

    // Calculate graph dimensions
    const graphWidth = layoutedGraph.width || 800;
    const graphHeight = layoutedGraph.height || 600;

    // Colors based on theme
    const colors = theme === 'light'
      ? {
        background: '#ffffff',
        nodeFill: '#e1f5fe',
        nodeStroke: '#01579b',
        text: '#333333',
        textSecondary: '#666666',
        edge: '#666666',
        separator: '#01579b'
      }
      : {
        background: '#1e1e1e',
        nodeFill: '#2d2d2d',
        nodeStroke: '#4a90e2',
        text: '#e0e0e0',
        textSecondary: '#b0b0b0',
        edge: '#888888',
        separator: '#4a90e2'
      };

    // First pass: Calculate actual node heights based on content
    const nodeHeights = new Map<string, number>();
    if (layoutedGraph.children) {
      for (const node of layoutedGraph.children) {
        const properties = (node as any).properties;
        let fields: string[] = [];
        let methods: string[] = [];

        if (properties?.fields && typeof properties.fields === 'string') {
          try {
            const parsedFields = JSON.parse(properties.fields);
            fields = parsedFields.map((f: any) => `${f.visibility} ${f.name}: ${f.type}`);
          } catch {
            fields = properties.fields.split('\n');
          }
        }

        if (properties?.methods && typeof properties.methods === 'string') {
          try {
            const parsedMethods = JSON.parse(properties.methods);
            methods = parsedMethods.map((m: any) => {
              const visibility = m.visibility || '+';
              const asyncKeyword = m.name === 'constructor' ? '' : (m.params?.includes('async') ? 'async ' : '');
              const params = m.params || '';
              const returnType = m.returnType && m.returnType !== 'void' ? `: ${m.returnType}` : '';
              return `${visibility} ${asyncKeyword}${m.name}(${params})${returnType}`;
            });
          } catch {
            methods = properties.methods.split('\n');
          }
        }

        const nameHeight = 25;
        const lineHeight = 16;
        const fieldHeight = fields.length * lineHeight;
        const methodHeight = methods.length * lineHeight;
        const separatorHeight = (fields.length > 0 ? 1 : 0) + (methods.length > 0 && fields.length > 0 ? 1 : 0);
        const totalContentHeight = nameHeight + fieldHeight + methodHeight + separatorHeight + padding * 2;
        const actualHeight = Math.max(100, totalContentHeight);

        nodeHeights.set(node.id, actualHeight);
        node.height = actualHeight;
      }
    }

    // Recalculate graph dimensions
    const maxY = layoutedGraph.children?.reduce((max, node) => {
      const y = node.y || 0;
      const height = node.height || 100;
      return Math.max(max, y + height);
    }, 0) || graphHeight;

    const finalHeight = Math.max(graphHeight, maxY + padding);
    const finalWidth = layoutedGraph.children?.reduce((max, node) => {
      const x = node.x || 0;
      const width = node.width || nodeWidth;
      return Math.max(max, x + width);
    }, 0) || graphWidth;

    // Build SVG content
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${finalHeight}" viewBox="0 0 ${finalWidth} ${finalHeight}">`;

    // Background
    svgContent += `\n  <rect width="100%" height="100%" fill="${colors.background}"/>`;

    // Edges - render after we have the correct heights
    if (layoutedGraph.edges) {
      for (const edge of layoutedGraph.edges) {
        const sourceId = edge.sources?.[0];
        const targetId = edge.targets?.[0];

        if (!sourceId || !targetId) continue;

        const sourceNode = layoutedGraph.children?.find(n => n.id === sourceId);
        const targetNode = layoutedGraph.children?.find(n => n.id === targetId);

        if (!sourceNode || !targetNode) continue;

        const sourceX = (sourceNode.x || 0) + (sourceNode.width || nodeWidth) / 2;
        const sourceY = (sourceNode.y || 0) + (nodeHeights.get(sourceId) || 100) / 2;
        const targetX = (targetNode.x || 0) + (targetNode.width || nodeWidth) / 2;
        const targetY = (targetNode.y || 0) + (nodeHeights.get(targetId) || 100) / 2;

        svgContent += `\n  <line x1="${sourceX}" y1="${sourceY}" x2="${targetX}" y2="${targetY}" stroke="${colors.edge}" stroke-width="2" marker-end="url(#arrowhead)"/>`;
      }
    }

    // Arrowhead marker
    svgContent += '\n  <defs>';
    svgContent += `\n    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto">`;
    svgContent += `\n      <polygon points="0 0, 10 3, 0 6" fill="${colors.edge}"/>`;
    svgContent += '\n    </marker>';
    svgContent += '\n  </defs>';

    // Nodes with full class details
    if (layoutedGraph.children) {
      for (const node of layoutedGraph.children) {
        const x = node.x || 0;
        const y = node.y || 0;
        const width = node.width || nodeWidth;
        const actualHeight = nodeHeights.get(node.id) || 100;
        const label = node.labels?.[0]?.text || node.id;

        // Get class details from properties
        const properties = (node as any).properties;

        // Parse fields and methods
        let fields: string[] = [];
        let methods: string[] = [];

        if (properties?.fields && typeof properties.fields === 'string') {
          try {
            const parsedFields = JSON.parse(properties.fields);
            fields = parsedFields.map((f: any) => `${f.visibility} ${f.name}: ${f.type}`);
          } catch {
            fields = properties.fields.split('\n');
          }
        }

        if (properties?.methods && typeof properties.methods === 'string') {
          try {
            const parsedMethods = JSON.parse(properties.methods);
            methods = parsedMethods.map((m: any) => {
              const visibility = m.visibility || '+';
              const asyncKeyword = m.name === 'constructor' ? '' : (m.params?.includes('async') ? 'async ' : '');
              const params = m.params || '';
              const returnType = m.returnType && m.returnType !== 'void' ? `: ${m.returnType}` : '';
              return `${visibility} ${asyncKeyword}${m.name}(${params})${returnType}`;
            });
          } catch {
            methods = properties.methods.split('\n');
          }
        }

        // Node rectangle
        svgContent += `\n  <rect x="${x}" y="${y}" width="${width}" height="${actualHeight}" fill="${colors.nodeFill}" stroke="${colors.nodeStroke}" stroke-width="2" rx="5"/>`;

        // Class name
        svgContent += `\n  <text x="${x + width / 2}" y="${y + 18}" font-size="${fontSize + 1}" font-weight="bold" fill="${colors.text}" text-anchor="middle">${label}</text>`;

        const nameHeight = 25;
        const lineHeight = 16;
        let currentY = y + nameHeight + padding;

        // Separator line after class name
        if (fields.length > 0 || methods.length > 0) {
          svgContent += `\n  <line x1="${x + 5}" y1="${currentY}" x2="${x + width - 5}" y2="${currentY}" stroke="${colors.separator}" stroke-width="1"/>`;
          currentY += 3;
        }

        // Fields
        for (const field of fields) {
          svgContent += `\n  <text x="${x + 8}" y="${currentY}" font-size="${fontSize - 1}" fill="${colors.textSecondary}">${field}</text>`;
          currentY += lineHeight;
        }

        // Separator line between fields and methods
        if (fields.length > 0 && methods.length > 0) {
          svgContent += `\n  <line x1="${x + 5}" y1="${currentY}" x2="${x + width - 5}" y2="${currentY}" stroke="${colors.separator}" stroke-width="1"/>`;
          currentY += 3;
        }

        // Methods
        for (const method of methods) {
          // Truncate long method signatures
          let displayMethod = method;
          if (displayMethod.length > 35) {
            displayMethod = displayMethod.substring(0, 32) + '...';
          }
          svgContent += `\n  <text x="${x + 8}" y="${currentY}" font-size="${fontSize - 1}" fill="${colors.textSecondary}">${displayMethod}</text>`;
          currentY += lineHeight;
        }
      }
    }

    svgContent += '\n</svg>';

    // Save SVG
    const svgPath = path.join(outputDir, `${filename}.svg`);
    await fs.writeFile(svgPath, svgContent);

    // Convert to PNG
    const pngPath = path.join(outputDir, `${filename}.png`);

    try {
      const svgBuffer = Buffer.from(svgContent);
      await sharp(svgBuffer)
        .png()
        .toFile(pngPath);
    } catch (pngError) {
      console.warn(`Could not convert to PNG: ${pngError}`);
    }

    return {
      svgPath,
      pngPath,
      svgContent,
      success: true
    };
  } catch (error) {
    return {
      svgPath: '',
      pngPath: '',
      svgContent: '',
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Estimate node size based on content
 */
export function estimateNodeSize(
  label: string,
  methods: number = 0,
  fields: number = 0,
  fontSize: number = 14
): { width: number; height: number } {
  const baseWidth = Math.max(120, label.length * fontSize * 0.6);
  const baseHeight = 50;

  const additionalHeight = (methods + fields) * (fontSize + 4);

  return {
    width: baseWidth,
    height: baseHeight + additionalHeight
  };
}
