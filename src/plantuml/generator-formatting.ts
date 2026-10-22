/**
 * Deterministic PlantUML emission helpers.
 *
 * Format-neutral formatting (id normalization, type sanitization, member
 * filtering, member/relation/class line emission) lives in
 * `src/diagram/generator-formatting.ts`. This module only supplies the
 * PlantUML-specific policy: `{static}` / `{abstract}` tokens, alias quoting,
 * and the PlantUML arrow glyphs. Nothing here calls an LLM or depends on
 * rendering — the same ArchJSON always produces the same bytes.
 */

import type { Entity, Member, Relation } from '../types/index.js';
import {
  createTypeSanitizer,
  escapeId as escapeIdCore,
  generateClassDefinition as generateClassDefinitionCore,
  generateMemberLine as generateMemberLineCore,
  generateRelationLine as generateRelationLineCore,
  isNoisyTarget as isNoisyTargetCore,
  normalizeEntityName as normalizeEntityNameCore,
  shouldIncludeMember as shouldIncludeMemberCore,
  getVisibilitySymbol as getVisibilitySymbolCore,
  type ClassDefinitionOptions,
  type ClassDefinitionStyle,
  type MemberLineStyle,
  type RelationSyntax,
} from '../diagram/generator-formatting.js';

/**
 * Strip a trailing generic argument list, e.g. `Repository<T>` → `Repository`.
 *
 * PlantUML class diagrams cannot express `Map<K,V>` in a declaration or at a
 * relationship endpoint, so generic parameters are removed deterministically.
 */
export function stripGenericParameters(name: string): string {
  return name.replace(/<[^>]*>/g, '').trim();
}

// ---------------------------------------------------------------------------
// Format-neutral helpers — one shared definition in src/diagram/.
// ---------------------------------------------------------------------------

export const normalizeEntityName = normalizeEntityNameCore;
export const isNoisyTarget = isNoisyTargetCore;
export const shouldIncludeMember = shouldIncludeMemberCore;
export const getVisibilitySymbol = getVisibilitySymbolCore;

/**
 * Display name used in the PlantUML declaration (generics stripped).
 */
export function entityDisplayName(name: string): string {
  return stripGenericParameters(normalizeEntityName(name));
}

/**
 * Convert a display name into a PlantUML-safe identifier (alias).
 */
export const escapeId = (id: string): string => escapeIdCore(id, { prefixLeadingDigit: true });

export const sanitizeType = createTypeSanitizer({});

const PLANTUML_MEMBER_LINE_STYLE: MemberLineStyle = {
  staticModifier: (member: Member): string => (member.isStatic ? '{static} ' : ''),
  abstractModifier: (member: Member): string => (member.isAbstract ? '{abstract} ' : ''),
  fieldTypes: new Set<Member['type']>(['property', 'field']),
  sanitize: sanitizeType,
};

const PLANTUML_RELATION_SYNTAX: RelationSyntax = {
  arrows: {
    inheritance: '--|>',
    implementation: '..|>',
    composition: '*--',
    aggregation: 'o--',
    association: '-->',
    dependency: '..>',
  },
};

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

export interface PlantUmlEntityOptions extends ClassDefinitionOptions {
  /** Entity id → collision-free alias, precomputed by the generator. */
  aliases?: ReadonlyMap<string, string>;
}

function entityKeyword(entity: Entity): string {
  if (entity.type === 'interface') return 'interface';
  if (entity.type === 'enum') return 'enum';
  if (entity.type === 'abstract_class' || entity.isAbstract) return 'abstract class';
  return 'class';
}

const PLANTUML_CLASS_DEFINITION_STYLE: ClassDefinitionStyle<PlantUmlEntityOptions> = {
  header: (entity: Entity, indent: number, options: PlantUmlEntityOptions): string[] | null => {
    const displayName = entityDisplayName(entity.name);
    if (!displayName) return null;

    const keyword = entityKeyword(entity);
    const alias = options.aliases?.get(entity.id) ?? escapeId(displayName);
    const padding = '  '.repeat(indent);

    return [
      needsAlias(displayName)
        ? `${padding}${keyword} "${quoteDisplayName(displayName)}" as ${alias} {`
        : `${padding}${keyword} ${alias} {`,
    ];
  },
  memberLine: (member: Member): string =>
    generateMemberLineCore(member, PLANTUML_MEMBER_LINE_STYLE),
};

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

// ---------------------------------------------------------------------------
// Public emitter surface (kept signature-compatible with the former module).
// ---------------------------------------------------------------------------

/**
 * Emit a single class-body member line. PlantUML's `{static}` / `{abstract}`
 * tokens are used for the modifiers PlantUML understands.
 */
export function generateMemberLine(member: Member): string {
  return generateMemberLineCore(member, PLANTUML_MEMBER_LINE_STYLE);
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
  return generateClassDefinitionCore(entity, indent, options, PLANTUML_CLASS_DEFINITION_STYLE);
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
  return generateRelationLineCore(
    relation,
    (endpoint) => endpointAliases.get(endpoint),
    PLANTUML_RELATION_SYNTAX
  );
}
