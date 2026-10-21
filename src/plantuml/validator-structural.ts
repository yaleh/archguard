/**
 * Structural validator for deterministic PlantUML output.
 *
 * Reuses the semantics of the retired v1 `PlantUMLValidator`:
 * - `@startuml` / `@enduml` must be paired;
 * - generic type syntax (`Map<K,V>`, `Repository<T>`) is not expressible in a
 *   PlantUML class diagram, so declarations and relationship endpoints that
 *   contain it are rejected;
 * - every relationship endpoint must reference an entity declared in the same
 *   diagram (no dangling references).
 */

import type { ArchJSON } from '../types/index.js';

export type PlantUmlStructuralIssueType =
  | 'uml-delimiter'
  | 'generic-declaration'
  | 'generic-endpoint'
  | 'undefined-endpoint';

export interface PlantUmlStructuralIssue {
  type: PlantUmlStructuralIssueType;
  message: string;
  /** 1-based line number in the validated source, when available. */
  line?: number;
  /** Offending entity/endpoint, when available. */
  endpoint?: string;
}

export interface PlantUmlStructuralValidationResult {
  valid: boolean;
  issues: PlantUmlStructuralIssue[];
  /** Undefined relationship endpoints (deduplicated, in source order). */
  undefinedEndpoints: string[];
  /** Declarations rejected because they contain generic type syntax. */
  invalidGenericDeclarations: string[];
}

const DECLARATION_PATTERN = /^(?:abstract\s+)?(class|interface|enum)\s+(.+)$/;

/**
 * Relationship arrows understood by the emitter. Longest forms first so a
 * shorter arrow cannot shadow them.
 */
const ARROW_PATTERN =
  /(<\|--|--\|>|<\|\.\.|\.\.\|>|\.\.\*|\*\.\.|\.\.>|<\.\.|\*--|--\*|o--|--o|<--|-->)/;

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_.]*';

/**
 * True when the text contains PlantUML-inexpressible generic type syntax —
 * either inside a quoted display name or as an inline `Name<...>` application.
 */
export function containsGenericType(text: string): boolean {
  const quotedGeneric = /"[^"]*[<>][^"]*"/.test(text);
  const inlineGeneric = /[A-Za-z_][A-Za-z0-9_]*<[^>]*>/.test(text);
  return quotedGeneric || inlineGeneric;
}

function stripStyleSuffix(token: string): string {
  return token.replace(/:::[A-Za-z0-9_]+$/, '').replace(/#[A-Za-z0-9_]+$/, '');
}

/** Last endpoint token on the left side of an arrow. */
function endpointBefore(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const quoted = /"([^"]+)"$/.exec(trimmed);
  if (quoted?.[1]) return quoted[1];
  const ident = new RegExp(`(${IDENTIFIER})$`).exec(trimmed);
  return ident?.[1] ? stripStyleSuffix(ident[1]) : null;
}

/** First endpoint token on the right side of an arrow. */
function endpointAfter(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const quoted = /^"([^"]+)"/.exec(trimmed);
  if (quoted?.[1]) return quoted[1];
  const ident = new RegExp(`^(${IDENTIFIER})`).exec(trimmed);
  return ident?.[1] ? stripStyleSuffix(ident[1]) : null;
}

interface ParsedDeclaration {
  /** Alias (or plain name) that relationship endpoints must reference. */
  alias: string | null;
  /** Quoted/plain display name, when present. */
  displayName: string | null;
}

function parseDeclaration(namePartRaw: string): ParsedDeclaration {
  let namePart = namePartRaw.trim();
  if (namePart.endsWith('{')) namePart = namePart.slice(0, -1).trim();

  const asMatch = /^(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_.]*))\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    namePart
  );
  if (asMatch) {
    return {
      displayName: asMatch[1] ?? asMatch[2] ?? null,
      alias: asMatch[3] ?? null,
    };
  }

  const plain = /^"?([A-Za-z_][A-Za-z0-9_.]*)"?$/.exec(namePart);
  if (plain?.[1]) {
    return { displayName: plain[1], alias: plain[1] };
  }

  // A bare quoted declaration (`class "Display Name"`) defines that display
  // name; endpoints reference it with the same quotes.
  const quotedPlain = /^"([^"]+)"$/.exec(namePart);
  if (quotedPlain?.[1]) {
    return { displayName: quotedPlain[1], alias: quotedPlain[1] };
  }

  return { displayName: null, alias: null };
}

