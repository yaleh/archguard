/**
 * KotlinTypeExtractor — parses Kotlin type strings to extract base type names
 * and classify field relations.
 *
 * Pure logic module — no tree-sitter or filesystem imports.
 */

export const KOTLIN_PRIMITIVE_TYPES = new Set([
  // Scalar / built-in types
  'String', 'Int', 'Long', 'Double', 'Float', 'Boolean', 'Byte', 'Short', 'Char',
  'Unit', 'Any', 'Nothing', 'Number',
  // Standard collections
  'List', 'MutableList', 'Map', 'MutableMap', 'Set', 'MutableSet',
  'Array', 'Pair', 'Triple', 'Sequence',
  // Byte / int arrays
  'InputStream', 'OutputStream', 'ByteArray', 'IntArray',
  // Kotlin coroutines
  'Flow', 'StateFlow', 'SharedFlow', 'Channel',
  // Android basics
  'Context', 'Intent', 'Bundle', 'Uri',
]);

export class KotlinTypeExtractor {
  /**
   * Extract meaningful custom type names from a raw Kotlin type string.
   *
   * Handles:
   *   - Nullable types:  `UserRepository?`  → `['UserRepository']`
   *   - Simple generics: `List<Order>`       → `['Order']`
   *   - Multi-param:     `Map<String, Repo>` → `['Repo']`
   *   - Nested generics: `Flow<List<Order>>` → `['Order']`
   *
   * Returns [] for types that consist entirely of primitive / stdlib types.
   */
  extractTypes(rawType: string): string[] {
    if (!rawType || rawType.trim() === '') return [];

    // Strip trailing nullable marker
    const stripped = rawType.trim().replace(/\?$/, '').trim();
    if (!stripped) return [];

    // Check for generic: Outer<Inner, ...>
    const genericMatch = stripped.match(/^([A-Za-z_]\w*)<(.+)>$/);
    if (genericMatch) {
      const outerName = genericMatch[1];
      const argsStr = genericMatch[2];

      const results = new Set<string>();

      // If the outer type itself is not a known primitive/stdlib, keep it.
      // However, for standard collection wrappers (List, Map, Flow, etc.) we
      // intentionally unwrap and only surface the inner types.
      if (!KOTLIN_PRIMITIVE_TYPES.has(outerName)) {
        results.add(outerName);
      }

      // Recursively extract from each type argument
      for (const arg of this.splitTypeArgs(argsStr)) {
        for (const t of this.extractTypes(arg)) {
          results.add(t);
        }
      }

      return Array.from(results);
    }

    // Plain (non-generic) type
    if (KOTLIN_PRIMITIVE_TYPES.has(stripped)) return [];
    return [stripped];
  }

  /**
   * Classify a Kotlin field relation type.
   *
   * Kotlin has no bare pointers — every reference is either a direct object
   * reference or a nullable reference (`T?`).  Both map to **composition**
   * in an architecture diagram.
   */
  classifyFieldRelation(_rawType: string): 'composition' {
    return 'composition';
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Split a comma-separated type-argument string while respecting nested `<>`.
   *
   * e.g. `"String, Map<Int, Order>"` → `["String", "Map<Int, Order>"]`
   */
  private splitTypeArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of argsStr) {
      if (ch === '<') {
        depth++;
        current += ch;
      } else if (ch === '>') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) args.push(trimmed);
        current = '';
      } else {
        current += ch;
      }
    }

    const trimmed = current.trim();
    if (trimmed) args.push(trimmed);
    return args;
  }
}
