// Note: elkjs has compatibility issues with Node.js ESM
// We'll use a workaround by creating a simpler ELK-like layout
import { ElkNode } from 'elkjs';

// Simple mock ELK implementation for testing
class SimpleELK {
  async layout(graph: ElkNode, options?: Record<string, string>): Promise<ElkNode> {
    // Apply layout options
    if (options && graph) {
      graph.layoutOptions = {
        ...graph.layoutOptions,
        ...options
      };
    }

    // Simple layered layout algorithm
    if (graph.children) {
      const direction = graph.layoutOptions?.['elk.direction'] || 'DOWN';
      const aspectRatio = parseFloat(graph.layoutOptions?.['elk.aspectRatio'] || '1.5');

      let x = 20;
      let y = 20;
      const nodeWidth = 150;
      const nodeHeight = 100;
      const spacing = 50;

      if (direction === 'RIGHT') {
        // Horizontal layout
        const colsPerRow = Math.max(1, Math.floor(aspectRatio));
        let maxX = 20;
        let maxY = 20;

        graph.children.forEach((node, idx) => {
          node.x = x;
          node.y = y;
          node.width = nodeWidth;
          node.height = nodeHeight;

          // 追踪实际的最大坐标
          maxX = Math.max(maxX, x + nodeWidth);
          maxY = Math.max(maxY, y + nodeHeight);

          x += nodeWidth + spacing;

          // Start new row if too wide
          if (idx > 0 && idx % colsPerRow === 0) {
            x = 20;
            y += nodeHeight + spacing;
          }
        });

        // ✅ 修复：使用实际的最大坐标，加上 padding
        graph.width = maxX + 20;
        graph.height = maxY + 20;
      } else {
        // Vertical layout (DOWN) - 需要考虑每个节点的实际高度
        const cols = Math.max(1, Math.ceil(Math.sqrt(graph.children.length * aspectRatio)));
        let maxX = 20;
        let maxY = 20;

        // 记录每一行的最大高度，用于计算下一行的Y坐标
        const rowMaxHeights: number[] = [];

        graph.children.forEach((node, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          const actualNodeHeight = node.height || 100;

          // 计算当前行的最大高度
          rowMaxHeights[row] = Math.max(rowMaxHeights[row] || 0, actualNodeHeight);

          // 计算Y坐标：累加前面所有行的高度
          let yPos = 20;
          for (let i = 0; i < row; i++) {
            yPos += (rowMaxHeights[i] || 100) + spacing;
          }

          node.x = 20 + col * (nodeWidth + spacing);
          node.y = yPos;
          node.width = nodeWidth;
          node.height = actualNodeHeight;

          // 追踪实际的最大坐标
          maxX = Math.max(maxX, node.x + nodeWidth);
          maxY = Math.max(maxY, yPos + actualNodeHeight);
        });

        // ✅ 修复：使用实际的最大坐标，加上 padding
        graph.width = maxX + 20;
        graph.height = maxY + 20;
      }
    }

    return graph;
  }
}

const elk = new SimpleELK();

export interface LayoutResult {
  layout: ElkNode;
  width: number;
  height: number;
  success: boolean;
  error?: string;
}

/**
 * Perform ELK layout on a graph
 */
export async function layoutGraph(
  graph: ElkNode,
  options: Record<string, string> = {}
): Promise<LayoutResult> {
  try {
    // Apply layout options
    if (Object.keys(options).length > 0) {
      graph.layoutOptions = {
        ...graph.layoutOptions,
        ...options
      };
    }

    // Perform layout
    const layoutedGraph = await elk.layout(graph);

    if (!layoutedGraph) {
      throw new Error('ELK layout returned null');
    }

    const width = layoutedGraph.width || 0;
    const height = layoutedGraph.height || 0;

    return {
      layout: layoutedGraph,
      width,
      height,
      success: true
    };
  } catch (error) {
    return {
      layout: { id: 'error' },
      width: 0,
      height: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test multiple layout configurations
 */
export async function testLayoutConfigurations(
  graph: ElkNode,
  aspectRatios: number[] = [0.5, 1.0, 1.5, 2.0],
  directions: Array<'DOWN' | 'RIGHT'> = ['DOWN', 'RIGHT']
): Promise<Array<{ config: Record<string, string>; result: LayoutResult }>> {
  const results: Array<{ config: Record<string, string>; result: LayoutResult }> = [];

  for (const ratio of aspectRatios) {
    for (const direction of directions) {
      const options = {
        'elk.aspectRatio': ratio.toString(),
        'elk.direction': direction,
        'elk.algorithm': 'layered'
      };

      const result = await layoutGraph(JSON.parse(JSON.stringify(graph)), options);
      results.push({ config: options, result });
    }
  }

  return results;
}

/**
 * Find best layout based on aspect ratio target
 */
export function findBestLayout(
  testResults: Array<{ config: Record<string, string>; result: LayoutResult }>,
  targetAspectRatio: number = 1.5
): { config: Record<string, string>; result: LayoutResult } | null {
  const successful = testResults.filter(t => t.result.success);

  if (successful.length === 0) return null;

  // Find layout closest to target aspect ratio
  let best = successful[0];
  let minDiff = Math.abs((best.result.width / best.result.height) - targetAspectRatio);

  for (const test of successful) {
    const actualRatio = test.result.width / test.result.height;
    const diff = Math.abs(actualRatio - targetAspectRatio);

    if (diff < minDiff) {
      minDiff = diff;
      best = test;
    }
  }

  return best;
}
