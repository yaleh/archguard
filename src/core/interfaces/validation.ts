/**
 * Validation interface for ArchJSON validation
 */

import type { ArchJSON } from '@/types/index.js';

/**
 * Severity level for validation issues
 */
type ValidationSeverity = 'error' | 'warning';

/**
 * Validation error that prevents successful processing
 */
export interface ValidationError {
  /**
   * Error code for programmatic identification
   */
  code: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * JSONPath to the problematic element
   */
  path?: string;

  /**
   * Severity level (always 'error' for ValidationError)
   */
  severity: 'error';
}

/**
 * Validation warning that doesn't prevent processing
 */
export interface ValidationWarning {
  /**
   * Warning code for programmatic identification
   */
  code: string;

  /**
   * Human-readable warning message
   */
  message: string;

  /**
   * JSONPath to the element with the issue
   */
  path?: string;

  /**
   * Severity level (always 'warning' for ValidationWarning)
   */
  severity: 'warning';

  /**
   * Optional suggestion for fixing the issue
   */
  suggestion?: string;
}

/**
 * Result of ArchJSON validation
 */
export interface ValidationResult {
  /**
   * Whether the ArchJSON is valid (no errors)
   * Warnings do not affect validity
   */
  valid: boolean;

  /**
   * Array of validation errors
   * Empty array if valid
   */
  errors: ValidationError[];

  /**
   * Array of validation warnings
   * May be present even when valid is true
   */
  warnings: ValidationWarning[];

  /**
   * Time taken to perform validation in milliseconds
   */
  durationMs: number;
}

/**
 * Interface for validating ArchJSON structures
 *
 * Plugins can optionally implement this interface to provide
 * language-specific validation rules beyond the core schema.
 */
export interface IValidator {
  /**
   * Validate an ArchJSON structure
   *
   * Checks for:
   * - Schema compliance (required fields, correct types)
   * - Referential integrity (entity/relation references exist)
   * - Language-specific constraints
   * - Best practices and conventions
   *
   * @param archJson - The ArchJSON structure to validate
   * @returns Validation result with errors, warnings, and timing
   */
  validate(archJson: ArchJSON): ValidationResult;
}
