import YAML from 'yaml';

export interface ELKConfig {
  layout?: string;
  elk?: {
    nodePlacementStrategy?: string;
    cycleBreakingStrategy?: string;
    aspectRatio?: number;
    direction?: string;
    algorithm?: string;
  };
}

/**
 * Add YAML frontmatter to Mermaid code
 */
export function addYAMLFrontmatter(mermaidCode: string, elkConfig: ELKConfig = {}): string {
  const yaml = `---
${YAML.stringify({ config: elkConfig }).trim()}
---

${mermaidCode}`;

  return yaml;
}

/**
 * Generate default ELK config for testing
 */
export function generateDefaultELKConfig(): ELKConfig {
  return {
    layout: 'elk',
    elk: {
      nodePlacementStrategy: 'NETWORK_SIMPLEX',
      cycleBreakingStrategy: 'GREEDY',
      aspectRatio: 1.5,
      direction: 'DOWN',
      algorithm: 'layered'
    }
  };
}

/**
 * Generate config with specific aspect ratio
 */
export function generateAspectRatioConfig(aspectRatio: number): ELKConfig {
  return {
    layout: 'elk',
    elk: {
      aspectRatio,
      direction: aspectRatio > 1 ? 'RIGHT' : 'DOWN'
    }
  };
}

/**
 * Generate config with different strategies
 */
export function generateStrategyConfig(
  nodePlacement: string = 'NETWORK_SIMPLEX',
  cycleBreaking: string = 'GREEDY'
): ELKConfig {
  return {
    layout: 'elk',
    elk: {
      nodePlacementStrategy: nodePlacement,
      cycleBreakingStrategy: cycleBreaking,
      direction: 'DOWN',
      algorithm: 'layered'
    }
  };
}
