# AI Module

AI-powered PlantUML diagram generation using Claude 3.5 Sonnet API.

## Overview

The AI module converts ArchJSON (architectural metadata) into PlantUML class diagrams using Claude's advanced language understanding capabilities.

## Components

### ClaudeConnector

Manages communication with Anthropic's Claude API.

```typescript
import { ClaudeConnector } from './ai';

const connector = new ClaudeConnector(process.env.ANTHROPIC_API_KEY);

const response = await connector.chat('Generate a PlantUML diagram for...');
console.log(response.text);
console.log('Tokens used:', response.usage);
```

**Features**:
- Token estimation and validation
- Comprehensive error handling
- Usage tracking
- Configurable model and parameters

### PromptBuilder

Constructs effective prompts for PlantUML generation using few-shot learning.

```typescript
import { PromptBuilder } from './ai';

const builder = new PromptBuilder();
const prompt = builder.buildClassDiagramPrompt(archJson);
```

**Features**:
- System prompt with quality standards
- 4 comprehensive few-shot examples
- Output format constraints
- PlantUML best practices

### PlantUMLGenerator

Main entry point for generating PlantUML diagrams.

```typescript
import { PlantUMLGenerator } from './ai';

const generator = new PlantUMLGenerator({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 3
});

const plantUML = await generator.generate(archJson);
```

**Features**:
- End-to-end generation pipeline
- Validation-driven retry
- Token usage tracking
- Error recovery with exponential backoff

### PlantUMLValidator

Validates generated PlantUML for syntax and completeness.

```typescript
import { PlantUMLValidator } from './ai';

const validator = new PlantUMLValidator();
const result = validator.validate(plantUML, archJson);

if (!result.isValid) {
  console.error('Validation issues:', result.issues);
}
```

**Features**:
- Syntax validation (@startuml/@enduml, etc.)
- Completeness checking (all entities present)
- Style recommendations (themes, packages)

### CostTracker

Tracks API usage and costs.

```typescript
import { CostTracker } from './ai';

const tracker = new CostTracker();
tracker.setBudget(1.0); // $1.00 budget

// After API call
tracker.trackCall(inputTokens, outputTokens);

const report = tracker.getReport();
console.log('Total cost:', tracker.getFormattedCost());
console.log('Remaining budget:', tracker.getRemainingBudget());
```

**Features**:
- Token counting
- Cost calculation (Claude 3.5 Sonnet pricing)
- Budget management
- Detailed reports

## Usage Example

Complete example with all components:

```typescript
import {
  PlantUMLGenerator,
  CostTracker,
  ArchJSON
} from 'archguard';

// Setup
const generator = new PlantUMLGenerator({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const tracker = new CostTracker();
tracker.setBudget(0.10); // $0.10 budget

// Your ArchJSON data
const archJson: ArchJSON = {
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: ['User.ts'],
  entities: [
    {
      id: 'User',
      name: 'User',
      type: 'class',
      visibility: 'public',
      members: [
        {
          name: 'id',
          type: 'property',
          visibility: 'private',
          fieldType: 'string'
        },
        {
          name: 'getName',
          type: 'method',
          visibility: 'public',
          returnType: 'string'
        }
      ],
      sourceLocation: { file: 'User.ts', startLine: 1, endLine: 10 }
    }
  ],
  relations: []
};

// Generate PlantUML
const plantUML = await generator.generate(archJson);

// Track cost
const usage = generator.getLastUsage();
if (usage) {
  tracker.trackCall(usage.inputTokens, usage.outputTokens);
}

// Output
console.log('PlantUML:', plantUML);
console.log('Cost:', tracker.getFormattedCost());
console.log('Budget OK:', !tracker.isOverBudget());
```

## Environment Setup

```bash
# Required: Set your Anthropic API key
export ANTHROPIC_API_KEY="your-api-key-here"

# Install dependencies
npm install @anthropic-ai/sdk
```

## Cost Estimates

Based on Claude 3.5 Sonnet pricing (as of 2026-01-25):
- Input: $3.00 per 1M tokens
- Output: $15.00 per 1M tokens

**Typical costs**:
- Small project (5 entities): < $0.01
- Medium project (20 entities): < $0.03
- Large project (50 entities): < $0.10

## Error Handling

The module provides comprehensive error handling:

```typescript
import { ClaudeAPIError } from './ai';

try {
  const plantUML = await generator.generate(archJson);
} catch (error) {
  if (error instanceof ClaudeAPIError) {
    console.error('Code:', error.code);
    console.error('Retryable:', error.retryable);
  }
}
```

**Error codes**:
- `AUTH_FAILED`: Invalid API key (not retryable)
- `TIMEOUT`: Request timeout (retryable)
- `RATE_LIMIT`: Too many requests (retryable)
- `SERVER_ERROR`: API server error (retryable)
- `NETWORK_ERROR`: Network connection failed (retryable)

## Testing

```bash
# Unit tests (no API key needed - uses mocks)
npm test tests/unit/ai/

# Integration tests (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY="your-api-key"
npm test tests/integration/ai/

# Coverage
npm run test:coverage -- tests/unit/ai/
```

## Architecture

```
┌─────────────┐
│  ArchJSON   │
└──────┬──────┘
       │
       ↓
┌──────────────────┐
│ PlantUMLGenerator│
└──────┬───────────┘
       │
       ├─→ PromptBuilder
       │     ↓
       ├─→ ClaudeConnector → Anthropic API
       │     ↓
       ├─→ PlantUMLValidator
       │     ↓
       └─→ CostTracker
             ↓
       ┌──────────┐
       │ PlantUML │
       └──────────┘
```

## Performance

- **Generation time**: < 10 seconds (typical)
- **Retry delay**: 1s, 2s, 3s (exponential backoff)
- **Max retries**: 3 (configurable)
- **Validation**: < 10ms overhead

## Best Practices

1. **Always set a budget**:
   ```typescript
   tracker.setBudget(0.10); // Prevent runaway costs
   ```

2. **Handle errors gracefully**:
   ```typescript
   try {
     const result = await generator.generate(archJson);
   } catch (error) {
     // Log and handle error
   }
   ```

3. **Monitor costs**:
   ```typescript
   const report = tracker.getReport();
   console.log('Calls:', report.totalCalls);
   console.log('Cost:', report.totalCost);
   ```

4. **Use environment variables**:
   ```typescript
   const apiKey = process.env.ANTHROPIC_API_KEY;
   if (!apiKey) throw new Error('API key required');
   ```

## Limitations

- Requires internet connection
- API key required (costs apply)
- PlantUML rendering not included (use PlantUML tools separately)
- English prompts only (PlantUML is language-agnostic)

## Contributing

See `/docs/refactoring/plans/02-phase2-ai-generation.md` for development methodology and TDD approach.

## License

MIT
