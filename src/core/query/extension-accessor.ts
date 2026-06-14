/**
 * ExtensionAccessor — typed accessors for ArchJSONExtensions fields.
 *
 * Extracted from QueryEngine (Phase 109) to encapsulate all extension access
 * in one place. QueryEngine and ArchMetrics delegate to this class instead of
 * reaching into archJson.extensions directly.
 */

import type { ArchJSON } from '@/types/index.js';
import type { GoAtlasLayers } from '@/types/extensions/go-atlas.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';

export class ExtensionAccessor {
  constructor(private readonly archJson: ArchJSON) {}

  /** Return the named Go Atlas layer, or undefined if not present. */
  getAtlasLayer<K extends keyof GoAtlasLayers>(layer: K): GoAtlasLayers[K] | undefined {
    return this.archJson.extensions?.goAtlas?.layers?.[layer];
  }

  /** Return the full GoAtlasLayers object, or undefined if not present. */
  getAtlasLayers(): GoAtlasLayers | undefined {
    return this.archJson.extensions?.goAtlas?.layers;
  }

  /** Returns true when the ArchJSON carries a goAtlas extension container. */
  hasAtlasExtension(): boolean {
    return !!this.archJson.extensions?.goAtlas;
  }

  /** Return the TestAnalysis extension, or undefined if not present. */
  getTestAnalysis(): TestAnalysis | undefined {
    return this.archJson.extensions?.testAnalysis;
  }

  /** Returns true when the ArchJSON carries a testAnalysis extension. */
  hasTestAnalysis(): boolean {
    return this.archJson.extensions?.testAnalysis !== undefined;
  }
}
