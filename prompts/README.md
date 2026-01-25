# Prompt Templates

This directory contains prompt templates used by ArchGuard to generate various types of architecture diagrams using Claude Code CLI.

## Available Templates

### class-diagram.txt

Generates PlantUML class diagrams from ArchJSON architecture fingerprints.

**Variables:**
- `{{ARCH_JSON}}` - Required. The architecture JSON data containing entities and relations.
- `{{PREVIOUS_PUML}}` - Optional. Previous PlantUML diagram for incremental updates.

**Usage:**
```typescript
import { PromptTemplateManager } from '../src/ai/prompt-template-manager.js';

const manager = new PromptTemplateManager();
const prompt = await manager.render('class-diagram', {
  ARCH_JSON: JSON.stringify(archJson, null, 2),
  PREVIOUS_PUML: null
});
```

## Template Syntax

Templates use a simple variable substitution syntax:

- `{{VARIABLE}}` - Simple variable substitution
- `{{#if VARIABLE}}...{{else}}...{{/if}}` - Conditional blocks (not yet implemented)

## Adding New Templates

1. Create a new `.txt` file in this directory
2. Use the variable syntax for dynamic content
3. Document the template in this README
4. Add corresponding test cases

## Best Practices

1. **Keep prompts focused** - Each template should have a single, clear purpose
2. **Use clear variable names** - Make it obvious what data is expected
3. **Provide examples** - Include expected output format in the prompt
4. **Language considerations** - Use Chinese for Claude interactions (better results)
5. **Version control** - Templates are version-controlled for consistency

## Future Templates (Planned)

- `component-diagram.txt` - Component architecture diagrams
- `sequence-diagram.txt` - Sequence diagrams for interactions
- `deployment-diagram.txt` - Deployment architecture

---

**Last Updated:** 2026-01-25
**Version:** 1.0.0 (Phase 0)
