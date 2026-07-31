---
id: TASK-46
title: Break GoPlugin ↔ GoAtlasAdapter dependency cycle
status: done
labels:
  - refactor
  - golang
  - architecture
parent: null
children: []
extra: {}
---
## Proposal

The architecture analysis detected a 2-node dependency cycle in `src/plugins/golang/`:

- **Forward**: `GoPlugin` (index.ts:41) imports and instantiates `GoAtlasAdapter`
- **Reverse**: `GoAtlasAdapter` (go-atlas-adapter.ts:9) imports `GoPlugin` type and calls `this.plugin.parseToRawData()`

## Root Cause

`GoAtlasAdapter` depends on the concrete `GoPlugin` class for a single capability: `parseToRawData()`. This is the only back-reference — the adapter needs raw data from the plugin to build the Atlas.

## Plan

1. **Define `IGoRawDataProvider` interface** — add to `src/plugins/golang/types.ts`:
   ```typescript
   export interface IGoRawDataProvider {
     parseToRawData(workspaceRoot: string, config: ParseConfig & TreeSitterParseOptions): Promise<GoRawData>;
   }
   ```
   This interface already needs `ParseConfig` import from `@/core/interfaces/parser.js`.

2. **Update `GoAtlasAdapter`** (go-atlas-adapter.ts):
   - Replace `import type { GoPlugin } from './index.js'` with `import type { IGoRawDataProvider } from './types.js'`
   - Change constructor parameter from `plugin: GoPlugin` to `rawDataProvider: IGoRawDataProvider`
   - Update internal field name from `this.plugin` to `this.rawDataProvider`
   - Update `generateAtlas()` to call `this.rawDataProvider.parseToRawData()`

3. **Update `GoPlugin`** (index.ts):
   - Change `GoAtlasAdapter` construction from `new GoAtlasAdapter(this, ...)` to `new GoAtlasAdapter(this, ...)` (no change — `GoPlugin` already satisfies the interface)

4. **Verify**: Run `npm run type-check` and `npx vitest run tests/plugins/golang/` to confirm no regressions.

## Touches

- src/plugins/golang/types.ts (new interface)
- src/plugins/golang/go-atlas-adapter.ts (import → interface, field rename)
- src/plugins/golang/index.ts (no change needed — implicit structural typing)

## AC

- [x] `IGoRawDataProvider` interface defined in `types.ts` with `parseToRawData` method
- [x] `GoAtlasAdapter` no longer imports from `./index.js`
- [x] `GoAtlasAdapter` depends on `IGoRawDataProvider` instead of `GoPlugin`
- [x] `GoPlugin` satisfies `IGoRawDataProvider` without code changes (implicit structural typing)
- [x] Type check passes (`npm run type-check`)
- [x] All Go plugin tests pass
- [x] Cycle detection confirms zero cycles in `src/plugins/golang`

## Definition of Done

- [ ] `npm run type-check` passes
- [ ] `npx vitest run tests/plugins/golang/` green
- [ ] `npx vitest run tests/unit/plugins/golang/` green