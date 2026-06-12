export type EntityType = 'class' | 'interface' | 'function' | 'enum' | 'type';
export type RelationType =
  | 'call'
  | 'inheritance'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'implementation';

export interface CParam {
  name: string;
  type: string;
}

export interface CMethod {
  name: string;
  params: CParam[]; // null treated as []
  returnType: string; // null treated as "void"
}

export interface CEntity {
  id: string; // normalizeId(fullyQualifiedName)
  name: string;
  type: EntityType;
  sourceFile: string; // null treated as "unknown"
  methods: CMethod[]; // null treated as []
}

export interface CRelation {
  from: string; // entity id
  to: string; // entity id
  type: RelationType;
}

export interface C {
  entities: CEntity[];
  relations: CRelation[];
}

export function normalizeId(s: string): string {
  return s.toLowerCase().trim();
}
