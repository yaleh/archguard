# AI Module

AI-powered PlantUML diagram generation using Claude Code CLI.

## Overview

The AI module converts ArchJSON (architectural metadata) into PlantUML class diagrams using Claude Code CLI. This approach provides a more streamlined workflow compared to direct API calls.

## Components

### ClaudeCodeWrapper

Main wrapper for Claude Code CLI invocation.

```typescript
import { ClaudeCodeWrapper } from './ai';

const wrapper = new ClaudeCodeWrapper({
  timeout: 60000,
  maxRetries: 3,
  workingDir: '/tmp'
});

const plantUML = await wrapper.generatePlantUML(archJson);
```

**Features**:
- Temporary file management for prompts and outputs
- Retry logic with exponential backoff (1s, 2s, 4s)
- Error classification (CLI_NOT_FOUND, TIMEOUT, VALIDATION_ERROR)
- Automatic cleanup of temporary files
- PlantUML validation

### OutputParser

Extracts PlantUML code from Claude Code CLI output.

```typescript
import { OutputParser } from './ai';

const parser = new OutputParser();
const plantUML = parser.extractPlantUML(cliOutput);
```

**Features**:
- Supports markdown code blocks (```plantuml, ```uml)
- Handles raw PlantUML content
- Mixed content extraction
- Syntax validation (@startuml/@enduml markers)
- Output truncation for error messages

### PromptTemplateManager

Loads and renders prompt templates from the `prompts/` directory.

```typescript
import { PromptTemplateManager } from './ai';

const manager = new PromptTemplateManager();
const prompt = await manager.render('class-diagram', {
  ARCH_JSON: JSON.stringify(archJson, null, 2),
  PREVIOUS_PUML: previousPuml || ''
});
```

**Features**:
- Template file loading from `prompts/` directory
- Variable substitution: `{{ARCH_JSON}}`, `{{PREVIOUS_PUML}}`
- Conditional blocks: `{{#if VAR}}...{{else}}...{{/if}}`
- Template caching for performance
- Custom template support

### PlantUMLGenerator

Main entry point for generating PlantUML diagrams.

```typescript
import { PlantUMLGenerator } from './ai';

const generator = new PlantUMLGenerator({
  cli: {
    command: 'claude',
    args: ['--model', 'claude-3-5-sonnet-20241022'],
    timeout: 60000
  },
  ai: {
    maxRetries: 3
  }
});

const plantUML = await generator.generate(archJson);
```

**Features**:
- End-to-end generation pipeline
- Validation-driven workflow
- Error recovery with exponential backoff
- Support for incremental updates (previousPuml)
- PNG/SVG rendering via PlantUMLRenderer

### PlantUMLValidator

Validates generated PlantUML for syntax and completeness.

```typescript
import { PlantUMLValidator } from './ai';

const validator = new PlantUMLValidator();
const result = validator.validate(plantUML, archJson);

if (!result.isValid) {
  console.error('Validation issues:', result.issues);
  console.error('Errors:', result.errors);
  console.error('Warnings:', result.warnings);
}
```

**Features**:
- Syntax validation (@startuml/@enduml, balanced braces)
- Completeness checking (all entities present)
- Relationship reference validation (no undefined types)
- Style recommendations (themes, packages)
- Detailed error reporting

### PlantUMLRenderer

Renders PlantUML code to PNG/SVG images.

```typescript
import { PlantUMLRenderer } from './ai';

const renderer = new PlantUMLRenderer({
  format: 'png',
  theme: 'cerulean-outline'
});

await renderer.render(plantUML, 'output.png');
```

**Features**:
- PNG and SVG output formats
- Theme support
- Background color customization
- Code preprocessing
- File and string input support

## Usage Example

Complete example with all components:

```typescript
import { PlantUMLGenerator } from 'archguard';
import type { ArchJSON } from 'archguard';

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
          fieldType: 'string',
          returnType: '',
          parameters: [],
          isStatic: false,
          isAbstract: false,
          isAsync: false,
          isReadonly: false,
          isOptional: false,
          defaultValue: '',
          decorators: []
        },
        {
          name: 'getName',
          type: 'method',
          visibility: 'public',
          returnType: 'string',
          parameters: [],
          fieldType: '',
          isStatic: false,
          isAbstract: false,
          isAsync: false,
          isReadonly: false,
          isOptional: false,
          defaultValue: '',
          decorators: []
        }
      ],
      sourceLocation: { file: 'User.ts', startLine: 1, endLine: 10 },
      decorators: [],
      isAbstract: false,
      isConst: false,
      genericParams: [],
      extends: [],
      implements: []
    }
  ],
  relations: []
};

// Setup generator
const generator = new PlantUMLGenerator({
  cli: {
    command: 'claude',
    timeout: 60000
  },
  ai: {
    maxRetries: 3
  }
});

// Generate PlantUML
const plantUML = await generator.generate(archJson);

// Output
console.log('PlantUML:', plantUML);
```

