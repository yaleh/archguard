# Render Stage Separation Implementation

## Overview

This document describes the implementation of render stage separation for ArchGuard, following TDD methodology. The feature separates diagram generation into two distinct stages for better resource utilization and performance.

## Architecture

### Two-Stage Rendering Process

#### Stage 1: Generation (CPU-Intensive)
- **Purpose**: Generate Mermaid code for all diagrams
- **Operations**:
  1. Group entities using heuristic strategy
  2. Generate Mermaid code
  3. Validate generated code (5-layer validation)
  4. Auto-repair if validation fails
- **Output**: Array of `RenderJob` objects containing:
  - `name`: Diagram name
  - `mermaidCode`: Generated Mermaid code
  - `outputPath`: Output file paths (mmd, svg, png)

#### Stage 2: Rendering (I/O-Intensive)
- **Purpose**: Render all Mermaid diagrams to SVG and PNG
- **Operations**:
  1. Render Mermaid code to SVG using isomorphic-mermaid
  2. Convert SVG to PNG using sharp
  3. Save all output files
- **Concurrency**: 2x generation concurrency (I/O bound)

## Implementation

### New Types

```typescript
export interface RenderJob {
  name: string;
  mermaidCode: string;
  outputPath: {
    mmd: string;
    svg: string;
    png: string;
  };
}
```

### New Methods

#### `MermaidDiagramGenerator.generateOnly()`

Stage 1 method that generates Mermaid code without rendering.

```typescript
async generateOnly(
  archJson: ArchJSON,
  outputOptions: MermaidOutputOptions,
  level: DetailLevel,
  diagramConfig?: DiagramConfig
): Promise<RenderJob[]>
```

**Process**:
1. Analyze architecture and group entities
2. Generate Mermaid code
3. Validate with 5-layer pipeline
4. Attempt auto-repair if validation fails
5. Output quality metrics
6. Return `RenderJob[]` (no rendering)

#### `MermaidDiagramGenerator.renderJobsInParallel()`

Static Stage 2 method that renders all jobs in parallel.

```typescript
static async renderJobsInParallel(
  jobs: RenderJob[],
  concurrency: number
): Promise<void>
```

**Process**:
1. Render all Mermaid codes in parallel using p-map
2. Respect concurrency limit
3. Handle errors gracefully

### Updated Methods

#### `MermaidDiagramGenerator.generateAndRender()`

Now uses two-stage approach:

```typescript
async generateAndRender(...): Promise<void> {
  // Stage 1: Generate Mermaid code
  const allRenderJobs = await this.generateOnly(...);

  // Stage 2: Render in parallel
  await MermaidDiagramGenerator.renderJobsInParallel(
    allRenderJobs,
    (concurrency || os.cpus().length) * 2
  );
}
```

## TDD Approach

### Red Phase (Failing Tests)

Created comprehensive test suite in `tests/integration/render-separation.test.ts`:

1. **Stage 1 Tests**:
   - Generate Mermaid code without rendering
   - Support multiple diagrams
   - Include validation in generation stage

2. **Stage 2 Tests**:
   - Render all jobs in parallel
   - Respect concurrency limit
   - Handle errors gracefully

3. **Integration Tests**:
   - Full two-stage flow for multiple diagrams

All tests initially failed (Red phase).

### Green Phase (Implementation)

Implemented the two-stage separation:

1. Added `RenderJob` interface
2. Implemented `generateOnly()` method
3. Implemented `renderJobsInParallel()` static method
4. Updated `generateAndRender()` to use both stages
5. Added `renderJobsInParallelWithConfig()` helper

All tests now pass (Green phase).

## Performance Benefits

### Resource Utilization

**Before** (Mixed approach):
- Generation and rendering interleaved
- CPU-bound operations blocked by I/O
- Suboptimal concurrency

**After** (Two-stage approach):
- Stage 1: CPU-intensive generation runs in parallel
- Stage 2: I/O-intensive rendering runs with 2x concurrency
- Better resource utilization
- Additional performance gain

### Concurrency Strategy

- **Generation**: Uses configured concurrency (default: CPU cores)
- **Rendering**: Uses generation concurrency × 2 (I/O bound)
- Example: 8-core system → 8 generation, 16 rendering

## Testing

### Unit Tests

```bash
npm test -- tests/integration/render-separation.test.ts
```

All 7 tests pass:
- ✓ should generate Mermaid code without rendering
- ✓ should support multiple diagrams with different configurations
- ✓ should include validation in generation stage
- ✓ should render all render jobs in parallel
- ✓ should respect concurrency limit during rendering
- ✓ should handle rendering errors gracefully
- ✓ should complete two-stage flow for multiple diagrams

### Integration Testing

Tested with real codebase:

```bash
node dist/cli/index.js analyze -s ./src/mermaid -l class -n mermaid-module -v
```

Results:
- ✓ Generation stage completes successfully
- ✓ Rendering stage completes with higher concurrency
- ✓ All output files generated correctly
- ✓ Progress messages show distinct stages

## Future Enhancements

### Potential Optimizations

1. **Batch Rendering**: Group similar diagrams for batch processing
2. **Incremental Rendering**: Only render changed diagrams
3. **Distributed Rendering**: Render across multiple processes/workers
4. **Caching**: Cache rendered outputs for unchanged diagrams

### Error Isolation

- Current: First rendering error fails the entire batch
- Future: Continue rendering on errors, collect all failures

### Progress Reporting

- Current: Basic progress messages
- Future: Detailed per-diagram progress in Stage 2

## Migration Guide

### For Users

No changes required. The two-stage rendering is transparent to users.

### For Developers

If extending the rendering pipeline:

1. **Stage 1**: Use `generateOnly()` for generation-only operations
2. **Stage 2**: Use `renderJobsInParallel()` for batch rendering
3. **Combined**: Use `generateAndRender()` for the full flow

Example:

```typescript
// Custom two-stage processing
const generator = new MermaidDiagramGenerator(config);

// Stage 1: Generate all jobs
const jobs = await generator.generateOnly(archJson, options, 'class');

// Custom processing of jobs (e.g., filter, transform)
const filteredJobs = jobs.filter(job => job.name.includes('api'));

// Stage 2: Render filtered jobs
await MermaidDiagramGenerator.renderJobsInParallel(filteredJobs, 8);
```

## Conclusion

The render stage separation successfully:

- ✓ Separates CPU-intensive generation from I/O-intensive rendering
- ✓ Enables better resource utilization
- ✓ Provides additional performance gain
- ✓ Maintains backward compatibility
- ✓ Follows TDD methodology
- ✓ All tests pass
- ✓ Build succeeds
- ✓ Validated with real diagrams

The implementation is production-ready and provides a solid foundation for future performance optimizations.
