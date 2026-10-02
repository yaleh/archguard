import type { ArchJSON } from '@/types/index.js';
import type { DiagramConfig } from '@/types/config.js';
import type { MermaidOutputOptions, RenderJob } from './renderer-types.js';

export type { MermaidOutputOptions, RenderJob };

/**
 * Minimal interface for Mermaid diagram generation used by CLI processors.
 * Decouples CLI layer from the concrete MermaidDiagramGenerator class.
 */
export interface IRendererFacade {
  generateOnly(
    archJson: ArchJSON,
    outputOptions: MermaidOutputOptions,
    level: string,
    diagramConfig?: DiagramConfig
  ): Promise<RenderJob[]>;
}
