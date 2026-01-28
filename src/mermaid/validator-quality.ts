/**
 * Quality Validator
 * Validates the quality and readability of Mermaid diagrams
 */

import type { ArchJSON } from '../types/index.js';
import type { QualityValidationResult, QualityMetrics, QualitySuggestion } from './types.js';

/**
 * Validates quality aspects of Mermaid diagrams
 */
export class QualityValidator {
  /**
   * Validate diagram quality
   */
  validate(mermaidCode: string, archJson: ArchJSON): QualityValidationResult {
    const metrics = this.calculateMetrics(mermaidCode, archJson);
    const suggestions = this.generateSuggestions(mermaidCode, archJson, metrics);
    const score = this.calculateScore(metrics);

    return {
      valid: score >= 60, // Acceptable quality threshold
      score,
      metrics,
      suggestions,
    };
  }

  /**
   * Calculate quality metrics
   */
  private calculateMetrics(mermaidCode: string, archJson: ArchJSON): QualityMetrics {
    return {
      readability: this.calculateReadability(mermaidCode, archJson),
      completeness: this.calculateCompleteness(mermaidCode, archJson),
      consistency: this.calculateConsistency(mermaidCode),
      complexity: this.calculateComplexity(mermaidCode, archJson),
    };
  }

  /**
   * Calculate readability score (0-100)
   */
  private calculateReadability(mermaidCode: string, _archJson: ArchJSON): number {
    let score = 100;

    // Penalty for very long lines
    const lines = mermaidCode.split('\n');
    const longLines = lines.filter((line) => line.length > 100);
    score -= longLines.length * 2;

    // Penalty for deeply nested structures
    const maxNesting = this.calculateNestingDepth(mermaidCode);
    score -= (maxNesting - 3) * 5; // Penalty for depth > 3

    // Bonus for well-organized code (proper indentation)
    const wellIndented = lines.every((line, index) => {
      if (line.trim().length === 0) return true;
      const expectedIndent = this.calculateExpectedIndent(line, lines, index);
      const actualIndent = line.search(/\S/);
      return Math.abs(actualIndent - expectedIndent) <= 2;
    });
    if (wellIndented) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate completeness score (0-100)
   */
  private calculateCompleteness(mermaidCode: string, archJson: ArchJSON): number {
    let score = 100;

    // Check if all entities are present
    for (const entity of archJson.entities) {
      const entityPattern = new RegExp(`\\bclass\\s+${this.escapeRegex(entity.name)}\\b`, 'i');
      if (!entityPattern.test(mermaidCode)) {
        score -= 10;
      }
    }

    // Check if all relations are present
    for (const relation of archJson.relations) {
      const sourcePattern = new RegExp(`\\b${this.escapeRegex(relation.source)}\\b`);
      const targetPattern = new RegExp(`\\b${this.escapeRegex(relation.target)}\\b`);
      if (!sourcePattern.test(mermaidCode) || !targetPattern.test(mermaidCode)) {
        score -= 5;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate consistency score (0-100)
   */
  private calculateConsistency(mermaidCode: string): number {
    let score = 100;

    // Check for consistent naming conventions
    const classMatches = Array.from(mermaidCode.matchAll(/\bclass\s+(\w+)/g));
    const classNames = classMatches.map((m) => m[1] ?? '').filter(Boolean);

    // Check if all classes follow PascalCase
    const pascalCasePattern = /^[A-Z][a-zA-Z0-9]*$/;
    const nonPascalCase = classNames.filter((name) => name && !pascalCasePattern.test(name));
    score -= nonPascalCase.length * 5;

    // Check for consistent visibility modifier usage
    const memberMatches = Array.from(mermaidCode.matchAll(/^\s*([+\-#])?\s*\w+/gm));
    const membersWithVisibility = memberMatches.filter((m) => m[1] !== undefined).length;
    const totalMembers = memberMatches.length;

    if (totalMembers > 0) {
      const visibilityConsistency = (membersWithVisibility / totalMembers) * 100;
      if (visibilityConsistency < 80) {
        score -= 10;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate complexity score (0-100, higher is better/less complex)
   */
  private calculateComplexity(_mermaidCode: string, archJson: ArchJSON): number {
    let score = 100;

    // Penalty for many entities
    const entityCount = archJson.entities.length;
    score -= Math.max(0, (entityCount - 20) * 2);

    // Penalty for many relations
    const relationCount = archJson.relations.length;
    score -= Math.max(0, (relationCount - 30) * 2);

    // Penalty for high fan-in/fan-out
    const entityConnectivity = new Map<string, number>();
    for (const relation of archJson.relations) {
      entityConnectivity.set(relation.source, (entityConnectivity.get(relation.source) ?? 0) + 1);
      entityConnectivity.set(relation.target, (entityConnectivity.get(relation.target) ?? 0) + 1);
    }

    for (const [entity, connections] of entityConnectivity) {
      if (connections > 10) {
        score -= (connections - 10) * 2;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate improvement suggestions
   */
  private generateSuggestions(
    mermaidCode: string,
    archJson: ArchJSON,
    metrics: QualityMetrics
  ): QualitySuggestion[] {
    const suggestions: QualitySuggestion[] = [];

    // Readability suggestions
    if (metrics.readability < 70) {
      suggestions.push({
        type: 'layout',
        message: 'Diagram readability could be improved',
        impact: 'medium',
        action: 'Consider reducing nesting depth and line length',
      });
    }

    // Completeness suggestions
    if (metrics.completeness < 80) {
      suggestions.push({
        type: 'detail-level',
        message: 'Some entities or relations may be missing',
        impact: 'high',
        action: 'Verify all important entities and their relationships are included',
      });
    }

    // Consistency suggestions
    if (metrics.consistency < 70) {
      suggestions.push({
        type: 'naming',
        message: 'Naming conventions are not consistent',
        impact: 'low',
        action: 'Use PascalCase for class names consistently',
      });
    }

    // Complexity suggestions
    if (metrics.complexity < 60) {
      suggestions.push({
        type: 'grouping',
        message: 'Diagram is very complex',
        impact: 'high',
        action: 'Consider splitting into multiple diagrams or using grouping',
      });
    }

    // Specific checks
    const classMatches = Array.from(mermaidCode.matchAll(/\bclass\s+(\w+)/g));
    if (classMatches.length > 30) {
      suggestions.push({
        type: 'layout',
        message: 'Too many classes in one diagram',
        impact: 'high',
        action: 'Consider creating multiple diagrams at different abstraction levels',
      });
    }

    return suggestions;
  }

  /**
   * Calculate overall quality score
   */
  private calculateScore(metrics: QualityMetrics): number {
    // Weighted average of metrics
    return Math.round(
      metrics.readability * 0.25 +
        metrics.completeness * 0.35 +
        metrics.consistency * 0.2 +
        metrics.complexity * 0.2
    );
  }

  /**
   * Calculate expected indentation for a line
   */
  private calculateExpectedIndent(line: string, lines: string[], index: number): number {
    const trimmed = line.trim();
    if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
      // Decrease indent for closing braces
      let openBraces = 0;
      for (let i = 0; i < index; i++) {
        const lineContent = lines[i];
        if (lineContent) {
          openBraces += (lineContent.match(/\{/g) || []).length;
          openBraces -= (lineContent.match(/\}/g) || []).length;
        }
      }
      return Math.max(0, openBraces * 2);
    }
    return 0; // Default
  }

  /**
   * Calculate maximum nesting depth
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

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
