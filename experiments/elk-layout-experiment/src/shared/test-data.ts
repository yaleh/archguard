import fs from 'fs-extra';
import * as path from 'path';

export interface TestCase {
  name: string;
  mermaidPath: string;
  complexity: 'simple' | 'medium' | 'complex' | 'very-complex';
  description: string;
}

/**
 * Get test cases from archguard-self-analysis directory
 */
export async function getTestCases(): Promise<TestCase[]> {
  const basePath = path.join(process.cwd(), '..');
  const archguardDir = path.join(basePath, 'archguard-self-analysis');

  // Check if directory exists
  const exists = await fs.pathExists(archguardDir);
  if (!exists) {
    console.warn(`Warning: ${archguardDir} not found. Using fallback test data.`);
    return getFallbackTestCases();
  }

  const mmdFiles = await fs.readdir(archguardDir);
  const mermaidFiles = mmdFiles.filter(f => f.endsWith('.mmd'));

  return mermaidFiles.map(file => {
    const name = file.replace('.mmd', '');
    const filePath = path.join(archguardDir, file);

    // Classify complexity based on file name and size
    let complexity: TestCase['complexity'] = 'medium';
    let description = '';

    if (name.includes('utils')) {
      complexity = 'simple';
      description = 'Simple baseline (1 class)';
    } else if (name.includes('parser')) {
      complexity = 'medium';
      description = 'Medium complexity (10+ classes)';
    } else if (name.includes('cli')) {
      complexity = 'complex';
      description = 'Complex (20+ classes, known aspect ratio issue)';
    } else if (name.includes('mermaid')) {
      complexity = 'very-complex';
      description = 'Very complex (30+ classes, stress test)';
    } else {
      description = 'Unknown complexity';
    }

    return {
      name,
      mermaidPath: filePath,
      complexity,
      description
    };
  });
}

/**
 * Fallback test cases when archguard-self-analysis is not available
 */
function getFallbackTestCases(): TestCase[] {
  return [
    {
      name: 'simple-test',
      mermaidPath: '/dev/null',  // Will be generated
      complexity: 'simple',
      description: 'Simple baseline (generated)'
    },
    {
      name: 'medium-test',
      mermaidPath: '/dev/null',
      complexity: 'medium',
      description: 'Medium complexity (generated)'
    }
  ];
}

/**
 * Generate simple test Mermaid diagram
 */
export function generateSimpleMermaid(): string {
  return `classDiagram
  class Utils {
    +stringify(obj: any): string
    +parse(text: string): any
  }
  note for Utils "Simple utility class"
`;
}

/**
 * Generate medium test Mermaid diagram
 */
export function generateMediumMermaid(): string {
  return `classDiagram
  class Parser {
    +parse(code: string): AST
    -tokenize(input: string): Token[]
    #validate(ast: AST): boolean
  }
  class AST {
    +nodes: Node[]
    +edges: Edge[]
  }
  class Token {
    +type: string
    +value: string
  }
  class Node {
    +id: string
    +type: string
  }
  class Edge {
    +from: string
    +to: string
    +type: string
  }

  Parser --> AST
  Parser --> Token
  AST --> Node
  AST --> Edge
  Token --> Node
`;
}

/**
 * Read Mermaid file content
 */
export async function readMermaidFile(filePath: string): Promise<string> {
  if (filePath === '/dev/null') {
    // Generate based on test name
    if (filePath.includes('simple')) {
      return generateSimpleMermaid();
    } else {
      return generateMediumMermaid();
    }
  }

  return await fs.readFile(filePath, 'utf-8');
}
