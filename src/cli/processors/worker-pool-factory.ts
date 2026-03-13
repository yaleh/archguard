/**
 * WorkerPoolFactory — encapsulates pool-sizing formula and MermaidRenderWorkerPool creation.
 *
 * Extracted from DiagramProcessor.processAll() pool-sizing block (Plan 34 – Phase A2).
 *
 * @module cli/processors/worker-pool-factory
 */

import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import os from 'os';

/**
 * WorkerPoolFactory
 *
 * Creates a correctly-sized MermaidRenderWorkerPool based on the diagram set
 * and global configuration.
 *
 * Pool-sizing formula:
 *   effectiveDiagramCount = max(diagrams.length, atlasLayerCount)
 *   poolSize = max(1, min(cpus - 1, effectiveDiagramCount, 4))
 *
 * For single Go Atlas diagrams, the effective count uses the layer count (default 4)
 * so that all four Atlas layers can be rendered concurrently.
 */
export class WorkerPoolFactory {
  /**
   * Create a MermaidRenderWorkerPool sized for the given diagrams.
   *
   * @param diagrams     - The diagrams to be processed in this run.
   * @param globalConfig - Global configuration (theme, transparentBackground).
   * @returns A new MermaidRenderWorkerPool (not yet started).
   */
  create(diagrams: DiagramConfig[], globalConfig: GlobalConfig): MermaidRenderWorkerPool {
    const diagramCount = diagrams.length;
    const isGoAtlas = diagramCount === 1 && diagrams[0].language === 'go';
    const atlasLayerCount = isGoAtlas
      ? ((diagrams[0].languageSpecific?.atlas as { layers?: string[] } | undefined)?.layers
          ?.length ?? 4)
      : 0;
    const effectiveDiagramCount = Math.max(diagramCount, atlasLayerCount);
    const poolSize = Math.max(1, Math.min(os.cpus().length - 1, effectiveDiagramCount, 4));
    const poolTheme = globalConfig.mermaid?.theme ?? 'default';

    return new MermaidRenderWorkerPool(poolSize, {
      theme: poolTheme,
      maxTextSize: 200000,
      transparentBackground: globalConfig.mermaid?.transparentBackground ?? false,
      themeVariables: undefined,
    });
  }
}
