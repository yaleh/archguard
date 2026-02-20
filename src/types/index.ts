/**
 * Core type definitions for ArchGuard
 */

// Export configuration types (v2.0)
export * from './config.js';

/**
 * Supported programming languages
 */
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust';

/**
 * Module structure for organizing entities
 */
export interface Module {
  name: string;
  entities: string[];
  submodules?: Module[];
}

/**
 * Main architecture JSON structure
 */
export interface ArchJSON {
  version: string;
  language: SupportedLanguage;
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];
  relations: Relation[];
  modules?: Module[];
  metadata?: Record<string, unknown>;
}

/**
 * Entity types in the architecture
 */
export type EntityType = 'class' | 'interface' | 'enum' | 'struct' | 'trait' | 'abstract_class' | 'function';

/**
 * Visibility modifiers
 */
export type Visibility = 'public' | 'private' | 'protected';

/**
 * Entity representation
 */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  visibility: Visibility;
  members: Member[];
  sourceLocation: SourceLocation;
  decorators?: Decorator[];
  isAbstract?: boolean;
  isConst?: boolean;
  genericParams?: string[];
  extends?: string[];
  implements?: string[];
}

/**
 * Member types (properties and methods)
 */
export type MemberType = 'property' | 'method' | 'constructor' | 'field';

/**
 * Member of an entity
 */
export interface Member {
  name: string;
  type: MemberType;
  visibility: Visibility;
  returnType?: string;
  parameters?: Parameter[];
  isStatic?: boolean;
  isAbstract?: boolean;
  isAsync?: boolean;
  isReadonly?: boolean;
  isOptional?: boolean;
  fieldType?: string;
  defaultValue?: string;
  decorators?: Decorator[];
}

/**
 * Method/function parameter
 */
export interface Parameter {
  name: string;
  type: string;
  isOptional?: boolean;
  defaultValue?: string;
}

/**
 * Source code location
 */
export interface SourceLocation {
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Decorator information
 */
export interface Decorator {
  name: string;
  arguments?: string[] | Record<string, unknown>;
}

/**
 * Relation types between entities
 */
export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association';

/**
 * Relation between entities
 */
export interface Relation {
  id: string;
  type: RelationType;
  source: string;
  target: string;
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls';
}
