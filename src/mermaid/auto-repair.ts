/**
 * Mermaid Auto-Repair
 * Automatically fixes common Mermaid syntax issues
 */

import { MermaidParseValidator } from './validator-parse.js';
import type { ValidationError } from './types.js';

/**
 * Auto-repair for Mermaid diagrams
 */
export class MermaidAutoRepair {
  constructor(private parseValidator: MermaidParseValidator) {}

  /**
   * Attempt to repair Mermaid code
   */
  async repair(mermaidCode: string, errors: ValidationError[]): Promise<string> {
    let repaired = mermaidCode;

    // Apply common repairs
    repaired = this.addDiagramDeclaration(repaired);
    repaired = this.fixGenericTypes(repaired);
    repaired = this.flattenNestedNamespaces(repaired);
    repaired = this.extractNamespaceRelations(repaired);
    repaired = this.fixTrailingCommas(repaired);
    repaired = this.normalizeWhitespace(repaired);

    // Validate after repairs
    const result = await this.parseValidator.validate(repaired);

    if (result.valid) {
      return repaired;
    }

    // If still failing, try advanced repairs based on errors
    repaired = await this.attemptAdvancedRepairs(repaired, result.errors);

    const finalResult = await this.parseValidator.validate(repaired);
    if (finalResult.valid) {
      return repaired;
    }

    // Cannot repair
    throw new Error(
      `Cannot repair Mermaid code. Errors: ${finalResult.errors.map((e) => e.message).join(', ')}`
    );
  }

  /**
   * Add missing classDiagram declaration
   */
  private addDiagramDeclaration(code: string): string {
    const trimmed = code.trim();

    // Check if diagram type is already declared
    const hasDeclaration = /^\s*(classDiagram|flowchart|stateDiagram|erDiagram|gitGraph)/m.test(
      trimmed
    );

    if (!hasDeclaration && trimmed.length > 0) {
      return `classDiagram\n${trimmed}`;
    }

    return code;
  }

  /**
   * Fix comma-based generic types to use tilde notation
   */
  private fixGenericTypes(code: string): string {
    let repaired = code;

    // Match patterns like Map<K, V> or List<T> or Repository<Entity>
    // and convert to Map~K,V~ or List~T~ or Repository~Entity~
    const genericPattern = /(\w+)<([^>]+)>/g;

    repaired = repaired.replace(genericPattern, (match, className, generics) => {
      // Remove spaces from generics for cleaner Mermaid syntax
      const cleanGenerics = generics.replace(/\s*,\s*/g, ',').replace(/\s+/g, '');
      return `${className}~${cleanGenerics}~`;
    });

    return repaired;
  }

  /**
   * Flatten nested namespace structures
   */
  private flattenNestedNamespaces(code: string): string {
    const lines = code.split('\n');
    const result: string[] = [];
    let namespaceDepth = 0;
    let currentNamespace = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('namespace ')) {
        if (namespaceDepth === 0) {
          // Keep only top-level namespace
          result.push(line);
          currentNamespace = trimmed;
        }
        namespaceDepth++;
      } else if (trimmed === '}') {
        namespaceDepth--;
        if (namespaceDepth === 0) {
          result.push(line);
          currentNamespace = '';
        }
      } else if (namespaceDepth <= 1) {
        // Keep content at most 1 level deep
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
   * Extract relations from inside namespaces to outside
   */
  private extractNamespaceRelations(code: string): string {
    const lines = code.split('\n');
    const relations: string[] = [];
    const result: string[] = [];
    let inNamespace = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('namespace ')) {
        inNamespace = true;
        result.push(line);
      } else if (trimmed === '}') {
        inNamespace = false;
        result.push(line);
      } else if (inNamespace && this.isRelationLine(trimmed)) {
        // Extract relation from namespace
        relations.push(line);
      } else {
        result.push(line);
      }
    }

    // Add extracted relations at the end
    if (relations.length > 0) {
      result.push('');
      result.push('// Relations extracted from namespaces');
      result.push(...relations);
    }

