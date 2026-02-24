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

export interface ModuleInfo {
  moduleName: string;
  moduleRoot: string;
  goModPath: string;
}
