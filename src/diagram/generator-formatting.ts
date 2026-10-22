/**
 * Format-neutral emission helpers shared by the Mermaid and PlantUML emitters.
 *
 * Everything here is deterministic string formatting on ArchJSON values: id
 * normalization, type sanitization, member filtering and line emission. The
 * differences between the two diagram formats (modifier tokens, arrow glyphs
 * and directions, alias rules) are injected by each emitter through the style
 * objects exported below, so a format-neutral decision is made exactly once.
 */

import type { Entity, Member, Relation, RelationType } from '../types/index.js';

/**
 * Normalize ids produced by import/default-export extraction into a stable
 * display name.
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
 * Whether a relation target is syntactic noise rather than an entity name.
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

export interface MemberVisibilityOptions {
  includePrivate: boolean;
  includeProtected: boolean;
}

export function shouldIncludeMember(member: Member, options: MemberVisibilityOptions): boolean {
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

export interface EscapeIdOptions {
  /** Strip one trailing generic argument list before sanitizing (Mermaid aliases). */
  stripTrailingGenerics?: boolean;
  /** Prefix a leading digit with `_` (PlantUML identifiers cannot start with one). */
  prefixLeadingDigit?: boolean;
}

/**
 * Convert a display name into a format-safe identifier.
 */
export function escapeId(id: string, options: EscapeIdOptions = {}): string {
  if (!id) return 'Unknown';
  const unsuffixed = options.stripTrailingGenerics ? id.replace(/<[^>]*>$/g, '') : id;
  let sanitized = unsuffixed.replace(/[^a-zA-Z0-9_]/g, '_');
  if (options.prefixLeadingDigit) {
    sanitized = sanitized.replace(/^(\d)/, '_$1');
  }
  return sanitized || 'Unknown';
}

export type TypeNormalizer = (type: string) => string;

export interface SanitizeTypeOptions {
  /** Normalizes import-qualified names before simplification. */
  normalize?: TypeNormalizer;
  /**
   * Collapse arrow-function types to `Function` / `Array`. Mermaid class
   * members need this; PlantUML's normalizer already maps arrows to `[Type]`.
   */
  collapseFunctionTypes?: boolean;
}

/**
 * Sanitize a type expression into a diagram-expressible form: unions become
 * `any`, object literals become `object`, and generic applications collapse to
 * their base name (`Map<K,V>` → `Map`).
 */
