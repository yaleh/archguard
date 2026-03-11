/**
 * Compatibility shim — atlas/index.ts
 *
 * The GoAtlasPlugin class has been merged into GoPlugin (src/plugins/golang/index.ts).
 * This file re-exports everything that external callers previously imported from
 * this path so that no import sites need to change.
 */

// GoPlugin is the merged successor of GoAtlasPlugin; alias it for back-compat.
export { GoPlugin as GoAtlasPlugin, IGoAtlas } from '../index.js';

// Atlas types (previously defined in this package, still live in ./types.ts)
export type {
  GoArchitectureAtlas,
  AtlasConfig,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './types.js';
export { GO_ATLAS_EXTENSION_VERSION } from './types.js';