## Environment Setup

```bash
# Required: Install Claude Code CLI
# See: https://docs.anthropic.com/claude-code

# Verify installation
claude --version

# Configure authentication
claude login
```

## Cost Estimates

Claude Code CLI handles costs internally. You can monitor usage through your Anthropic dashboard.

**Typical costs** (based on Claude 3.5 Sonnet pricing):
- Small project (5 entities): < $0.01
- Medium project (20 entities): < $0.03
- Large project (50 entities): < $0.10

## Error Handling

The module provides comprehensive error handling:

```typescript
import { PlantUMLGenerator } from './ai';

try {
  const plantUML = await generator.generate(archJson);
} catch (error) {
  if (error instanceof Error) {
    console.error('Error:', error.message);

    // Check for specific error types
    if (error.message.includes('CLI_NOT_FOUND')) {
      console.error('Please install Claude Code CLI');
    } else if (error.message.includes('TIMEOUT')) {
      console.error('Request timeout - try increasing timeout config');
    } else if (error.message.includes('VALIDATION_ERROR')) {
      console.error('Generated PlantUML failed validation');
    }
  }
}
```

**Error types**:
- `CLI_NOT_FOUND`: Claude Code CLI not installed or not in PATH
- `TIMEOUT`: Request exceeded timeout limit (retryable)
- `VALIDATION_ERROR`: Generated PlantUML failed validation (retryable)
- `TEMP_DIR_ERROR`: Failed to create/cleanup temp directory
- `FILE_WRITE_ERROR`: Failed to write prompt/output files

## Testing

```bash
# Unit tests (no CLI required - uses mocks)
npm test tests/unit/ai/

# Integration tests (requires Claude Code CLI)
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
┌──────────────────────┐
│ PlantUMLGenerator    │
└──────┬───────────────┘
       │
       ├─→ PromptTemplateManager → prompts/class-diagram.txt
       │     ↓
       ├─→ ClaudeCodeWrapper → Claude Code CLI
       │     ├─→ OutputParser
       │     └─→ Temp file management
       │     ↓
       └─→ PlantUMLValidator
             ↓
       ┌──────────┐
       │ PlantUML │
       └──────────┘
```

## Performance

- **Generation time**: < 10 seconds (typical)
- **Retry delay**: 1s, 2s, 4s (exponential backoff)
- **Max retries**: 3 (configurable)
- **Validation**: < 10ms overhead
- **Template caching**: Enabled by default

## Best Practices

1. **Always check CLI availability**:
   ```typescript
   import { isClaudeCodeAvailable } from '@/utils/cli-detector';

   const available = await isClaudeCodeAvailable();
   if (!available) {
     throw new Error('Claude Code CLI not found');
   }
   ```

2. **Handle errors gracefully**:
   ```typescript
   try {
     const result = await generator.generate(archJson);
   } catch (error) {
     // Log and handle error appropriately
   }
   ```

3. **Use configuration files**:
   ```typescript
   // archguard.config.json
   {
     "cli": {
       "command": "claude",
       "args": ["--model", "claude-3-5-sonnet-20241022"],
       "timeout": 60000
     },
     "ai": {
       "maxRetries": 3
     }
   }
   ```

4. **Customize prompts when needed**:
   - Edit `prompts/class-diagram.txt` to adjust generation behavior
   - Use template variables for dynamic content
   - Follow few-shot examples for consistency

## Prompt Templates

The module uses template files from the `prompts/` directory:

- `prompts/class-diagram.txt`: Main template for class diagram generation
  - Variables: `{{ARCH_JSON}}`, `{{PREVIOUS_PUML}}`
  - Includes few-shot examples
  - Specifies PlantUML constraints and best practices

## Limitations

- Requires Claude Code CLI installation
- Requires internet connection
- PlantUML rendering requires separate PlantUML tools (handled by PlantUMLRenderer)
- Template language is Chinese (PlantUML output is universal)

## Migration from Legacy API

If you're migrating from the old direct API approach:

**Old (Deprecated)**:
```typescript
import { ClaudeConnector, PromptBuilder, CostTracker } from './ai';

const connector = new ClaudeConnector(apiKey);
const builder = new PromptBuilder();
const tracker = new CostTracker();

const prompt = builder.buildClassDiagramPrompt(archJson);
const response = await connector.chat(prompt);
tracker.trackCall(response.usage.inputTokens, response.usage.outputTokens);
```

**New (Current)**:
```typescript
import { PlantUMLGenerator } from './ai';

const generator = new PlantUMLGenerator(config);
const plantUML = await generator.generate(archJson);
// Cost tracking is handled by Claude Code CLI
```

## Contributing

See `/docs/refactoring/plans/02-phase2-claude-code-integration.md` for development methodology and TDD approach.

## License

MIT
