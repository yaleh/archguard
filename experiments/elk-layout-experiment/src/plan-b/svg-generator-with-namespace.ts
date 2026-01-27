import fs from 'fs-extra';
import * as path from 'path';
import sharp from 'sharp';
import { ElkNode } from 'elkjs';

// ✅ Extend ElkNode to include custom properties
interface ExtendedElkNode extends ElkNode {
  properties?: {
    [key: string]: string;
  };
  children?: ExtendedElkNode[];
}

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
 * Generate SVG from ELK layout with namespace support
 */
export async function generateSVGFromELK(
  layoutedGraph: ExtendedElkNode,
  options: SVGGenerationOptions
): Promise<{ svgPath: string; pngPath: string; svgContent: string; success: boolean; error?: string }> {
  const {
    outputDir,
    filename,
    nodeWidth = 200,
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
        separator: '#01579b',
        namespaceFill: '#f5f5f5',
        namespaceStroke: '#9e9e9e',
        namespaceText: '#424242'
      }
      : {
        background: '#1e1e1e',
        nodeFill: '#2d2d2d',
        nodeStroke: '#4a90e2',
        text: '#e0e0e0',
        textSecondary: '#b0b0b0',
        edge: '#888888',
        separator: '#4a90e2',
        namespaceFill: '#252525',
        namespaceStroke: '#555555',
        namespaceText: '#b0b0b0'
      };

    // First pass: Separate namespace nodes from class nodes
    const namespaceNodes: ExtendedElkNode[] = [];
    const classNodes: ExtendedElkNode[] = [];
    const nodeHeights = new Map<string, number>();

    if (layoutedGraph.children) {
      for (const node of layoutedGraph.children) {
        const properties = (node as ExtendedElkNode).properties;
        const isNamespace = properties?.isNamespace === 'true';

        if (isNamespace) {
          namespaceNodes.push(node);
        } else {
          classNodes.push(node);

          // Calculate actual height for class nodes
          let fields: string[] = [];
          let methods: string[] = [];

          if (properties?.fields && typeof properties.fields === 'string') {
            try {
              const parsedFields = JSON.parse(properties.fields);
              fields = parsedFields.map((f: any) => `${f.visibility} ${f.name}: ${f.type}`);
            } catch {
              fields = [];
            }
          }

          if (properties?.methods && typeof properties.methods === 'string') {
            try {
              const parsedMethods = JSON.parse(properties.methods);
              methods = parsedMethods.map((m: any) => {
                const visibility = m.visibility || '+';
                const params = m.params || '';
                const returnType = m.returnType && m.returnType !== 'void' ? `: ${m.returnType}` : '';
                return `${visibility} ${m.name}(${params})${returnType}`;
              });
            } catch {
              methods = [];
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
        }
      }
    }

    // ✅ Use ELK-calculated namespace bounds directly
    // Namespace nodes already have position and size from ELK layout
    const namespaceBounds = new Map<string, { x: number; y: number; width: number; height: number }>();

    for (const nsNode of namespaceNodes) {
      const x = nsNode.x || 0;
      const y = nsNode.y || 0;
      const width = nsNode.width || 400;
      const height = nsNode.height || 300;

      namespaceBounds.set(nsNode.id, { x, y, width, height });
    }

    // Recalculate graph dimensions
    const maxY = Math.max(
      ...Array.from(namespaceBounds.values()).map(b => b.y + b.height),
      ...classNodes.map(node => (node.y || 0) + (nodeHeights.get(node.id) || 100))
    );

    const maxX = Math.max(
      ...Array.from(namespaceBounds.values()).map(b => b.x + b.width),
      ...classNodes.map(node => (node.x || 0) + (node.width || nodeWidth))
    );

    const finalHeight = Math.max(graphHeight, maxY + padding);
    const finalWidth = Math.max(graphWidth, maxX + padding);

    // Build SVG content
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${finalHeight}" viewBox="0 0 ${finalWidth} ${finalHeight}">`;

    // Background
    svgContent += `\n  <rect width="100%" height="100%" fill="${colors.background}"/>`;

    // Arrowhead marker
    svgContent += '\n  <defs>';
    svgContent += `\n    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto">`;
    svgContent += `\n      <polygon points="0 0, 10 3, 0 6" fill="${colors.edge}"/>`;
    svgContent += '\n    </marker>';
    svgContent += '\n  </defs>';

    // ✅ Draw namespace boxes first (behind everything)
    for (const nsNode of namespaceNodes) {
      const bounds = namespaceBounds.get(nsNode.id);
      if (!bounds) continue;

      const namespaceName = nsNode.properties?.namespaceName || nsNode.labels?.[0]?.text || nsNode.id;

      // Namespace rectangle with dashed border
      svgContent += `\n  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" ` +
        `fill="${colors.namespaceFill}" stroke="${colors.namespaceStroke}" stroke-width="2" stroke-dasharray="5,5" rx="8"/>`;

      // Namespace label
      svgContent += `\n  <text x="${bounds.x + bounds.width / 2}" y="${bounds.y + 15}" ` +
        `font-size="${fontSize + 2}" font-weight="bold" fill="${colors.namespaceText}" text-anchor="middle">${namespaceName}</text>`;
    }

    // Edges - need to handle both namespace children and standalone nodes
    if (layoutedGraph.edges) {
      for (const edge of layoutedGraph.edges) {
        const sourceId = edge.sources?.[0];
        const targetId = edge.targets?.[0];

        if (!sourceId || !targetId) continue;

        // Find source node (could be in namespace or standalone)
        let sourceNode = findNode(sourceId, namespaceNodes, classNodes);
        let targetNode = findNode(targetId, namespaceNodes, classNodes);

        if (!sourceNode || !targetNode) continue;

        // Calculate absolute positions
        const sourcePos = getAbsolutePosition(sourceNode, namespaceNodes, nodeHeights);
        const targetPos = getAbsolutePosition(targetNode, namespaceNodes, nodeHeights);

        const sourceX = sourcePos.x + (sourceNode.width || nodeWidth) / 2;
        const sourceY = sourcePos.y + sourcePos.height / 2;
        const targetX = targetPos.x + (targetNode.width || nodeWidth) / 2;
        const targetY = targetPos.y + targetPos.height / 2;

        svgContent += `\n  <line x1="${sourceX}" y1="${sourceY}" x2="${targetX}" y2="${targetY}" stroke="${colors.edge}" stroke-width="2" marker-end="url(#arrowhead)"/>`;
      }
    }

    // Helper function to find a node
    function findNode(nodeId: string, namespaceNodes: ExtendedElkNode[], classNodes: ExtendedElkNode[]): ExtendedElkNode | null {
      // Check in namespace children first
      for (const ns of namespaceNodes) {
        if (ns.children) {
          const found = ns.children.find(n => n.id === nodeId);
          if (found) return found;
        }
      }
      // Check in class nodes
      return classNodes.find(n => n.id === nodeId) || null;
    }

    // Helper function to get absolute position of a node
    function getAbsolutePosition(node: ExtendedElkNode, namespaceNodes: ExtendedElkNode[], nodeHeights: Map<string, number>): { x: number; y: number; width: number; height: number } {
      // First, check if this node is inside a namespace
      for (const ns of namespaceNodes) {
        if (ns.children && ns.children.some(child => child.id === node.id)) {
          // Node is inside this namespace - add namespace offset
          return {
            x: (ns.x || 0) + (node.x || 0),
            y: (ns.y || 0) + (node.y || 0),
            width: node.width || nodeWidth,
            height: nodeHeights.get(node.id) || 100
          };
        }
      }
      // Node is standalone
      return {
        x: node.x || 0,
        y: node.y || 0,
        width: node.width || nodeWidth,
        height: nodeHeights.get(node.id) || 100
      };
    }

    // Render all class nodes (both in namespaces and standalone)
    const allClassNodes: ExtendedElkNode[] = [];

    // Add nodes from namespaces
    for (const ns of namespaceNodes) {
      if (ns.children) {
        allClassNodes.push(...ns.children);
      }
    }
    // Add standalone nodes
    allClassNodes.push(...classNodes);

    for (const node of allClassNodes) {
      const pos = getAbsolutePosition(node, namespaceNodes, nodeHeights);
      const x = pos.x;
      const y = pos.y;
      const width = pos.width;
      const actualHeight = pos.height;
      const label = node.labels?.[0]?.text || node.id;

      // Get class details from properties
      const properties = (node as any).properties;

      // Parse fields and methods
      let fields: any[] = [];
      let methods: any[] = [];

      if (properties?.fields && typeof properties.fields === 'string') {
        try {
          fields = JSON.parse(properties.fields);
        } catch {
          fields = [];
        }
      }

      if (properties?.methods && typeof properties.methods === 'string') {
        try {
          methods = JSON.parse(properties.methods);
        } catch {
          methods = [];
        }
      }

      // Node rectangle
      svgContent += `\n  <rect x="${x}" y="${y}" width="${width}" height="${actualHeight}" fill="${colors.nodeFill}" stroke="${colors.nodeStroke}" stroke-width="2" rx="5"/>`;

      // Class name
      svgContent += `\n  <text x="${x + width / 2}" y="${y + 18}" font-size="${fontSize + 1}" font-weight="bold" fill="${colors.text}" text-anchor="middle">${label}</text>`;

      let currentY = y + 35;

      // Fields
      if (fields.length > 0) {
        for (const field of fields) {
          const fieldText = `${field.visibility} ${field.name}: ${field.type}`;
          // Truncate if too long
          const displayText = fieldText.length > 35 ? fieldText.substring(0, 32) + '...' : fieldText;
          svgContent += `\n  <text x="${x + 8}" y="${currentY}" font-size="${fontSize}" fill="${colors.textSecondary}" font-family="monospace">${displayText}</text>`;
          currentY += lineHeight;
        }
        currentY += 4; // Extra spacing before methods
      }

      // Separator line
      if (fields.length > 0 && methods.length > 0) {
        svgContent += `\n  <line x1="${x + 4}" y1="${currentY}" x2="${x + width - 4}" y2="${currentY}" stroke="${colors.separator}" stroke-width="1"/>`;
        currentY += 6;
      }

      // Methods
      if (methods.length > 0) {
        for (const method of methods) {
          const visibility = method.visibility || '+';
          const name = method.name;
          const params = method.params || '';
          const returnType = method.returnType && method.returnType !== 'void' ? `: ${method.returnType}` : '';
          const methodText = `${visibility} ${name}(${params})${returnType}`;
          // Truncate if too long
          const displayText = methodText.length > 35 ? methodText.substring(0, 32) + '...' : methodText;
          svgContent += `\n  <text x="${x + 8}" y="${currentY}" font-size="${fontSize}" fill="${colors.textSecondary}" font-family="monospace">${displayText}</text>`;
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
    const svgBuffer = Buffer.from(svgContent);

    await sharp(svgBuffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(pngPath);

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
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

const lineHeight = 16;
