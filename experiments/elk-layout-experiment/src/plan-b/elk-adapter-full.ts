// Full ELK implementation using the real elkjs library
import ELK, { ElkNode } from 'elkjs';

const elk = new ELK();

export interface LayoutResult {
  layout: ElkNode;
  width: number;
  height: number;
  success: boolean;
  error?: string;
}

/**
 * Perform ELK layout on a graph using the full elkjs library
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

    // Perform layout with full ELK
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
 * Test multiple layout configurations with full ELK
 */
export async function testLayoutConfigurations(
  graph: ElkNode,
  aspectRatios: number[] = [0.5, 1.0, 1.5, 2.0],
  directions: Array<'DOWN' | 'RIGHT'> = ['DOWN', 'RIGHT']
): Promise<Array<{ config: Record<string, string>; result: LayoutResult }>> {
  const results: Array<{ config: Record<string, string>; result: LayoutResult }> = [];

  for (const ratio of aspectRatios) {
    for (const direction of directions) {
      const options: Record<string, string> = {
        'elk.aspectRatio': ratio.toString(),
        'elk.direction': direction,
        'elk.algorithm': 'layered',
        // Additional ELK options for better layout
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.layered.cycleBreaking.strategy': 'GREEDY',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.considerModelOrder.strategy': 'PREFER_EDGES',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONSTRAINT_LOCKING'
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
