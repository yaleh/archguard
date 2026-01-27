import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs';

export interface ArchJSONClass {
  name: string;
  type: 'class';
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
}

/**
 * Parse Mermaid class diagram to extract structure
 */
export function parseMermaidClassDiagram(mermaidCode: string): ArchJSON {
  const entities: ArchJSONClass[] = [];
  const relations: ArchJSONRelation[] = [];

  const lines = mermaidCode.split('\n');
  let currentClass: ArchJSONClass | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Class definition
    const classMatch = trimmed.match(/^class\s+(\w+)\s*\{/);
    if (classMatch) {
      if (currentClass) {
        entities.push(currentClass);
      }
      currentClass = {
        name: classMatch[1],
        type: 'class',
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
    // Format: +visibility name: type
    // Examples: +cacheDir: string, -stats: any, +readonly cacheDir: string
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
    // Format: +visibility name(params): return type
    // Examples: +get(key: string): T, +async computeFileHash(filePath: string): Promise~string~
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

    // Relation - improved regex to handle complex node names
    // Matches: NodeA --> NodeB, NodeA *-- NodeB, NodeA <|-- NodeB
    // Node names can contain: letters, numbers, underscores, colons, brackets, dots, etc.
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

  return { entities, relations };
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

  // Character width multiplier (conservative estimate for monospace-like rendering)
  const charWidth = fontSize * 0.55;

  // 1. Calculate class name width (using larger font for class name)
  const classNameFontSize = 12;
  const classNameWidth = className.length * classNameFontSize * 0.55;

  // 2. Calculate maximum field width
  const maxFieldWidth = fields.reduce((max, field) => {
    const text = `${field.visibility} ${field.name}: ${field.type}`;
    return Math.max(max, text.length * charWidth);
  }, 0);

  // 3. Calculate maximum method width
  const maxMethodWidth = methods.reduce((max, method) => {
    const visibility = method.visibility || '+';
    const name = method.name;
    const params = method.params || '';
    const returnType = method.returnType && method.returnType !== 'void' ? `: ${method.returnType}` : '';

    // Full method signature
    const fullText = `${visibility} ${name}(${params})${returnType}`;

    // Truncate very long signatures for display (but keep full for width calc)
    const displayText = fullText.length > 35 ? fullText.substring(0, 32) + '...' : fullText;
    return Math.max(max, displayText.length * charWidth);
  }, 0);

  // 4. Take the maximum width
  const maxContentWidth = Math.max(classNameWidth, maxFieldWidth, maxMethodWidth);

  // 5. Add padding and constrain to min/max bounds
  const calculatedWidth = maxContentWidth + padding * 2;
  return Math.max(minWidth, Math.min(maxWidth, calculatedWidth));
}

/**
 * Convert ArchJSON to ELK graph
 */
export function archjsonToELK(
  archjson: ArchJSON,
  layoutOptions: Record<string, string> = {}
): ElkNode {
  // Collect all entity names
  const entityNames = new Set(archjson.entities.map(e => e.name));

  // Add placeholder nodes for relation targets that don't exist
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

  const elk: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.aspectRatio': '1.5',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      ...layoutOptions
    },
    children: allNodes.map((entity) => {
      // 计算节点高度
      const nameHeight = 25;
      const lineHeight = 16;
      const fieldCount = entity.fields?.length || 0;
      const methodCount = entity.methods?.length || 0;
      const separatorHeight = (fieldCount > 0 ? 1 : 0) + (methodCount > 0 && fieldCount > 0 ? 1 : 0);
      const padding = 10;
      const contentHeight = nameHeight + fieldCount * lineHeight + methodCount * lineHeight + separatorHeight + padding * 2;
      const nodeHeight = Math.max(100, contentHeight);

      // ✅ 动态计算节点宽度（基于内容）
      const nodeWidth = calculateNodeWidth(
        entity.name,
        entity.fields || [],
        entity.methods || [],
        {
          fontSize: 10,
          padding: 10,
          minWidth: 120,
          maxWidth: 800  // 允许超长类名完整显示
        }
      );

      return {
        id: entity.name,
        labels: [{ text: entity.name }],
        width: nodeWidth,  // ✅ 动态宽度
        height: nodeHeight,
        layoutOptions: {
          'elk.nodeLabels.placement': 'INSIDE V_CENTER H_CENTER'
        },
        // Add method and field information as labels
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
    }),
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
  // More entities = wider layout (up to a point)
  if (entityCount <= 3) return 1.0;
  if (entityCount <= 10) return 1.5;
  if (entityCount <= 20) return 2.0;
  return 1.5; // Don't go too wide
}
