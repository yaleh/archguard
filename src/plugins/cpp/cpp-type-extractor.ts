/**
 * CppTypeExtractor — parses C++ type strings to extract base type names
 * and classify field relations (composition vs aggregation).
 */

const PRIMITIVES = new Set([
  'void', 'bool', 'char', 'wchar_t', 'char8_t', 'char16_t', 'char32_t',
  'short', 'int', 'long', 'float', 'double', 'auto', 'nullptr_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int_fast8_t', 'int_fast16_t', 'int_fast32_t', 'int_fast64_t',
  'uint_fast8_t', 'uint_fast16_t', 'uint_fast32_t', 'uint_fast64_t',
  'int_least8_t', 'int_least16_t', 'int_least32_t', 'int_least64_t',
  'uint_least8_t', 'uint_least16_t', 'uint_least32_t', 'uint_least64_t',
  'intptr_t', 'uintptr_t', 'intmax_t', 'uintmax_t',
  'size_t', 'ssize_t', 'ptrdiff_t', 'off_t',
  'unsigned', 'signed',
]);

const STL_TYPES = new Set([
  'string', 'wstring', 'u8string', 'u16string', 'u32string',
  'string_view', 'wstring_view',
  'mutex', 'recursive_mutex', 'timed_mutex', 'recursive_timed_mutex',
  'shared_mutex', 'shared_timed_mutex',
  'condition_variable', 'condition_variable_any',
  'thread', 'jthread',
  'exception', 'runtime_error', 'logic_error', 'bad_alloc',
  'error_code', 'error_condition',
  'ios_base', 'istream', 'ostream', 'iostream', 'ifstream', 'ofstream', 'fstream',
  'istringstream', 'ostringstream', 'stringstream',
  'regex', 'smatch', 'cmatch',
  'filesystem',
  'any', 'monostate', 'nullopt_t', 'byte',
]);

/** std:: container / smart-pointer templates that wrap a value type */
const SMART_PTR_TEMPLATES = new Set([
  'unique_ptr', 'shared_ptr', 'weak_ptr',
]);

/** Templates whose LAST type arg is the value element type */
const CONTAINER_TEMPLATES = new Set([
  'vector', 'list', 'deque', 'queue', 'stack', 'priority_queue',
  'set', 'multiset', 'unordered_set', 'unordered_multiset',
  'map', 'multimap', 'unordered_map', 'unordered_multimap',
  'array', 'span', 'initializer_list',
  'optional', 'variant', 'tuple',
  'function', 'packaged_task', 'promise', 'future', 'shared_future',
]);

export class CppTypeExtractor {
  /**
   * Extract meaningful base type name(s) from a raw C++ type string.
   * Returns [] for primitives, STL leaf types, and single-letter template params.
   */
  extractTypes(rawType: string): string[] {
    if (!rawType || rawType.trim() === '') return [];

    const stripped = this.strip(rawType);
    if (!stripped) return [];

    // Handle template types: Foo<T, U, ...>
    const tmplMatch = stripped.match(/^([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)<(.+)>$/);
    if (tmplMatch) {
      return this.extractFromTemplate(tmplMatch[1], tmplMatch[2]);
    }

    // Plain type (no template args)
    return this.filterType(stripped) ? [stripped] : [];
  }

  /**
   * Classify a field's raw type as 'composition' or 'aggregation'.
   *
   * - Smart pointers                  → composition
   * - Raw pointer (*) or stored ref   → aggregation
   * - Container of raw pointers       → aggregation (e.g. vector<T*>)
   * - Value type / container of owned → composition
   */
  classifyFieldRelation(rawType: string): 'composition' | 'aggregation' {
    if (this.isSmartPointer(rawType)) return 'composition';
    if (this.isRawPointerOrRef(rawType)) return 'aggregation';
    // Container whose element type involves a raw pointer → aggregation
    if (rawType.includes('*')) return 'aggregation';
    return 'composition';
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Strip leading qualifiers and trailing pointer/ref sigils */
  private strip(raw: string): string {
    let s = raw.trim();

    // Strip leading keywords
    s = s.replace(/^\b(struct|class|const|volatile|mutable|explicit|inline|extern|static|register)\b\s*/g, '').trim();
    s = s.replace(/^\b(const|volatile)\b\s*/g, '').trim();

    // Strip trailing const/volatile/ptr/ref (outside angle brackets)
    s = this.stripTrailing(s);

    // Strip std:: prefix for resolution
    if (s.startsWith('std::')) {
      s = s.slice(5);
    }

    return s.trim();
  }

  /** Remove trailing *, &, &&, const, volatile — only outside <...> */
  private stripTrailing(s: string): string {
    // Iteratively remove trailing qualifiers
    const trailPattern = /(\s*(const|volatile|\*|&|&&)\s*)+$/;
    // Only strip if these are NOT inside angle brackets
    const depth = (s.match(/</g) || []).length - (s.match(/>/g) || []).length;
    if (depth !== 0) return s; // malformed, leave as-is
    return s.replace(trailPattern, '').trim();
  }

  private extractFromTemplate(templateName: string, argsStr: string): string[] {
    // Normalize templateName: strip std:: prefix
    const tname = templateName.startsWith('std::') ? templateName.slice(5) : templateName;
    const args = this.splitTemplateArgs(argsStr);

    if (SMART_PTR_TEMPLATES.has(tname)) {
      // unique_ptr<T, Deleter> → T is the first arg
      return this.extractFromArg(args[0] ?? '');
    }

    if (CONTAINER_TEMPLATES.has(tname)) {
      // map<K,V> → last arg is value type; others → first arg
      const isMapLike = ['map', 'multimap', 'unordered_map', 'unordered_multimap'].includes(tname);
      const valueArg = isMapLike ? (args[args.length - 1] ?? '') : (args[0] ?? '');
      return this.extractFromArg(valueArg);
    }

    // Unknown template: extract from outer name + all args
    const results: string[] = [];
    if (this.filterType(tname)) results.push(tname);
    for (const arg of args) {
      results.push(...this.extractFromArg(arg));
    }
    return results;
  }

  private extractFromArg(arg: string): string[] {
    return this.extractTypes(arg);
  }

  /** Split comma-separated template args, respecting nested <> */
  private splitTemplateArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of argsStr) {
      if (ch === '<') { depth++; current += ch; }
      else if (ch === '>') { depth--; current += ch; }
      else if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());
    return args;
  }

  /** Returns true if the type name should be kept (not filtered out) */
  private filterType(name: string): boolean {
    if (!name || name.length === 0) return false;
    // Single-letter → template param
    if (name.length === 1 && /[A-Z]/.test(name)) return false;
    // Two-letter common template params (e.g. TK, TV)
    if (name.length <= 2 && /^[A-Z]{1,2}$/.test(name)) return false;
    if (PRIMITIVES.has(name)) return false;
    if (STL_TYPES.has(name)) return false;
    // Numeric literals (e.g. array size)
    if (/^\d/.test(name)) return false;
    return true;
  }

  private isSmartPointer(raw: string): boolean {
    return /\bstd::(unique_ptr|shared_ptr|weak_ptr)\b/.test(raw) ||
      /\b(unique_ptr|shared_ptr|weak_ptr)\b/.test(raw);
  }

  private isRawPointerOrRef(raw: string): boolean {
    // A * or & that is NOT inside angle brackets
    const depth = (raw.match(/</g) || []).length - (raw.match(/>/g) || []).length;
    if (depth !== 0) return false;
    // Remove template contents before checking for * or &
    const noTemplate = raw.replace(/<[^<>]*>/g, '');
    return /[*&]/.test(noTemplate);
  }
}
