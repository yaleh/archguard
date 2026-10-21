import type { ArchJSON } from '@/types/index.js';
import type { DiagramConfig } from '@/types/config.js';
import type { DiagramFormat, DiagramOutputOptions, RenderJob } from './renderer-types.js';

export type { DiagramFormat, DiagramOutputOptions, RenderJob };

/**
 * Minimal interface for diagram generation used by CLI processors.
 * Decouples CLI layer from the concrete MermaidDiagramGenerator class.
 */
export interface IRendererFacade {
  generateOnly(
    archJson: ArchJSON,
    outputOptions: DiagramOutputOptions,
    level: string,
    diagramConfig?: DiagramConfig
  ): Promise<RenderJob[]>;
}