/**
 * Validate a PlantUML source string.
 *
 * @param puml      - PlantUML source.
 * @param _archJson - Accepted for signature parity with the retired validator;
 *                    endpoint resolution is done against declarations in `puml`
 *                    itself, which is the stronger structural guarantee.
 */
export class PlantUmlStructuralValidator {
  validate(puml: string, _archJson?: ArchJSON): PlantUmlStructuralValidationResult {
    const issues: PlantUmlStructuralIssue[] = [];
    const undefinedEndpoints: string[] = [];
    const invalidGenericDeclarations: string[] = [];
    const lines = puml.split('\n');

    this.validateDelimiters(lines, issues);

    const definedEntities = new Set<string>();
    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index]?.trim() ?? '';
      if (!trimmed || trimmed.startsWith("'")) continue;

      const declaration = DECLARATION_PATTERN.exec(trimmed);
      if (!declaration) continue;

      const namePart = declaration[2] ?? '';
      if (containsGenericType(namePart)) {
        const message = `Invalid entity declaration (generic type syntax): ${trimmed}`;
        issues.push({ type: 'generic-declaration', message, line: index + 1 });
        invalidGenericDeclarations.push(trimmed);
        continue;
      }

      const parsed = parseDeclaration(namePart);
      if (parsed.alias) definedEntities.add(parsed.alias);
      if (parsed.displayName) definedEntities.add(parsed.displayName);
    }

    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index]?.trim() ?? '';
      if (!trimmed || trimmed.startsWith("'")) continue;
      if (DECLARATION_PATTERN.test(trimmed)) continue;

      const arrow = ARROW_PATTERN.exec(trimmed);
      if (!arrow || arrow.index === undefined) continue;

      // Drop a relationship label (`: label`) before endpoint extraction.
      const body = trimmed.split(':')[0] ?? trimmed;

      if (containsGenericType(body)) {
        const message = `Invalid relationship endpoint (generic type syntax): ${trimmed}`;
        issues.push({ type: 'generic-endpoint', message, line: index + 1 });
      }

      const source = endpointBefore(body.slice(0, arrow.index));
      const target = endpointAfter(body.slice(arrow.index + arrow[0].length));

      for (const endpoint of [source, target]) {
        if (!endpoint) continue;
        if (definedEntities.has(endpoint)) continue;
        const message = `Relationship references undefined entity: "${endpoint}" (line: "${trimmed}")`;
        issues.push({ type: 'undefined-endpoint', message, line: index + 1, endpoint });
        if (!undefinedEndpoints.includes(endpoint)) undefinedEndpoints.push(endpoint);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      undefinedEndpoints,
      invalidGenericDeclarations,
    };
  }

  private validateDelimiters(lines: string[], issues: PlantUmlStructuralIssue[]): void {
    const startIndexes: number[] = [];
    const endIndexes: number[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index]?.trim() ?? '';
      if (trimmed.startsWith('@startuml')) startIndexes.push(index);
      if (trimmed === '@enduml') endIndexes.push(index);
    }

    if (startIndexes.length !== 1) {
      issues.push({
        type: 'uml-delimiter',
        message: `Expected exactly one @startuml, found ${startIndexes.length}`,
        line: startIndexes[0] !== undefined ? startIndexes[0] + 1 : undefined,
      });
    }

    if (endIndexes.length !== 1) {
      issues.push({
        type: 'uml-delimiter',
        message: `Expected exactly one @enduml, found ${endIndexes.length}`,
        line: endIndexes[0] !== undefined ? endIndexes[0] + 1 : undefined,
      });
    }

    if (startIndexes.length === 1 && endIndexes.length === 1) {
      const start = startIndexes[0];
      const end = endIndexes[0];
      if (start > end) {
        issues.push({
          type: 'uml-delimiter',
          message: '@enduml appears before @startuml',
          line: end + 1,
        });
      }
    }
  }
}
