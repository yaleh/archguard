import type { Entity, EntityType, Member, Relation } from '../types/index.js';
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
  type ClassDefinitionStyle,
  type MemberLineStyle,
  type MemberVisibilityOptions,
  type RelationSyntax,
} from '../diagram/generator-formatting.js';

export const ENTITY_CLASSDEF_STYLES: Record<string, string> = {
  classNode: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  interface: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  enum: 'fill:#fff8c5,stroke:#d4a72c,color:#633c01',
  struct: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  trait: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  abstract_class: 'fill:#fdf4ff,stroke:#d2a8ff,color:#8250df',
  function: 'fill:#f6f8fa,stroke:#d0d7de,color:#57606a',
};

export function entityTypeToClassDef(type: EntityType): string {
  return type === 'class' ? 'classNode' : type;
}

// ---------------------------------------------------------------------------
// Format-neutral helpers — one shared definition in src/diagram/.
// ---------------------------------------------------------------------------

export const normalizeEntityName = normalizeEntityNameCore;
export const isNoisyTarget = isNoisyTargetCore;
export const shouldIncludeMember = shouldIncludeMemberCore;
export const getVisibilitySymbol = getVisibilitySymbolCore;

// ---------------------------------------------------------------------------
// Mermaid-specific policy.
// ---------------------------------------------------------------------------

export function normalizeTypeName(type: string): string {
  type = type.replace(/import\([^)]+\)\.\s*([\w.]+)/g, '$1');
  type = type.replace(/import___[^_]+___([\w]+)/g, '$1');
  return type;
}

/**
 * Mermaid aliases strip trailing generic parameters (`Foo<Bar>` → `Foo`) and
 * otherwise keep digits in the leading position.
 */
export const escapeId = (id: string): string => escapeIdCore(id, { stripTrailingGenerics: true });

export const sanitizeType = createTypeSanitizer({
  normalize: normalizeTypeName,
  collapseFunctionTypes: true,
});

const MERMAID_MEMBER_LINE_STYLE: MemberLineStyle = {
  staticModifier: (member: Member): string => (member.isStatic ? 'static ' : ''),
  abstractModifier: (member: Member): string => (member.isAbstract ? 'abstract ' : ''),
  fieldTypes: new Set<Member['type']>(['property']),
  sanitize: sanitizeType,
};

const MERMAID_RELATION_SYNTAX: RelationSyntax = {
  targetFirst: new Set<Relation['type']>(['inheritance', 'implementation']),
  arrows: {
    inheritance: '<|--',
    implementation: '<|..',
    composition: '*--',
    aggregation: 'o--',
    association: '-->',
    dependency: '-->',
  },
};

const MERMAID_CLASS_DEFINITION_STYLE: ClassDefinitionStyle<MemberVisibilityOptions> = {
  header: (entity: Entity, indent: number): string[] => {
    const padding = '  '.repeat(indent);
    const className = escapeId(normalizeEntityName(entity.name));
    return [`${padding}class ${className} {`];
  },
  memberLine: (member: Member): string => generateMemberLineCore(member, MERMAID_MEMBER_LINE_STYLE),
};

// ---------------------------------------------------------------------------
// Public emitter surface (kept signature-compatible with the former module).
// ---------------------------------------------------------------------------

export function generateMemberLine(member: Member): string {
  return generateMemberLineCore(member, MERMAID_MEMBER_LINE_STYLE);
}

export function generateRelationLine(
  relation: Relation,
  entityIdToName: Map<string, string>
): string | null {
  const resolve = (id: string): string =>
    escapeId(normalizeEntityName(entityIdToName.get(id) ?? id));
  return generateRelationLineCore(relation, resolve, MERMAID_RELATION_SYNTAX);
}

export function generateClassDefinition(
  entity: Entity,
  indent: number,
  options: MemberVisibilityOptions
): string[] {
  return generateClassDefinitionCore(entity, indent, options, MERMAID_CLASS_DEFINITION_STYLE);
}
