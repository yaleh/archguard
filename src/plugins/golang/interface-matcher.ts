/**
 * Interface Matcher - Detects implicit interface implementations in Go
 *
 * Two-tier approach:
 * 1. Primary: gopls semantic analysis (high accuracy)
 * 2. Fallback: Name-based structural matching (good coverage)
 *
 * Includes embedded method promotion per Go spec:
 * - Value receiver methods belong to both T and *T method sets
 * - Pointer receiver methods belong only to *T method set
 * - Embedded types promote their methods to the embedding type
 */

import type {
  GoRawStruct,
  GoRawInterface,
  InferredImplementation,
  MethodSet,
  MethodSignature,
} from './types.js';
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
          const matchedStruct = structs.find((s) => s.name === impl.structName);

          if (matchedStruct) {
            // Get matched methods
            const ifaceMethodNames = iface.methods.map((m) => m.name);
            const structMethodNames = matchedStruct.methods.map((m) => m.name);
            const matchedMethods = ifaceMethodNames.filter((name) =>
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
      const goplsMatchedStructs = new Set(results.map((r) => r.structName));
      const unmatchedStructs = structs.filter((s) => !goplsMatchedStructs.has(s.name));

      if (unmatchedStructs.length > 0) {
        const fallbackResults = this.matchImplicitImplementations(unmatchedStructs, interfaces);
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
   * Match structs that implement interfaces, considering embedded method promotion
   *
   * This method builds complete method sets including promoted methods from
   * embedded types, then checks interface implementation.
   */
  matchImplicitImplementationsWithEmbedding(
    structs: GoRawStruct[],
    interfaces: GoRawInterface[],
    structMap: Map<string, GoRawStruct>
  ): InferredImplementation[] {
    const results: InferredImplementation[] = [];

    // Build method sets for all structs
    const methodSets = new Map<string, MethodSet>();
    for (const struct of structs) {
      methodSets.set(struct.name, this.buildMethodSet(struct, structMap));
    }

    for (const struct of structs) {
      const methodSet = methodSets.get(struct.name);

      for (const iface of interfaces) {
        const match = this.checkMethodSetImplementsInterface(struct, methodSet, iface);
        if (match) {
          results.push(match);
        }
      }
    }

    return results;
  }

  /**
   * Build complete method set for a struct, including promoted methods
   *
   * Go method set rules:
   * - Value receiver methods belong to both T and *T
   * - Pointer receiver methods belong only to *T
   * - Embedded types promote their methods
   * - Outer methods shadow inner methods (conflict resolution)
   * - Same-level ambiguous methods are not promoted
   *
   * @param struct The struct to build method set for
   * @param structMap Map of all structs for resolving embeddings
   * @param visited Set of visited types in the current chain (for cycle detection)
   * @param isRoot Whether this is the root struct (not called recursively)
   */
  buildMethodSet(
    struct: GoRawStruct,
    structMap: Map<string, GoRawStruct>,
    visited: Set<string> = new Set(),
    isRoot: boolean = true
  ): MethodSet {
    const valueMethodSet = new Map<string, MethodSignature>();
    const pointerMethodSet = new Map<string, MethodSignature>();

    // Add struct's own methods
    for (const method of struct.methods) {
      const signature: MethodSignature = {
        name: method.name,
        normalizedSignature: this.normalizeMethodSignature(method),
      };

      // Check if pointer receiver
      const isPointerReceiver = method.receiverType?.startsWith('*') ?? false;

      if (isPointerReceiver) {
        // Pointer receiver methods only go to pointer method set
        pointerMethodSet.set(method.name, signature);
      } else {
        // Value receiver methods go to both sets
        valueMethodSet.set(method.name, signature);
        pointerMethodSet.set(method.name, signature);
      }
    }

    // For root, check if there's a cycle in the embedding chain
    // If there is, don't promote any methods
    if (isRoot && this.hasEmbeddingCycle(struct, structMap, new Set<string>())) {
      // Cycle detected - don't promote any methods
      return { valueMethodSet, pointerMethodSet };
    }

    // Resolve embedded methods
    this.resolveEmbeddedMethods(struct, valueMethodSet, pointerMethodSet, structMap, visited);

    return { valueMethodSet, pointerMethodSet };
  }

  /**
   * Check if there's a cycle in the embedding chain
   */
  private hasEmbeddingCycle(
    struct: GoRawStruct,
    structMap: Map<string, GoRawStruct>,
    visited: Set<string>
  ): boolean {
    if (visited.has(struct.name)) {
      return true; // Cycle detected
    }

    visited.add(struct.name);

    const embeddedTypes =
      struct.embeddedTypeRefs?.map((r) => r.name) ??
      struct.embeddedTypes.map((t) => (t.startsWith('*') ? t.slice(1) : t));

    for (const typeName of embeddedTypes) {
      const embeddedStruct = structMap.get(typeName);
      if (embeddedStruct) {
        if (this.hasEmbeddingCycle(embeddedStruct, structMap, new Set(visited))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Resolve and promote methods from embedded types
   *
   * Handles:
   * - Value embedding: struct { Base } - promotes both value and pointer methods
   * - Pointer embedding: struct { *Base } - only promotes to pointer method set
   * - Cycle detection: avoids infinite recursion
   * - Method conflicts: outer methods win, same-level conflicts are skipped
   */
  private resolveEmbeddedMethods(
    struct: GoRawStruct,
    valueMethodSet: Map<string, MethodSignature>,
    pointerMethodSet: Map<string, MethodSignature>,
    structMap: Map<string, GoRawStruct>,
    visited: Set<string>
  ): void {
    // Mark current struct as visited before processing embeddings
    visited.add(struct.name);

    // Check for embedded type references
    const embeddedRefs = struct.embeddedTypeRefs ?? [];
    const embeddedTypesToProcess: Array<{ typeName: string; isPointer: boolean }> = [];

    if (embeddedRefs.length === 0) {
      // Fall back to simple string-based embedded types if refs not available
      for (const embeddedType of struct.embeddedTypes) {
        const isPointer = embeddedType.startsWith('*');
        const typeName = isPointer ? embeddedType.slice(1) : embeddedType;
        embeddedTypesToProcess.push({ typeName, isPointer });
      }
    } else {
      // Use detailed embedded type references
      for (const embeddedRef of embeddedRefs) {
        embeddedTypesToProcess.push({
          typeName: embeddedRef.name,
          isPointer: embeddedRef.isPointer,
        });
      }
    }

    // First pass: collect all methods from all embeddings to detect conflicts
    // Map: methodName -> [{sig, isValueMethod, embeddingInfo}]
    const methodsFromEmbeddings = new Map<
      string,
      Array<{
        sig: MethodSignature;
        isValueMethod: boolean;
        isPointerEmbedding: boolean;
      }>
    >();

    for (const { typeName, isPointer } of embeddedTypesToProcess) {
      // Cycle detection
      if (visited.has(typeName)) {
        continue;
      }

      const embeddedStruct = structMap.get(typeName);
      if (!embeddedStruct) {
        continue; // Unknown type, skip
      }

      // Recursively resolve embedded methods of the embedded struct
      // Pass false for isRoot since this is a recursive call
      const embeddedMethodSet = this.buildMethodSet(
        embeddedStruct,
        structMap,
        new Set(visited),
        false
      );

      // Collect methods for conflict detection
      for (const [name, sig] of embeddedMethodSet.valueMethodSet) {
        if (!methodsFromEmbeddings.has(name)) {
          methodsFromEmbeddings.set(name, []);
        }
        methodsFromEmbeddings.get(name).push({
          sig,
          isValueMethod: true,
          isPointerEmbedding: isPointer,
        });
      }
      for (const [name, sig] of embeddedMethodSet.pointerMethodSet) {
        // Only add pointer-only methods (not already in value set)
        if (!embeddedMethodSet.valueMethodSet.has(name)) {
          if (!methodsFromEmbeddings.has(name)) {
            methodsFromEmbeddings.set(name, []);
          }
          methodsFromEmbeddings.get(name).push({
            sig,
            isValueMethod: false,
            isPointerEmbedding: isPointer,
          });
        }
      }
    }

    // Second pass: promote methods, handling conflicts
    for (const [name, entries] of methodsFromEmbeddings) {
      // Skip if outer struct already has this method (shadowing)
      if (valueMethodSet.has(name) || pointerMethodSet.has(name)) {
        continue;
      }

      // Check for ambiguity: multiple embeddings provide same method
      // All entries should come from the same embedding source (isPointerEmbedding)
      // If they come from different sources, it's ambiguous
      const sources = new Set(entries.map((e) => e.isPointerEmbedding));
      if (sources.size > 1 || entries.length > 1) {
        // Ambiguous: multiple sources provide this method
        continue;
      }

      // Single source, safe to promote
      const entry = entries[0];
      const { sig, isValueMethod, isPointerEmbedding } = entry;

      if (isPointerEmbedding) {
        // Pointer embedding: all methods only go to pointer method set
        pointerMethodSet.set(name, sig);
      } else {
        // Value embedding
        if (isValueMethod) {
          // Value receiver method - goes to both sets
          valueMethodSet.set(name, sig);
          pointerMethodSet.set(name, sig);
        } else {
          // Pointer receiver method - only goes to pointer set
          pointerMethodSet.set(name, sig);
        }
      }
    }
  }

  /**
   * Check if a method set implements an interface
   */
  private checkMethodSetImplementsInterface(
    struct: GoRawStruct,
    methodSet: MethodSet,
    iface: GoRawInterface
  ): InferredImplementation | null {
    // Get interface method names
    const ifaceMethodNames = iface.methods.map((m) => m.name);

    // Check if method set (pointer set for interface satisfaction) has all methods
    const matchedMethods: string[] = [];
    for (const methodName of ifaceMethodNames) {
      // Interface satisfaction uses the pointer method set (most permissive)
      if (methodSet.pointerMethodSet.has(methodName)) {
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

  /**
   * Normalize a method signature for comparison
   */
  private normalizeMethodSignature(method: {
    parameters: { type: string }[];
    returnTypes: string[];
  }): string {
    const paramTypes = method.parameters.map((p) => p.type).join(',');
    const returnTypes = method.returnTypes.join(',');
    return `(${paramTypes})(${returnTypes})`;
  }

  /**
   * Check if a struct implements an interface
   */
  private checkStructImplementsInterface(
    struct: GoRawStruct,
    iface: GoRawInterface
  ): InferredImplementation | null {
    // Build set of struct method names
    const structMethodNames = new Set(struct.methods.map((m) => m.name));

    // Get interface method names
    const ifaceMethodNames = iface.methods.map((m) => m.name);

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
