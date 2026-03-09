import type { DetailLevel, OutputFormat } from './config-mermaid.js';

export interface DiagramMetadata {
  title?: string;
  subtitle?: string;
  purpose?: string;
  primaryActors?: string[];
  input?: {
    type: string;
    description?: string;
    example?: string;
  };
  output?: {
    description: string;
    formats?: string[];
    example?: string;
  };
}

export interface DesignInfo {
  architectureStyle?: 'layered' | 'event-driven' | 'microkernel' | 'serverless';
  patterns?: DesignPatternInfo[];
  principles?: string[];
  decisions?: ArchitecturalDecision[];
}

export interface DesignPatternInfo {
  name: string;
  category: PatternCategory;
  participants: string[];
  description: string;
  codeExample?: string;
}

export type PatternCategory = 'creational' | 'structural' | 'behavioral' | 'concurrency';

export interface ArchitecturalDecision {
  topic: string;
  decision: string;
  rationale: string;
  alternatives?: string[];
}

export interface ProcessInfo {
  stages?: number;
  stageList?: ProcessStage[];
  dataFlow?: string;
  keyDependencies?: string[];
}

export interface ProcessStage {
  order: number;
  name: string;
  description: string;
  namespace?: string;
  patterns?: string[];
}

export interface AnnotationConfig {
  enableComments?: boolean;
  highlightPatterns?: boolean;
  showExternalDeps?: boolean;
  includeUsageExample?: boolean;
  enableVisibleTitle?: boolean;
  visibleTitleSections?: (
    | 'title'
    | 'subtitle'
    | 'purpose'
    | 'input'
    | 'output'
    | 'patterns'
    | 'principles'
    | 'process'
  )[];
  titlePosition?: 'top' | 'bottom';
}

export interface ClassHighlightConfig {
  highlightClasses?: string[];
  annotateClasses?: ClassAnnotation[];
  visibility?: {
    show?: string[];
    hide?: string[];
  };
}

export interface ClassAnnotation {
  className: string;
  note?: string;
  stereotypes?: string[];
  responsibility?: string;
}

export interface DiagramConfig {
  name: string;
  sources: string[];
  level: DetailLevel;
  description?: string;
  format?: OutputFormat;
  exclude?: string[];
  language?: string;
  languageSpecific?: Record<string, unknown>;
  queryRole?: 'primary' | 'secondary';
  metadata?: DiagramMetadata;
  design?: DesignInfo;
  process?: ProcessInfo;
  annotations?: AnnotationConfig;
  classes?: ClassHighlightConfig;
}
