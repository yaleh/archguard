import path from 'path';
import fs from 'fs-extra';
import type { IDependencyExtractor, Dependency } from '@/core/interfaces/dependency.js';

export class DependencyExtractor implements IDependencyExtractor {
  async extractDependencies(workspaceRoot: string): Promise<Dependency[]> {
    const deps: Dependency[] = [];
    try {
      const cmakePath = path.join(workspaceRoot, 'CMakeLists.txt');
      if (await fs.pathExists(cmakePath)) {
        const content = await fs.readFile(cmakePath, 'utf-8');
        const matches = content.matchAll(/find_package\s*\(\s*(\w+)/g);
        for (const m of matches) {
          deps.push({
            name: m[1],
            version: '*',
            type: 'cmake',
            scope: 'runtime',
            source: cmakePath,
            isDirect: true,
          });
        }
      }
    } catch {
      // Return empty on any error
    }
    return deps;
  }
}