export function sanitizeType(type: string, options: SanitizeTypeOptions = {}): string {
  if (!type) return 'any';
  const normalize = options.normalize ?? normalizeEntityName;
  let simplified = normalize(type);
  let prevLength: number;
  do {
    prevLength = simplified.length;
    simplified = simplified.replace(/\{[^{}]*\}/g, 'object');
  } while (simplified.length !== prevLength && simplified.includes('{'));

  const advancedTypePattern =
    /^(Partial|Required|Readonly|Pick|Omit|Record|Exclude|Extract|ReturnType|Parameters|DeepPartial)<.+>$/;
  if (advancedTypePattern.test(simplified)) return 'any';

  // Function types are display-only in a class diagram. Rather than trying to
  // surgically strip the return type (which produced unparseable member lines
  // such as `Functionvoid)[]` and curried leftovers like
  // `Function string, descendant: string) => boolean` — both of which crash
  // Mermaid's ClassMember parser instead of failing as a syntax error), collapse
  // any arrow type to a single safe token.
  if (options.collapseFunctionTypes && simplified.includes('=>')) {
    const compact = simplified.replace(/\s+/g, '');
    if (/\[\]$/.test(compact) || /^(Readonly)?Array</.test(compact)) {
      return 'Array';
    }
    return 'Function';
  }
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

/**
 * Bind a type sanitizer to one format's normalization policy.
 */
export function createTypeSanitizer(options: SanitizeTypeOptions): (type: string) => string {
  return (type: string) => sanitizeType(type, options);
}

export interface MemberLineStyle {
  /** Prefix emitted for static members, e.g. `{static} ` or `static `. */
  staticModifier: (member: Member) => string;
  /** Prefix emitted for abstract members, e.g. `{abstract} ` or `abstract `. */
  abstractModifier: (member: Member) => string;
  /** Member types rendered with the field/property shape. */
  fieldTypes: ReadonlySet<Member['type']>;
  /** Format-specific type sanitizer. */
  sanitize: (type: string) => string;
}

/**
 * Emit a single class-body member line (without indentation).
 */
export function generateMemberLine(member: Member, style: MemberLineStyle): string {
  const visibility = getVisibilitySymbol(member.visibility);
  const staticModifier = style.staticModifier(member);
  const abstractModifier = style.abstractModifier(member);

  if (style.fieldTypes.has(member.type)) {
    const readonly = member.isReadonly ? 'readonly ' : '';
    const optional = member.isOptional ? '?' : '';
    const type = member.fieldType ? `: ${style.sanitize(member.fieldType)}` : '';
    return `${visibility}${staticModifier}${abstractModifier}${readonly}${member.name}${optional}${type}`;
  }

  if (member.type === 'method' || member.type === 'constructor') {
    const asyncModifier = member.isAsync ? 'async ' : '';
    const returnType = member.returnType ? `: ${style.sanitize(member.returnType)}` : '';
    const params =
      member.parameters
        ?.map((parameter) => {
          const optional = parameter.isOptional ? '?' : '';
          const paramType = parameter.type ? `: ${style.sanitize(parameter.type)}` : '';
          return `${parameter.name}${optional}${paramType}`;
        })
        .join(', ') || '';

    return `${visibility}${staticModifier}${abstractModifier}${asyncModifier}${member.name}(${params})${returnType}`;
  }

  return `${visibility}${member.name}`;
}

export type EndpointResolver = (endpoint: string) => string | undefined;

export interface RelationSyntax {
  /** Relation types whose arrow is drawn from target to source. */
  targetFirst?: ReadonlySet<RelationType>;
  /** Arrow glyph per relation type; `dependency` is the fallback. */
  arrows: Partial<Record<RelationType, string>>;
}

/**
 * Emit a relationship line. Returns `null` for call edges and for relations
 * whose endpoints cannot be resolved to an emitted identifier.
 */
export function generateRelationLine(
  relation: Relation,
  resolveEndpoint: EndpointResolver,
  syntax: RelationSyntax
): string | null {
  if (relation.type === 'call') return null;
  const source = resolveEndpoint(relation.source);
  const target = resolveEndpoint(relation.target);
  if (source === undefined || target === undefined) return null;

  const arrow = syntax.arrows[relation.type] ?? syntax.arrows.dependency;
  if (!arrow) return null;

  return syntax.targetFirst?.has(relation.type)
    ? `${target} ${arrow} ${source}`
    : `${source} ${arrow} ${target}`;
}

export interface ClassDefinitionOptions extends MemberVisibilityOptions {
  /** Emit members (class/method level) or only the entity shell (package level). */
  withMembers?: boolean;
}

export interface ClassDefinitionStyle<O extends ClassDefinitionOptions> {
  /** Header line(s) for the entity, or `null` to emit nothing at all. */
  header: (entity: Entity, indent: number, options: O) => string[] | null;
  /** Emits one member line (without indentation). */
  memberLine: (member: Member) => string;
}

/**
 * Emit a complete entity declaration block (header + members + closing brace).
 *
 * @param entity  - Entity to emit.
 * @param indent  - Indentation depth (2 spaces per level).
 * @param options - Member visibility and member emission.
 * @param style   - Format-specific header and member-line emitters.
 */
export function generateClassDefinition<O extends ClassDefinitionOptions>(
  entity: Entity,
  indent: number,
  options: O,
  style: ClassDefinitionStyle<O>
): string[] {
  const header = style.header(entity, indent, options);
  if (header === null) return [];

  const padding = '  '.repeat(indent);
  const lines = [...header];

  if (options.withMembers !== false) {
    for (const member of entity.members || []) {
      if (!shouldIncludeMember(member, options)) continue;
      lines.push(`${padding}  ${style.memberLine(member)}`);
    }
  }

  lines.push(`${padding}}`);
  return lines;
}
