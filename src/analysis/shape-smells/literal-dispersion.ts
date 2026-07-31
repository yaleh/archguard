/**
 * LiteralDispersionDetector — extracts discriminator types (string literal
 * unions and enums) from TypeScript source and detects when individual
 * literal values are compared across multiple files.
 *
 * Regex-based v1: no AST parsing required, no git history dependency.
 */

import type {
  DiscriminatorType,
  DiscriminatorKind,
  SourceLocation,
  LiteralDispersionSmell,
} from './types.js';
import { filterCrossModule } from './scope-filter.js';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches `type Name = "v1" | "v2" | ...` (with optional trailing semicolon). */
const STRING_LITERAL_UNION_RE =
  /(?:export\s+)?type\s+(\w+)\s*=\s*((?:"[^"]*"\s*\|\s*)*"[^"]*")\s*;?/g;

/** Matches individual string literals within a union. */
const STRING_LITERAL_RE = /"([^"]*)"/g;

/**
 * Matches enum declarations (both string-valued and bare members):
 *   enum Name { A = "a", B = "b" }
 *   enum Name { A, B }
 * Captures the enum name and the member block (everything between the braces).
 */
const ENUM_RE = /(?:export\s+)?enum\s+(\w+)\s*\{([^}]*)\}/gs;

/** Matches a single enum member, extracting the member name and optional value. */
const ENUM_MEMBER_RE = /(\w+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\d+)))?\s*(?:,|$)/g;

/** Matches string literal in a case clause: case "v": */
const CASE_LITERAL_RE = /case\s+"([^"]+)":/g;

/** Matches qualified enum member reference in a case clause: case X.V: */
const CASE_ENUM_MEMBER_RE = /case\s+\w+\.(\w+)\s*:/g;

// ---------------------------------------------------------------------------
// Line-by-line helpers
// ---------------------------------------------------------------------------

/**
 * Split source text into lines, returning each line's text and 1-based line number.
 */
function getLines(source: string): Array<{ text: string; num: number }> {
  return source.split('\n').map((text, idx) => ({ text, num: idx + 1 }));
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all discriminator type definitions from TypeScript source text.
 */
export function extractDiscriminatorTypes(source: string, filePath: string): DiscriminatorType[] {
  const types: DiscriminatorType[] = [];

  // ---- string literal unions (type X = "a" | "b") ----
  for (const match of source.matchAll(STRING_LITERAL_UNION_RE)) {
    const typeName = match[1];
    const unionBody = match[2];

    // Extract individual string literals from the union body
    const values: string[] = [];
    for (const litMatch of unionBody.matchAll(STRING_LITERAL_RE)) {
      values.push(litMatch[1]);
    }

    if (values.length > 0) {
      // Calculate line number from the match position
      const beforeMatch = source.substring(0, match.index);
      const lineNum = beforeMatch.split('\n').length;

      types.push({
        name: typeName,
        values,
        kind: 'string-literal-union' as DiscriminatorKind,
        file: filePath,
        line: lineNum,
      });
    }
  }

  // ---- enums ----
  for (const match of source.matchAll(ENUM_RE)) {
    const typeName = match[1];
    const memberBlock = match[2];

    const values: string[] = [];

    for (const memMatch of memberBlock.matchAll(ENUM_MEMBER_RE)) {
      const stringVal = memMatch[2] ?? memMatch[3];
      const numVal = memMatch[4];

      if (stringVal !== undefined) {
        values.push(stringVal);
      } else if (numVal !== undefined) {
        values.push(numVal);
      } else {
        // Bare member: use the member name as the value
        values.push(memMatch[1]);
      }
    }

    if (values.length > 0) {
      const beforeMatch = source.substring(0, match.index);
      const lineNum = beforeMatch.split('\n').length;

      types.push({
        name: typeName,
        values,
        kind: 'enum' as DiscriminatorKind,
        file: filePath,
        line: lineNum,
      });
    }
  }

  return types;
}

// ---------------------------------------------------------------------------
// Comparison scanning
// ---------------------------------------------------------------------------

/**
 * Scan a file's source for literal comparisons (=== "v", "v" ===, case "v":,
 * case X.V:). Returns locations with file path and line numbers.
 */
export function scanFileForComparisons(source: string, filePath: string): SourceLocation[] {
  const locations: SourceLocation[] = [];
  const lines = getLines(source);

  for (const { text, num } of lines) {
    // Check for === "v" or "v" === (excluding case: which is handled separately)
    // We use a simpler pattern for line-level matching
    const eqMatch = text.match(/(?:===?\s*"([^"]+)")|(?:"([^"]+)"\s*===?)/g);
    if (eqMatch) {
      for (const m of eqMatch) {
        // Extract the literal value
        const valMatch = m.match(/"([^"]+)"/);
        if (valMatch) {
          locations.push({ file: filePath, line: num });
        }
      }
    }

    // Check for case "v":
    if (CASE_LITERAL_RE.test(text)) {
      // Reset lastIndex since we're reusing the regex
      CASE_LITERAL_RE.lastIndex = 0;
      for (const _cm of text.matchAll(CASE_LITERAL_RE)) {
        locations.push({ file: filePath, line: num });
      }
    }

    // Check for case X.V:
    if (CASE_ENUM_MEMBER_RE.test(text)) {
      CASE_ENUM_MEMBER_RE.lastIndex = 0;
      for (const _cm of text.matchAll(CASE_ENUM_MEMBER_RE)) {
        locations.push({ file: filePath, line: num });
      }
    }
  }

  return locations;
}

