import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs';

// ✅ Extend ElkNode to include custom properties
interface ExtendedElkNode extends ElkNode {
  properties?: {
    [key: string]: string;
  };
  children?: ExtendedElkNode[];
}

export interface ArchJSONClass {
  name: string;
  type: 'class';
  namespace?: string;  // ✅ 添加 namespace 字段
  methods?: Array<{ name: string; visibility: string; params?: string; returnType?: string }>;
  fields?: Array<{ name: string; type: string; visibility: string }>;
}

export interface ArchJSONRelation {
  from: string;
  to: string;
  type: string;
  label?: string;
}

export interface ArchJSON {
  entities: ArchJSONClass[];
  relations: ArchJSONRelation[];
  namespaces: string[];  // ✅ 添加 namespace 列表
}

/**
 * Parse Mermaid class diagram to extract structure with namespace support
 */
export function parseMermaidClassDiagram(mermaidCode: string): ArchJSON {
  const entities: ArchJSONClass[] = [];
  const relations: ArchJSONRelation[] = [];
  const namespaces = new Set<string>();

  const lines = mermaidCode.split('\n');
  let currentClass: ArchJSONClass | null = null;
  let currentNamespace: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // ✅ Namespace declaration
    const namespaceMatch = trimmed.match(/^namespace\s+(\w+)\s*\{/);
    if (namespaceMatch) {
      currentNamespace = namespaceMatch[1];
      namespaces.add(currentNamespace);
      continue;
    }

    // End of namespace
    if (trimmed === '}' && currentNamespace) {
      // Check if it's namespace closing or class closing
      const nextLine = lines[lines.indexOf(line) + 1];
      if (!nextLine || !nextLine.trim().startsWith('class')) {
        currentNamespace = null;
      }
      continue;
    }

    // Class definition
    const classMatch = trimmed.match(/^class\s+(\w+)\s*\{/);
    if (classMatch) {
      if (currentClass) {
        entities.push(currentClass);
      }
      currentClass = {
        name: classMatch[1],
        type: 'class',
        namespace: currentNamespace || undefined,  // ✅ 保存 namespace
        methods: [],
        fields: []
      };
      continue;
    }

    // End of class definition
    if (trimmed === '}' && currentClass) {
      entities.push(currentClass);
      currentClass = null;
      continue;
    }

    // Field/Property definition
    const fieldMatch = trimmed.match(/^\s*([+\-#])\s*(?:(readonly)\s+)?(\w+)\s*:\s*(\S+)/);
    if (fieldMatch && currentClass) {
      currentClass.fields!.push({
        name: fieldMatch[3],
        type: fieldMatch[4],
        visibility: fieldMatch[1]
      });
      continue;
    }

    // Method definition
    const methodMatch = trimmed.match(/^\s*([+\-#])\s*(?:(async)\s+)?(\w+)\s*\(([^)]*)\)(?::\s*([^~\{]+))?/);
    if (methodMatch && currentClass) {
      currentClass.methods!.push({
        name: methodMatch[3],
        visibility: methodMatch[1],
        params: methodMatch[4] || '',
        returnType: methodMatch[5] || 'void'
      });
      continue;
    }

    // Constructor special case
    const constructorMatch = trimmed.match(/^\s*([+\-#])\s*constructor\(([^)]*)\)/);
    if (constructorMatch && currentClass) {
      currentClass.methods!.push({
        name: 'constructor',
        visibility: constructorMatch[1],
        params: constructorMatch[2] || '',
        returnType: ''
      });
      continue;
    }

    // Relation
    const relationMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_:$#\.~\{\}]*)\s+(-->|<\|--|\*\-\-)\s+([A-Za-z_][A-Za-z0-9_:$#\.~\{\}]*)/);
    if (relationMatch) {
      let relationType = 'dependency';
      const arrow = relationMatch[2];

      if (arrow.includes('-->')) relationType = 'dependency';
      else if (arrow.includes('*')) relationType = 'composition';
      else if (arrow.includes('o')) relationType = 'aggregation';
      else if (arrow.includes('<|')) relationType = 'inheritance';

      relations.push({
        from: relationMatch[1],
        to: relationMatch[3],
        type: relationType
      });
    }
  }

  if (currentClass) {
    entities.push(currentClass);
  }

  return { entities, relations, namespaces: Array.from(namespaces) };
}

/**
 * Calculate optimal node width based on content
 */
function calculateNodeWidth(
  className: string,
  fields: Array<{ name: string; type: string; visibility: string }> = [],
  methods: Array<{ name: string; params?: string; returnType?: string; visibility: string }> = [],
  options: { fontSize?: number; padding?: number; minWidth?: number; maxWidth?: number } = {}
): number {
  const {
    fontSize = 10,
    padding = 16,
    minWidth = 120,
    maxWidth = 800
  } = options;

  const charWidth = fontSize * 0.55;
  const classNameFontSize = 12;
  const classNameWidth = className.length * classNameFontSize * 0.55;

  const maxFieldWidth = fields.reduce((max, field) => {
    const text = `${field.visibility} ${field.name}: ${field.type}`;
    return Math.max(max, text.length * charWidth);
  }, 0);

  const maxMethodWidth = methods.reduce((max, method) => {
    const visibility = method.visibility || '+';
    const name = method.name;
    const params = method.params || '';
    const returnType = method.returnType && method.returnType !== 'void' ? `: ${method.returnType}` : '';
    const fullText = `${visibility} ${name}(${params})${returnType}`;
    const displayText = fullText.length > 35 ? fullText.substring(0, 32) + '...' : fullText;
    return Math.max(max, displayText.length * charWidth);
  }, 0);

  const maxContentWidth = Math.max(classNameWidth, maxFieldWidth, maxMethodWidth);
  const calculatedWidth = maxContentWidth + padding * 2;
  return Math.max(minWidth, Math.min(maxWidth, calculatedWidth));
}

/**
 * Convert ArchJSON to ELK graph with namespace support using compound nodes
 */
export function archjsonToELK(
  archjson: ArchJSON,
  layoutOptions: Record<string, string> = {}
): ExtendedElkNode {
  const entityNames = new Set(archjson.entities.map(e => e.name));
  const allNodes: ArchJSONClass[] = [...archjson.entities];
  const addedNodes = new Set<string>();

  for (const rel of archjson.relations) {
    if (!entityNames.has(rel.from) && !addedNodes.has(rel.from)) {
      addedNodes.add(rel.from);
      allNodes.push({
        name: rel.from,
        type: 'class',
        methods: [],
        fields: []
      });
    }
    if (!entityNames.has(rel.to) && !addedNodes.has(rel.to)) {
      addedNodes.add(rel.to);
      allNodes.push({
        name: rel.to,
        type: 'class',
        methods: [],
        fields: []
      });
    }
  }

  // ✅ Group entities by namespace
  const namespaceGroups = new Map<string, ArchJSONClass[]>();
  const ungroupedEntities: ArchJSONClass[] = [];

  for (const entity of allNodes) {
    if (entity.namespace) {
      if (!namespaceGroups.has(entity.namespace)) {
        namespaceGroups.set(entity.namespace, []);
      }
      namespaceGroups.get(entity.namespace)!.push(entity);
    } else {
      ungroupedEntities.push(entity);
    }
  }

  // ✅ Create ELK compound nodes for namespaces
  const namespaceChildren: ExtendedElkNode[] = [];

  for (const [namespaceName, entities] of namespaceGroups) {
    const namespaceNode: ExtendedElkNode = {
      id: `ns-${namespaceName}`,
      labels: [{ text: namespaceName }],
      layoutOptions: {
        'elk.padding': '[top=20,left=20,bottom=20,right=20]',
        'elk.nodeLabels.placement': 'INSIDE V_TOP H_CENTER',
        'elk.aspectRatio': '1.5',
      },
      // ✅ Namespace properties for SVG rendering
      properties: {
        isNamespace: 'true',
        namespaceName: namespaceName
      },
      children: entities.map(entity => {
        const nameHeight = 25;
        const lineHeight = 16;
        const fieldCount = entity.fields?.length || 0;
        const methodCount = entity.methods?.length || 0;
        const separatorHeight = (fieldCount > 0 ? 1 : 0) + (methodCount > 0 && fieldCount > 0 ? 1 : 0);
        const padding = 10;
        const contentHeight = nameHeight + fieldCount * lineHeight + methodCount * lineHeight + separatorHeight + padding * 2;
        const nodeHeight = Math.max(100, contentHeight);

        const nodeWidth = calculateNodeWidth(
          entity.name,
          entity.fields || [],
          entity.methods || [],
          {
            fontSize: 10,
            padding: 10,
            minWidth: 120,
            maxWidth: 800
          }
        );

        return {
          id: entity.name,
          labels: [{ text: entity.name }],
          width: nodeWidth,
          height: nodeHeight,
          layoutOptions: {
            'elk.nodeLabels.placement': 'INSIDE V_CENTER H_CENTER'
          },
          properties: {
            methods: JSON.stringify(entity.methods?.map(m => ({
              visibility: m.visibility,
              name: m.name,
              params: m.params || '',
              returnType: m.returnType || ''
            }))),
            fields: JSON.stringify(entity.fields?.map(f => ({
              visibility: f.visibility,
              name: f.name,
              type: f.type
            })))
          }
        };
      })
    };

    namespaceChildren.push(namespaceNode);
  }

  // ✅ Add ungrouped entities (without namespace) directly to root
  const ungroupedChildren = ungroupedEntities.map(entity => {
    const nameHeight = 25;
    const lineHeight = 16;
    const fieldCount = entity.fields?.length || 0;
    const methodCount = entity.methods?.length || 0;
    const separatorHeight = (fieldCount > 0 ? 1 : 0) + (methodCount > 0 && fieldCount > 0 ? 1 : 0);
    const padding = 10;
    const contentHeight = nameHeight + fieldCount * lineHeight + methodCount * lineHeight + separatorHeight + padding * 2;
    const nodeHeight = Math.max(100, contentHeight);

    const nodeWidth = calculateNodeWidth(
      entity.name,
      entity.fields || [],
      entity.methods || [],
      {
        fontSize: 10,
        padding: 10,
        minWidth: 120,
        maxWidth: 800
      }
    );

    return {
      id: entity.name,
      labels: [{ text: entity.name }],
      width: nodeWidth,
      height: nodeHeight,
      layoutOptions: {
        'elk.nodeLabels.placement': 'INSIDE V_CENTER H_CENTER'
      },
      properties: {
        methods: JSON.stringify(entity.methods?.map(m => ({
          visibility: m.visibility,
          name: m.name,
          params: m.params || '',
          returnType: m.returnType || ''
        }))),
        fields: JSON.stringify(entity.fields?.map(f => ({
          visibility: f.visibility,
          name: f.name,
          type: f.type
        })))
      }
    };
  });

  const elk: ExtendedElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.aspectRatio': '1.5',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      ...layoutOptions
    },
    children: [...namespaceChildren, ...ungroupedChildren],
    edges: archjson.relations.map((rel, idx) => ({
      id: `edge-${idx}`,
      sources: [rel.from],
      targets: [rel.to],
      labels: rel.label ? [{ text: rel.label }] : []
    }))
  };

  return elk;
}

/**
 * Create ELK layout options for different scenarios
 */
export function createLayoutOptions(
  aspectRatio: number,
  direction: 'DOWN' | 'RIGHT' | 'LEFT' | 'UP' = 'DOWN'
): Record<string, string> {
  return {
    'elk.aspectRatio': aspectRatio.toString(),
    'elk.direction': direction,
    'elk.algorithm': 'layered',
    'elk.spacing.nodeNode': '50',
    'elk.layered.spacing.nodeNodeBetweenLayers': '80'
  };
}

/**
 * Calculate optimal aspect ratio based on entity count
 */
export function calculateOptimalAspectRatio(entityCount: number): number {
  if (entityCount <= 3) return 1.0;
  if (entityCount <= 10) return 1.5;
  if (entityCount <= 20) return 2.0;
  return 1.5;
}