    return result.join('\n');
  }

  /**
   * Check if a line is a relation definition
   */
  private isRelationLine(line: string): boolean {
    // Match patterns like: A --> B, A -- B, A <|.. B, etc.
    const relationPatterns = [
      /\w+\s*-->/,
      /\w+\s*<--/,
      /\w+\s*--/,
      /\w+\s*\.\./,
      /\w+\s*<\|/,
      /\w+\s*\|>/,
    ];

    return relationPatterns.some((pattern) => pattern.test(line));
  }

  /**
   * Fix trailing commas that might cause issues
   */
  private fixTrailingCommas(code: string): string {
    // Remove trailing commas in class definitions
    let repaired = code;

    // Match patterns like: +field: String, or +method(): void,
    // and remove the trailing comma
    repaired = repaired.replace(/,(\s*$)/gm, '$1');
    repaired = repaired.replace(/,(\s*\n)/gm, '\n');
    repaired = repaired.replace(/,(\s*})/g, '$1');

    return repaired;
  }

  /**
   * Normalize whitespace issues
   */
  private normalizeWhitespace(code: string): string {
    let repaired = code;

    // Remove multiple consecutive blank lines
    repaired = repaired.replace(/\n{3,}/g, '\n\n');

    // Trim trailing whitespace from each line
    repaired = repaired
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');

    // Ensure single newline at end
    repaired = repaired.replace(/\n+$/, '\n');

    return repaired;
  }

  /**
   * Attempt advanced repairs based on specific errors
   */
  private async attemptAdvancedRepairs(code: string, errors: ValidationError[]): Promise<string> {
    let repaired = code;

    for (const error of errors) {
      if (error.code === 'SYNTAX_ERROR' && error.line) {
        repaired = this.fixLineError(repaired, error);
      }

      if (error.message.toLowerCase().includes('unknown')) {
        repaired = this.removeUnknownTokens(repaired);
      }

      if (error.message.toLowerCase().includes('unexpected')) {
        repaired = this.fixUnexpectedToken(repaired);
      }
    }

    return repaired;
  }

  /**
   * Attempt to fix error on specific line
   */
  private fixLineError(code: string, error: ValidationError): string {
    const lines = code.split('\n');

    if (error.line && error.line >= 1 && error.line <= lines.length) {
      const lineIndex = error.line - 1;
      const line = lines[lineIndex];

      // Try common fixes
      let fixed = line;

      // Fix missing closing brace
      if (fixed.includes('{') && !fixed.includes('}')) {
        fixed = fixed + ' {';
      }

      // Fix missing opening brace
      if (!fixed.includes('{') && fixed.includes('class')) {
        fixed = fixed + ' {';
      }

      // Remove problematic special characters
      fixed = fixed.replace(/[|{}[\]]/g, '');

      lines[lineIndex] = fixed;
    }

    return lines.join('\n');
  }

  /**
   * Remove unknown tokens
   */
  private removeUnknownTokens(code: string): string {
    let repaired = code;

    // Remove lines with special characters that might be unknown tokens
    const lines = repaired.split('\n');
    const filtered = lines.filter((line) => {
      // Keep lines that look like valid Mermaid
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) return true;
      if (/^\s*(classDiagram|class|namespace|%%)/.test(trimmed)) return true;
      if (/^\s*\w+\s*(-->\|<--\|--|<\|\.\.|\.\.|-->)/.test(trimmed)) return true;
      if (/^\s*[\+\-#]\s*\w+/.test(trimmed)) return true;

      // Skip lines with problematic tokens
      return !/[|{}\[\]\\]/.test(trimmed);
    });

    return filtered.join('\n');
  }

  /**
   * Fix unexpected tokens
   */
  private fixUnexpectedToken(code: string): string {
    let repaired = code;

    // Replace problematic characters
    repaired = repaired.replace(/\|/g, '_');
    repaired = repaired.replace(/\[/g, '(');
    repaired = repaired.replace(/\]/g, ')');

    return repaired;
  }

  /**
   * Attempt repair without specific errors (best effort)
   */
  async repairBestEffort(mermaidCode: string): Promise<{ repaired: string; successful: boolean }> {
    let repaired = mermaidCode;

    // Apply all repairs
    repaired = this.addDiagramDeclaration(repaired);
    repaired = this.fixGenericTypes(repaired);
    repaired = this.flattenNestedNamespaces(repaired);
    repaired = this.extractNamespaceRelations(repaired);
    repaired = this.fixTrailingCommas(repaired);
    repaired = this.normalizeWhitespace(repaired);

    // Validate
    const result = await this.parseValidator.validate(repaired);

    return {
      repaired,
      successful: result.valid,
    };
  }
}
