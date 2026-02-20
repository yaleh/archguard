/**
 * Interface Matcher - Detects implicit interface implementations in Go
 *
 * Two-tier approach:
 * 1. Primary: gopls semantic analysis (high accuracy)
 * 2. Fallback: Name-based structural matching (good coverage)
 */

import type { GoRawStruct, GoRawInterface, InferredImplementation } from './types.js';
import type { GoplsClient } from './gopls-client.js';

export class InterfaceMatcher {
  /**
   * Match structs that implicitly implement interfaces using gopls
   *
   * Primary strategy: Use gopls for semantic analysis
   * Fallback: Use name-based matching when gopls unavailable or fails
   */
  async matchWithGopls(
    structs: GoRawStruct[],
    interfaces: GoRawInterface[],
    goplsClient: GoplsClient | null
  ): Promise<InferredImplementation[]> {
    // If gopls not available, fall back to name-based matching
    if (!goplsClient || !goplsClient.isInitialized()) {
      return this.matchImplicitImplementations(structs, interfaces);
    }

    const results: InferredImplementation[] = [];

    try {
      // Query gopls for each interface
      for (const iface of interfaces) {
        const implementations = await goplsClient.getImplementations(
          iface.name,
          iface.location.file,
          iface.location.startLine
        );

        // Match gopls results to our structs
        for (const impl of implementations) {
          const matchedStruct = structs.find(s => s.name === impl.structName);

          if (matchedStruct) {
            // Get matched methods
            const ifaceMethodNames = iface.methods.map(m => m.name);
            const structMethodNames = matchedStruct.methods.map(m => m.name);
            const matchedMethods = ifaceMethodNames.filter(name =>
              structMethodNames.includes(name)
            );

            results.push({
              structName: matchedStruct.name,
              structPackageId: matchedStruct.packageName,
              interfaceName: iface.name,
              interfacePackageId: iface.packageName,
              confidence: 0.99, // High confidence from gopls
              matchedMethods,
              source: 'gopls',
            });
          }
        }
      }

      // Fall back to name-based matching for structs not found by gopls
      const goplsMatchedStructs = new Set(results.map(r => r.structName));
      const unmatchedStructs = structs.filter(s => !goplsMatchedStructs.has(s.name));

      if (unmatchedStructs.length > 0) {
        const fallbackResults = this.matchImplicitImplementations(
          unmatchedStructs,
          interfaces
        );
        results.push(...fallbackResults);
      }

      return results;
    } catch (error) {
      // On error, fall back completely to name-based matching
      console.warn('gopls matching failed, using fallback:', error);
      return this.matchImplicitImplementations(structs, interfaces);
    }
  }

  /**
   * Match structs that implicitly implement interfaces
   *
   * Name-based approach: Check if struct has all interface methods by name
   * Used as fallback when gopls unavailable
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
