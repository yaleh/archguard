import fs from 'fs-extra';
import path from 'path';

/**
 * Go module resolver for import classification
 *
 * RESPONSIBILITIES:
 * 1. Parse go.mod file
 * 2. Extract module name
 * 3. Classify imports: std | internal | external | vendor
 */
export class GoModResolver {
  private moduleInfo: ModuleInfo | null = null;

  async resolveProject(workspaceRoot: string): Promise<ModuleInfo> {
    const goModPath = path.join(workspaceRoot, 'go.mod');

    if (!(await fs.pathExists(goModPath))) {
      throw new Error(`go.mod not found at ${goModPath}`);
    }

    const content = await fs.readFile(goModPath, 'utf-8');
    const moduleMatch = content.match(/^module\s+([^\s]+)/m);
    if (!moduleMatch) {
      throw new Error('Module declaration not found in go.mod');
    }

    this.moduleInfo = {
      moduleName: moduleMatch[1],
      moduleRoot: workspaceRoot,
      goModPath,
      requires: this.parseRequires(content),
    };

    return this.moduleInfo;
  }

  classifyImport(importPath: string): 'std' | 'internal' | 'external' | 'vendor' {
    if (!this.moduleInfo) {
      throw new Error('GoModResolver not initialized. Call resolveProject() first.');
    }

    if (importPath.startsWith('vendor/')) return 'vendor';
    if (this.isStandardLibrary(importPath)) return 'std';
    if (importPath.startsWith(this.moduleInfo.moduleName)) return 'internal';
    if (importPath.startsWith('./') || importPath.startsWith('../')) return 'internal';
    return 'external';
  }

  private parseRequires(content: string): GoModRequire[] {
    const requires: GoModRequire[] = [];
    const lines = content.split('\n');
    let inRequireBlock = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Enter multi-line require block
      if (/^require\s*\(/.test(line)) {
        inRequireBlock = true;
        // Handle single-line: require ( path version ) — rare but possible
        const singleInBlock = line.match(/^require\s*\(\s*([^\s)]+)\s+([^\s)]+)\s*\)/);
        if (singleInBlock) {
          inRequireBlock = false;
          requires.push({
            path: singleInBlock[1],
            version: singleInBlock[2],
            indirect: false,
          });
        }
        continue;
      }

      // Exit require block
      if (inRequireBlock && line === ')') {
        inRequireBlock = false;
        continue;
      }

      // Parse line inside require block
      if (inRequireBlock && line && !line.startsWith('//')) {
        const indirect = line.includes('// indirect');
        const clean = line.replace(/\/\/.*$/, '').trim();
        const parts = clean.split(/\s+/);
        if (parts.length >= 2) {
          requires.push({ path: parts[0], version: parts[1], indirect });
        }
        continue;
      }

      // Single-line require (outside block): require path version
      const singleMatch = line.match(/^require\s+([^\s(]+)\s+([^\s]+)/);
      if (singleMatch) {
        const indirect = line.includes('// indirect');
        requires.push({ path: singleMatch[1], version: singleMatch[2], indirect });
      }
    }

    return requires;
  }

  getModuleInfo(): ModuleInfo {
    if (!this.moduleInfo) throw new Error('GoModResolver not initialized. Call resolveProject() first.');
    return this.moduleInfo;
  }

  /**
   * Standard library detection
   *
   * Uses heuristic: std lib packages do NOT contain dots in the first segment.
   * e.g., "fmt", "net/http" → std; "github.com/..." → external
   */
  private isStandardLibrary(importPath: string): boolean {
    const firstSegment = importPath.split('/')[0];
    return !firstSegment.includes('.');
  }

  getModuleName(): string {
    return this.moduleInfo?.moduleName ?? '';
  }
}

export interface GoModRequire {
  path: string;      // e.g. "github.com/gin-gonic/gin"
  version: string;   // e.g. "v1.9.1"
  indirect: boolean; // true if line ends with "// indirect"
}

export interface ModuleInfo {
  moduleName: string;
  moduleRoot: string;
  goModPath: string;
  requires: GoModRequire[]; // NEW
}
