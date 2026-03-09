import type { Entity, EntityType, Member, Relation } from '../types/index.js';

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

export function escapeId(id: string): string {
  if (!id) return 'Unknown';
  return id.replace(/<[^>]*>$/g, '').replace(/[^a-zA-Z0-9_]/g, '_');
}

export function normalizeTypeName(type: string): string {
  type = type.replace(/import\([^)]+\)\.\s*([\w.]+)/g, '$1');
  type = type.replace(/import___[^_]+___([\w]+)/g, '$1');
  return type;
}

export function sanitizeType(type: string): string {
  if (!type) return 'any';
  let simplified = normalizeTypeName(type);
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

export function generateMemberLine(member: Member): string {
  const visibility = getVisibilitySymbol(member.visibility);
  const staticModifier = member.isStatic ? 'static ' : '';
  const abstractModifier = member.isAbstract ? 'abstract ' : '';

  if (member.type === 'property') {
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

export function generateRelationLine(
  relation: Relation,
  entityIdToName: Map<string, string>
): string {
  const resolve = (id: string): string => escapeId(normalizeEntityName(entityIdToName.get(id) ?? id));
  const source = resolve(relation.source);
  const target = resolve(relation.target);
  switch (relation.type) {
    case 'inheritance':
      return `${target} <|-- ${source}`;
    case 'implementation':
      return `${target} <|.. ${source}`;
    case 'composition':
      return `${source} *-- ${target}`;
    case 'aggregation':
      return `${source} o-- ${target}`;
    case 'dependency':
    default:
      return `${source} --> ${target}`;
  }
}

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

export function generateClassDefinition(
  entity: Entity,
  indent: number,
  options: { includePrivate: boolean; includeProtected: boolean }
): string[] {
  const lines: string[] = [];
  const padding = '  '.repeat(indent);
  const className = escapeId(normalizeEntityName(entity.name));
  lines.push(`${padding}class ${className} {`);
  for (const member of entity.members || []) {
    if (!shouldIncludeMember(member, options)) continue;
    lines.push(`${padding}  ${generateMemberLine(member)}`);
  }
  lines.push(`${padding}}`);
  return lines;
}