// ---------------------------------------------------------------------------
// Dispersion detection
// ---------------------------------------------------------------------------

export interface DetectDispersionOptions {
  /**
   * Minimum number of files a value must appear in to be flagged.
   * Default 2 (flags anything spanning 2+ files).
   */
  threshold?: number;
  /**
   * Source root directory (e.g. "src"). When provided, applies cross-module
   * scope filtering: smells whose files are all within a single top-level
   * module directory are dropped.
   */
  srcRoot?: string;
}

/**
 * Given discriminator types and a file-to-source map, detect which literal
 * values are compared across multiple files.
 *
 * Each smell is reported independently per value. Empty when all values
 * appear in at most 1 file.
 *
 * When `options.srcRoot` is provided, only smells whose files span at least
 * two distinct module directories under that root are returned.
 */
export function detectDispersion(
  types: DiscriminatorType[],
  fileContents: Map<string, string>,
  options: DetectDispersionOptions = {}
): LiteralDispersionSmell[] {
  const threshold = options.threshold ?? 2;
  const smells: LiteralDispersionSmell[] = [];

  for (const typeDef of types) {
    // Group by value: for each value, collect all file/line locations
    // from the type definition itself and from comparison scans
    const valueLocations = new Map<string, SourceLocation[]>();

    // Include the type definition location
    for (const val of typeDef.values) {
      if (!valueLocations.has(val)) {
        valueLocations.set(val, []);
      }
      valueLocations.get(val).push({ file: typeDef.file, line: typeDef.line });
    }

    // Scan comparison usage in each file
    for (const [file, source] of fileContents) {
      const compLocations = scanFileForComparisons(source, file);

      // Check which comparisons match our discriminator values
      const lines = getLines(source);
      for (const compLoc of compLocations) {
        const lineText = lines[compLoc.line - 1]?.text ?? '';

        // Extract the literal value being compared on this line
        const matchedValue = extractComparedValue(lineText, typeDef);
        if (matchedValue !== null && typeDef.values.includes(matchedValue)) {
          if (!valueLocations.has(matchedValue)) {
            valueLocations.set(matchedValue, []);
          }
          valueLocations.get(matchedValue).push(compLoc);
        }
      }
    }

    // Emit smells for values that cross the threshold
    for (const [val, locs] of valueLocations) {
      const uniqueFiles = [...new Set(locs.map((l) => l.file))];
      const dispersion = uniqueFiles.length;

      if (dispersion >= threshold) {
        smells.push({
          typeName: typeDef.name,
          value: val,
          files: uniqueFiles.sort(),
          dispersion,
          severity: dispersion >= 3 ? 'warning' : 'info',
          locations: locs,
        });
      }
    }
  }

  // Apply cross-module scope filter when srcRoot is provided
  if (options.srcRoot) {
    return filterCrossModule(smells, options.srcRoot);
  }

  return smells;
}

/**
 * Extract the literal value being compared on a line, considering the
 * discriminator type's enum member names if applicable.
 */
function extractComparedValue(line: string, typeDef: DiscriminatorType): string | null {
  // === "v" or "v" ===
  const eqDirect = line.match(/(?:===?\s*"([^"]+)")|(?:"([^"]+)"\s*===?)/);
  if (eqDirect) {
    const val = eqDirect[1] ?? eqDirect[2];
    return val;
  }

  // case "v":
  const caseLit = line.match(/case\s+"([^"]+)":/);
  if (caseLit) {
    return caseLit[1];
  }

  // case X.V: — check if it references our enum type
  if (typeDef.kind === 'enum') {
    const caseEnum = line.match(/case\s+\w+\.(\w+)\s*:/);
    if (caseEnum) {
      const memberName = caseEnum[1];
      // For bare enum members (e.g. `enum AppKind { Web }`), the "value" is "Web"
      if (typeDef.values.includes(memberName)) {
        return memberName;
      }
    }
  }

  return null;
}
