/**
 * Interface Matcher - Detects implicit interface implementations in Go
 *
 * Simplified version: Basic structural matching without method promotion
 */

import type { GoRawStruct, GoRawInterface, InferredImplementation } from './types.js';

export class InterfaceMatcher {
  /**
   * Match structs that implicitly implement interfaces
   *
   * Simplified approach: Just check if struct has all interface methods by name
   * TODO: Add method signature matching and embedded field promotion
   */
  matchImplicitImplementations(
    structs: GoRawStruct[],
    interfaces: GoRawInterface[]
  ): InferredImplementation[] {
    const results: InferredImplementation[] = [];

    for (const struct of structs) {
      for (const iface of interfaces) {
        const match = this.checkStructImplementsInterface(struct, iface);
        if (match) {
          results.push(match);
        }
      }
    }

    return results;
  }

  /**
   * Check if a struct implements an interface
   */
  private checkStructImplementsInterface(
    struct: GoRawStruct,
    iface: GoRawInterface
  ): InferredImplementation | null {
    // Build set of struct method names
    const structMethodNames = new Set(struct.methods.map(m => m.name));

    // Get interface method names
    const ifaceMethodNames = iface.methods.map(m => m.name);

    // Check if struct has all interface methods
    const matchedMethods: string[] = [];
    for (const methodName of ifaceMethodNames) {
      if (structMethodNames.has(methodName)) {
        matchedMethods.push(methodName);
      }
    }

    // If all interface methods are matched, it's an implementation
    if (matchedMethods.length === ifaceMethodNames.length && ifaceMethodNames.length > 0) {
      return {
        structName: struct.name,
        structPackageId: struct.packageName,
        interfaceName: iface.name,
        interfacePackageId: iface.packageName,
        confidence: 1.0,
        matchedMethods,
        source: 'inferred',
      };
    }

    return null;
  }
}
