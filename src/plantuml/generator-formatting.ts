/**
 * Deterministic PlantUML emission helpers.
 *
 * This module is the format-neutral counterpart of
 * `src/mermaid/generator-formatting.ts`: every emission concern (entity
 * declaration, member line, relation line, package grouping) is translated
 * one-for-one into PlantUML class-diagram syntax. Nothing here calls an LLM or
 * depends on rendering — the same ArchJSON always produces the same bytes.
 */

import type { Entity, Member, Relation } from '../types/index.js';

/**
 * Strip a trailing generic argument list, e.g. `Repository<T>` → `Repository`.
 *
 * PlantUML class diagrams cannot express `Map<K,V>` in a declaration or at a
 * relationship endpoint, so generic parameters are removed deterministically.
 */
export function stripGenericParameters(name: string): string {
  return name.replace(/<[^>]*>/g, '').trim();
}

/**
 * Normalize ids produced by import/default-export extraction into a stable
 * display name. Mirrors `normalizeEntityName` in the Mermaid emission layer.
 */
export function normalizeEntityName(name: string): string {
  if (name.startsWith('import(')) {
    const match = name.match(/^import\([^)]+\)\.\s*([\w.]+)/);
    if (match) {
      return match[1];
    }
  }

  if (name.startsWith('import___')) {
    const parts = name.split('___');
    const lastPart = parts[parts.length - 1];
    if (lastPart) return lastPart;
  }

  const scopedMatch = name.match(/(?:\.ts|\.js)\.([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (scopedMatch) {
    return scopedMatch[1];
  }

  if (name.startsWith('{') || name.includes('=>')) {
    return '[Type]';
  }

  return name;
}

/**
 * Display name used in the PlantUML declaration (generics stripped).
 */
export function entityDisplayName(name: string): string {
  return stripGenericParameters(normalizeEntityName(name));
}

/**
 * Convert a display name into a PlantUML-safe identifier (alias).
 */
export function escapeId(id: string): string {
  if (!id) return 'Unknown';
  const sanitized = id.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return sanitized || 'Unknown';
}

/**
 * Sanitize a type expression into a PlantUML-expressible form. Ported from the
 * Mermaid emission layer so both formats make the same deterministic choices:
 * unions become `any`, object literals become `object`, and generic
 * applications collapse to their base name (`Map<K,V>` → `Map`).
 */
export function sanitizeType(type: string): string {
  if (!type) return 'any';
  let simplified = normalizeEntityName(type);
  let prevLength: number;
  do {
    prevLength = simplified.length;
    simplified = simplified.replace(/\{[^{}]*\}/g, 'object');
  } while (simplified.length !== prevLength && simplified.includes('{'));

  const advancedTypePattern =
    /^(Partial|Required|Readonly|Pick|Omit|Record|Exclude|Extract|ReturnType|Parameters|DeepPartial)<.+>$/;
  if (advancedTypePattern.test(simplified)) return 'any';

  simplified = simplified.replace(/\([^)]*\)\s*=>\s*/g, 'Function');
  while (simplified.includes('Promise<')) {
    simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
    simplified = simplified.replace(/\bPromise\b/g, 'any');
  }
  if (simplified.includes('|')) return 'any';
  if (simplified.includes('&')) return 'object';

  let prevLength2: number;
  do {
    prevLength2 = simplified.length;
    simplified = simplified.replace(/Array<[^>]+>/g, 'Array');
  } while (simplified.length !== prevLength2);
  simplified = simplified.replace(/\w+\[\]/g, 'Array');
  simplified = simplified.replace(/Array+/g, 'Array');

  while (simplified.match(/\w+</)) {
    simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
  }
  simplified = simplified.replace(/\bz\.infer\b/g, 'any');
  simplified = simplified.replace(/\s+/g, ' ').trim();
  if (simplified.length > 50 || simplified === '') return 'any';
  return simplified;
}

export function shouldIncludeMember(
  member: Member,
  options: { includePrivate: boolean; includeProtected: boolean }
): boolean {
  if (member.visibility === 'private' && !options.includePrivate) return false;
  if (member.visibility === 'protected' && !options.includeProtected) return false;
  return true;
}

export function getVisibilitySymbol(visibility: Member['visibility']): string {
  switch (visibility) {
    case 'public':
      return '+';
    case 'private':
      return '-';
    case 'protected':
      return '#';
    default:
      return '+';
  }
}

/**
 * Emit a single class-body member line. PlantUML's `{static}` / `{abstract}`
 * tokens are used for the modifiers PlantUML understands; the remaining text
 * mirrors the Mermaid emitter's member line.
 */
export function generateMemberLine(member: Member): string {
  const visibility = getVisibilitySymbol(member.visibility);
  const staticModifier = member.isStatic ? '{static} ' : '';
  const abstractModifier = member.isAbstract ? '{abstract} ' : '';

  if (member.type === 'property' || member.type === 'field') {
    const readonly = member.isReadonly ? 'readonly ' : '';
    const optional = member.isOptional ? '?' : '';
    const type = member.fieldType ? `: ${sanitizeType(member.fieldType)}` : '';
    return `${visibility}${staticModifier}${abstractModifier}${readonly}${member.name}${optional}${type}`;
  }

  if (member.type === 'method' || member.type === 'constructor') {
    const asyncModifier = member.isAsync ? 'async ' : '';
    const returnType = member.returnType ? `: ${sanitizeType(member.returnType)}` : '';
    const params =
      member.parameters
        ?.map((parameter) => {
          const optional = parameter.isOptional ? '?' : '';
          const paramType = parameter.type ? `: ${sanitizeType(parameter.type)}` : '';
          return `${parameter.name}${optional}${paramType}`;
        })
        .join(', ') || '';

    return `${visibility}${staticModifier}${abstractModifier}${asyncModifier}${member.name}(${params})${returnType}`;
  }

  return `${visibility}${member.name}`;
}

/**
 * PlantUML identifier aliases cannot contain spaces or punctuation. When the
 * display name needs an alias, the declaration becomes
 * `class "Display Name" as Display_Name`.
 */
export function needsAlias(displayName: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(displayName);
}

/**
 * Default alias for an entity name (before collision disambiguation).
 */
export function entityAlias(name: string): string {
  return escapeId(entityDisplayName(name));
}

function quoteDisplayName(displayName: string): string {
  return displayName.replace(/"/g, "'");
}

export interface PlantUmlEntityOptions {
  includePrivate: boolean;
  includeProtected: boolean;
  /** Emit members (class/method level) or only the entity shell (package level). */
  withMembers: boolean;
  /** Entity id → collision-free alias, precomputed by the generator. */
  aliases?: ReadonlyMap<string, string>;
}

function entityKeyword(entity: Entity): string {
  if (entity.type === 'interface') return 'interface';
  if (entity.type === 'enum') return 'enum';
  if (entity.type === 'abstract_class' || entity.isAbstract) return 'abstract class';
  return 'class';
}

/**
 * Emit a complete entity declaration block (header + members + closing brace).
 *
 * @param entity  - Entity to emit.
 * @param indent  - Indentation depth (2 spaces per level).
 * @param options - Member visibility, member emission and alias registry.
 */
export function generateClassDefinition(
  entity: Entity,
  indent: number,
  options: PlantUmlEntityOptions
): string[] {
  const lines: string[] = [];
  const padding = '  '.repeat(indent);
  const keyword = entityKeyword(entity);
  const displayName = entityDisplayName(entity.name);
  const alias = options.aliases?.get(entity.id) ?? escapeId(displayName);

  if (!displayName) return lines;

  lines.push(
    needsAlias(displayName)
      ? `${padding}${keyword} "${quoteDisplayName(displayName)}" as ${alias} {`
      : `${padding}${keyword} ${alias} {`
  );

  if (options.withMembers) {
    for (const member of entity.members || []) {
      if (!shouldIncludeMember(member, options)) continue;
      lines.push(`${padding}  ${generateMemberLine(member)}`);
    }
  }

  lines.push(`${padding}}`);
  return lines;
}

/**
 * Emit a package grouping header. Group names that are not valid PlantUML
 * identifiers are quoted and aliased, exactly like class names.
 */
export function generatePackageHeader(name: string, indent: number): string {
  const padding = '  '.repeat(indent);
  const displayName = name.trim() || 'Default';
  if (!needsAlias(displayName)) {
    return `${padding}package ${displayName} {`;
  }
  return `${padding}package "${quoteDisplayName(displayName)}" as ${escapeId(displayName)} {`;
}

/**
 * Emit a relationship line. Returns `null` for call edges and for relations
 * whose endpoints cannot be resolved to a declared entity — PlantUML would
 * otherwise render a dangling reference (and the structural validator rejects
 * it).
 *
 * @param relation         - Relation to emit.
 * @param endpointAliases  - Map from entity id / entity name → emitted alias.
 */
export function generateRelationLine(
  relation: Relation,
  endpointAliases: ReadonlyMap<string, string>
): string | null {
  if (relation.type === 'call') return null;
  const source = endpointAliases.get(relation.source);
  const target = endpointAliases.get(relation.target);
  if (!source || !target) return null;

  switch (relation.type) {
    case 'inheritance':
      return `${source} --|> ${target}`;
    case 'implementation':
      return `${source} ..|> ${target}`;
    case 'composition':
      return `${source} *-- ${target}`;
    case 'aggregation':
      return `${source} o-- ${target}`;
    case 'association':
      return `${source} --> ${target}`;
    case 'dependency':
    default:
      return `${source} ..> ${target}`;
  }
}

/**
 * Whether a relation target is syntactic noise rather than an entity name.
 * Kept for parity with the Mermaid emission layer.
 */
export function isNoisyTarget(target: string): boolean {
  return (
    target.startsWith('{') ||
    target.startsWith('"') ||
    target.startsWith("'") ||
    target.startsWith('(') ||
    target.includes('=>') ||
    /^\d/.test(target) ||
    /^[A-Z]$/.test(target) ||
    /^[a-z]\w*\./.test(target)
  );
}
