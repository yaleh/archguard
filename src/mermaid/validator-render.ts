/**
 * Render Validator
 * Validates whether a Mermaid diagram can be successfully rendered
 */

import type { RenderValidationResult, RenderIssue } from './types.js';

/**
 * Validates renderability of Mermaid diagrams
 */
export class RenderValidator {
  private readonly maxNodes = 100;
  private readonly maxEdges = 200;
  private readonly maxDepth = 10;

  /**
   * Validate if diagram can be rendered
   */
  validate(mermaidCode: string): RenderValidationResult {
    const issues: RenderIssue[] = [];

    // Check for size issues
    issues.push(...this.checkSize(mermaidCode));

    // Check for complexity issues
    issues.push(...this.checkComplexity(mermaidCode));

    // Check for unsupported features
    issues.push(...this.checkUnsupportedFeatures(mermaidCode));

    // Check if rendering is possible
    const canRender = issues.filter((i) => i.severity === 'error').length === 0;

    return {
      valid: canRender,
      canRender,
      issues,
    };
  }

  /**
   * Check for size issues
   */
  private checkSize(mermaidCode: string): RenderIssue[] {
    const issues: RenderIssue[] = [];

    // Count nodes (classes, states, etc.)
    const nodeMatches = mermaidCode.matchAll(/\bclass\s+(\w+)/g);
    const nodeCount = Array.from(nodeMatches).length;

    if (nodeCount > this.maxNodes) {
      issues.push({
        type: 'size',
        message: `Too many nodes (${nodeCount} > ${this.maxNodes})`,
        severity: 'warning',
      });
    }

    // Count edges (relations)
    const edgeMatches = mermaidCode.matchAll(/-->|-->|<--|-->/g);
    const edgeCount = Array.from(edgeMatches).length;

    if (edgeCount > this.maxEdges) {
      issues.push({
        type: 'size',
        message: `Too many edges (${edgeCount} > ${this.maxEdges})`,
        severity: 'warning',
      });
    }

    return issues;
  }

  /**
   * Check for complexity issues
   */
  private checkComplexity(mermaidCode: string): RenderIssue[] {
    const issues: RenderIssue[] = [];

    // Check nesting depth
    const maxNesting = this.calculateNestingDepth(mermaidCode);
    if (maxNesting > this.maxDepth) {
      issues.push({
        type: 'complexity',
        message: `Nesting depth too high (${maxNesting} > ${this.maxDepth})`,
        severity: 'warning',
      });
    }

    // Check for overly complex member definitions
    const complexMemberMatches = mermaidCode.matchAll(/\w+\([^)]{100,}\)/g);
    if (Array.from(complexMemberMatches).length > 0) {
      issues.push({
        type: 'complexity',
        message: 'Some member definitions are very complex and may not render well',
        severity: 'warning',
      });
    }

    return issues;
  }

  /**
   * Check for unsupported features
   */
  private checkUnsupportedFeatures(mermaidCode: string): RenderIssue[] {
    const issues: RenderIssue[] = [];

    // Mermaid class diagrams have some limitations
    // Check for potentially problematic patterns

    // Very long class names might cause issues
    const longClassMatches = mermaidCode.matchAll(/class\s+"([^"]{50,})"/g);
    for (const match of longClassMatches) {
      if (match[1]) {
        issues.push({
          type: 'syntax',
          message: `Very long class name may cause rendering issues: ${match[1].substring(0, 30)}...`,
          severity: 'warning',
        });
      }
    }

    // Check for special characters that might cause issues
    const specialCharMatches = mermaidCode.matchAll(/class\s+([^w\s]+[w\s]*)/g);
    for (const match of specialCharMatches) {
      if (match[1] && /[|{}\[\]()]/.test(match[1])) {
        issues.push({
          type: 'syntax',
          message: `Class name with special characters may cause issues: ${match[1]}`,
          severity: 'error',
        });
      }
    }

    return issues;
  }

  /**
   * Calculate maximum nesting depth in the code
   */
  private calculateNestingDepth(mermaidCode: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of mermaidCode) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }

    return maxDepth;
  }
}
