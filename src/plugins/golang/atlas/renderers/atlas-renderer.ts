import type { GoArchitectureAtlas, AtlasLayer, RenderFormat, RenderResult } from '../types.js';
import { MermaidTemplates } from './mermaid-templates.js';

export class AtlasRenderer {
  render(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: RenderFormat
  ): Promise<RenderResult> {
    if (layer === 'all') {
      const parts: string[] = [];
      if (atlas.layers.package)
        parts.push(MermaidTemplates.renderPackageGraph(atlas.layers.package));
      if (atlas.layers.capability)
        parts.push(MermaidTemplates.renderCapabilityGraph(atlas.layers.capability));
      if (atlas.layers.goroutine)
        parts.push(MermaidTemplates.renderGoroutineTopology(atlas.layers.goroutine));
      if (atlas.layers.flow) parts.push(MermaidTemplates.renderFlowGraph(atlas.layers.flow));

      return Promise.resolve({ content: parts.join('\n---\n'), format, layer });
    }

    switch (format) {
      case 'mermaid':
        return Promise.resolve(this.renderMermaid(atlas, layer));
      case 'json':
        return Promise.resolve(this.renderJson(atlas, layer));
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private renderMermaid(atlas: GoArchitectureAtlas, layer: AtlasLayer): RenderResult {
    let content: string;
    switch (layer) {
      case 'package':
        if (!atlas.layers.package) throw new Error('Package layer not available');
        content = MermaidTemplates.renderPackageGraph(atlas.layers.package);
        break;
      case 'capability':
        if (!atlas.layers.capability) throw new Error('Capability layer not available');
        content = MermaidTemplates.renderCapabilityGraph(atlas.layers.capability);
        break;
      case 'goroutine':
        if (!atlas.layers.goroutine) throw new Error('Goroutine layer not available');
        content = MermaidTemplates.renderGoroutineTopology(atlas.layers.goroutine);
        break;
      case 'flow':
        if (!atlas.layers.flow) throw new Error('Flow layer not available');
        content = MermaidTemplates.renderFlowGraph(atlas.layers.flow);
        break;
      default:
        throw new Error(`Unknown layer: ${layer}`);
    }
    return { content, format: 'mermaid', layer };
  }

  private renderJson(atlas: GoArchitectureAtlas, layer: AtlasLayer): RenderResult {
    const layerData =
      layer !== 'all' ? atlas.layers[layer as Exclude<AtlasLayer, 'all'>] : atlas.layers;
    return {
      content: JSON.stringify(layerData, null, 2),
      format: 'json',
      layer,
    };
  }
}
