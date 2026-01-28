/**
 * External Dependencies Filter
 *
 * Filters out warnings for external dependency types that are not part of the user's codebase.
 * This reduces noise from external libraries (ts-morph, Node.js built-ins, zod, etc.)
 */

/**
 * Common external dependency types (should not trigger warnings)
 */
export const EXTERNAL_DEPENDENCIES = new Set([
  // ts-morph types
  'Project',
  'SourceFile',
  'ClassDeclaration',
  'InterfaceDeclaration',
  'EnumDeclaration',
  'PropertyDeclaration',
  'MethodDeclaration',
  'ConstructorDeclaration',
  'PropertySignature',
  'MethodSignature',
  'ParameterDeclaration',
  'Decorator',
  'TsMorphDecorator',
  'Type',
  'TypeNode',

  // Node.js built-in types
  'EventEmitter',
  'ReadStream',
  'WriteStream',
  'Buffer',

  // zod types
  'z.infer',
  'ZodType',
  'ZodSchema',

  // Common library types
  'Ora',
  'Commander',
  'Promise',
  'Array',
  'Map',
  'Set',
  'Date',
  'Error',
  'RegExp',
]);

/**
 * Check if a type name is an external dependency
 *
 * @param typeName - The type name to check (may include generic parameters)
 * @returns true if the type is an external dependency
 */
export function isExternalDependency(typeName: string): boolean {
  // Remove generic parameters, e.g., z.infer<any> → z.infer
  const baseName = typeName.split('<')[0].trim();
  return EXTERNAL_DEPENDENCIES.has(baseName);
}
