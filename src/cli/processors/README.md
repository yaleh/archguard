# DiagramProcessor

Unified diagram processing component for ArchGuard v2.0.

## Overview

DiagramProcessor is the core component that implements the "Everything is a Diagram" design principle. It processes multiple diagrams independently using the same unified flow, with no special mode branches.

## Key Features

- **Unified Processing**: Single processing path for all diagrams
- **Independent Processing**: Each diagram is processed independently; failures are isolated
- **Multi-level Support**: Supports package, class, and method detail levels
- **Multi-format Support**: Supports plantuml, json, and svg output formats
- **Error Handling**: Graceful error handling with detailed error messages
- **Progress Reporting**: Real-time progress feedback using ProgressReporter

## Architecture

```
DiagramProcessor
├── FileDiscoveryService  - Discover TypeScript files
├── ParallelParser        - Parse files in parallel
├── ArchJSONAggregator    - Aggregate to detail level
├── OutputPathResolver    - Resolve output paths
└── PlantUMLGenerator     - Generate PlantUML/PNG (optional)
```

## Processing Flow

For each diagram:

1. **File Discovery**: Use FileDiscoveryService to discover TypeScript files from sources
2. **Parsing**: Use ParallelParser to parse files in parallel
3. **Aggregation**: Use ArchJSONAggregator to aggregate to specified level
4. **Path Resolution**: Use OutputPathResolver to resolve output paths
5. **Output Generation**: Generate output based on format:
   - `json`: Write ArchJSON file
   - `plantuml`: Generate PlantUML and render to PNG
   - `svg`: Generate PlantUML and render to SVG

## Usage

### Basic Example

```typescript
import { DiagramProcessor } from '@/cli/processors/diagram-processor.js';
import { ProgressReporter } from '@/cli/progress.js';

// Create progress reporter
const progress = new ProgressReporter();

// Create diagram configurations
const diagrams = [
  {
    name: 'overview',
    sources: ['./src'],
    level: 'package',
    description: 'High-level architecture overview'
  },
  {
    name: 'frontend',
    sources: ['./src/frontend'],
    level: 'class',
    description: 'Frontend module details'
  }
];

// Create global configuration
const globalConfig = {
  outputDir: './archguard',
  format: 'plantuml',
  exclude: ['**/*.test.ts'],
  cli: {
    command: 'claude',
    args: [],
    timeout: 180000
  },
  cache: {
    enabled: true,
    ttl: 3600
  },
  concurrency: 4,
  verbose: false
};

// Create processor
const processor = new DiagramProcessor({
  diagrams,
  globalConfig,
  progress
});

// Process all diagrams
const results = await processor.processAll();

// Check results
for (const result of results) {
  if (result.success) {
    console.log(`✓ ${result.name}: ${result.stats?.entities} entities, ${result.stats?.relations} relations`);
    console.log(`  Output: ${result.paths?.png || result.paths?.json}`);
  } else {
    console.log(`✗ ${result.name}: ${result.error}`);
  }
}
```

### JSON Format (Fast, No Claude CLI)

```typescript
const diagrams = [
  {
    name: 'api',
    sources: ['./src/api'],
    level: 'class',
    format: 'json'  // Override global format
  }
];

const processor = new DiagramProcessor({ diagrams, globalConfig, progress });
const results = await processor.processAll();

// Result: ./archguard/api.json
```

### Multiple Detail Levels

```typescript
const diagrams = [
  {
    name: 'overview',
    sources: ['./src'],
    level: 'package'  // High-level overview
  },
  {
    name: 'services',
    sources: ['./src/services'],
    level: 'class'    // Default detail
  },
  {
    name: 'user-service',
    sources: ['./src/services/user.ts'],
    level: 'method'   // Full detail
  }
];
```

### Error Handling

Each diagram is processed independently. If one fails, others continue:

```typescript
const results = await processor.processAll();

const successes = results.filter(r => r.success);
const failures = results.filter(r => !r.success);

console.log(`Processed ${successes.length} diagrams successfully`);
console.log(`${failures.length} diagrams failed`);

for (const failure of failures) {
  console.log(`  - ${failure.name}: ${failure.error}`);
}
```

## DiagramResult Interface

```typescript
interface DiagramResult {
  name: string;
  success: boolean;
  paths?: {
    puml?: string;
    png?: string;
    json?: string;
    svg?: string;
  };
  stats?: {
    entities: number;
    relations: number;
    parseTime: number;
  };
  error?: string;
}
```

## Testing

See `tests/unit/cli/processors/diagram-processor.test.ts` for comprehensive test examples.

## Integration with CLI

The DiagramProcessor will be integrated into the analyze command in Phase 2, Task 6 (normalizeToDiagrams).

## Design Principles

1. **Everything is a Diagram**: No special modes; all diagrams use the same structure
2. **Single Processing Path**: Unified flow; no if (batch) branches
3. **Failure Isolation**: One diagram failure doesn't affect others
4. **Orthogonal Design**: Each parameter controls one dimension
5. **Configuration-first**: Complex scenarios use config file; simple scenarios use CLI

## Future Enhancements

- Parallel diagram processing (currently sequential)
- Incremental diagram updates (only reprocess changed files)
- Diagram dependencies (process in order if needed)
