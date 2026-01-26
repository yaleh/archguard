/**
 * Type definitions for Mermaid diagram generation and validation
 */

/**
 * Detail level for Mermaid diagrams
 */
export type MermaidDetailLevel = 'package' | 'class' | 'method';

/**
 * Mermaid diagram types
 */
export type MermaidDiagramType = 'classDiagram' | 'flowchart' | 'stateDiagram';

/**
 * Grouping decision for organizing entities into packages
 */
export interface GroupingDecision {
  packages: PackageGroup[];
  layout: LayoutDecision;
}

/**
 * A package group containing related entities
 */
export interface PackageGroup {
  name: string;
  entities: string[]; // entity IDs
  reasoning?: string;
}

/**
 * Layout decision for the diagram
 */
export interface LayoutDecision {
  direction: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
  reasoning: string;
}

/**
 * Validation result from parse validator
 */
export interface ParseValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  message: string;
  line?: number;
  column?: number;
  code?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  message: string;
  line?: number;
  suggestion?: string;
}

/**
 * Structural validation result
 */
export interface StructuralValidationResult {
  valid: boolean;
  issues: StructuralIssue[];
}

/**
 * Structural issue in the diagram
 */
export interface StructuralIssue {
  type: 'missing-entity' | 'invalid-relation' | 'circular-dependency' | 'orphan-entity';
  message: string;
  entity?: string;
  details?: any;
}

/**
 * Render validation result
 */
export interface RenderValidationResult {
  valid: boolean;
  canRender: boolean;
  issues: RenderIssue[];
}

/**
 * Render issue
 */
export interface RenderIssue {
  type: 'size' | 'complexity' | 'syntax' | 'unsupported-feature';
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Quality validation result
 */
export interface QualityValidationResult {
  valid: boolean;
  score: number; // 0-100
  metrics: QualityMetrics;
  suggestions: QualitySuggestion[];
}

/**
 * Quality metrics
 */
export interface QualityMetrics {
  readability: number;
  completeness: number;
  consistency: number;
  complexity: number;
}

/**
 * Quality improvement suggestion
 */
export interface QualitySuggestion {
  type: 'layout' | 'grouping' | 'detail-level' | 'naming';
  message: string;
  impact: 'high' | 'medium' | 'low';
  action?: string;
}

/**
 * Combined validation pipeline result
 */
export interface ValidationPipelineResult {
  parse: ParseValidationResult;
  structural: StructuralValidationResult;
  render: RenderValidationResult;
  quality: QualityValidationResult;
  overall: {
    valid: boolean;
    canProceed: boolean;
    blockingIssues: string[];
  };
}

/**
 * Mermaid generator options
 */
export interface MermaidGeneratorOptions {
  level: MermaidDetailLevel;
  grouping: GroupingDecision;
  theme?: MermaidTheme;
  includePrivate?: boolean;
  includeProtected?: boolean;
  maxDepth?: number;
}

/**
 * Mermaid theme configuration
 */
export interface MermaidTheme {
  name?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';
  variables?: Record<string, string>;
}

/**
 * Mermaid renderer options
 */
export interface MermaidRendererOptions {
  format: 'svg' | 'png';
  theme?: MermaidTheme;
  backgroundColor?: string;
  width?: number;
  height?: number;
}

/**
 * Mermaid diagram output paths
 */
export interface MermaidOutputPaths {
  mmd: string; // .mmd file path
  svg: string; // .svg file path
  png: string; // .png file path
}

/**
 * Grouper strategy
 */
export type GrouperStrategy = 'heuristic' | 'llm';

/**
 * Grouper configuration
 */
export interface GrouperConfig {
  strategy: GrouperStrategy;
  maxPackages?: number;
  maxEntitiesPerPackage?: number;
  customRules?: GroupingRule[];
}

/**
 * Custom grouping rule
 */
export interface GroupingRule {
  pattern: RegExp;
  packageName: string;
  priority?: number;
}

/**
 * LLM grouper response structure
 */
export interface LLMGrouperResponse {
  packages: PackageGroup[];
  layout: LayoutDecision;
  reasoning: string;
}
