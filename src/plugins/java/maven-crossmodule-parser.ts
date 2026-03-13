import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

export interface ModuleDependency {
  from: string;
  to: string;
}

export class MavenCrossModuleParser {
  async parse(workspaceRoot: string): Promise<ModuleDependency[]> {
    const pomPaths = await glob('*/pom.xml', { cwd: workspaceRoot, absolute: true });

    // Build registry of known sub-module directory names
    const knownModules = new Set(
      pomPaths.map((p) => path.relative(workspaceRoot, path.dirname(p)))
    );

    const results: ModuleDependency[] = [];
    const seen = new Set<string>();

    for (const pomPath of pomPaths) {
      const fromModule = path.relative(workspaceRoot, path.dirname(pomPath));
      const deps = await this.parsePomDependencies(pomPath);

      for (const dep of deps) {
        if (dep.scope === 'test') continue;
        if (!knownModules.has(dep.artifactId)) continue;
        if (dep.artifactId === fromModule) continue;
        const key = `${fromModule}:${dep.artifactId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ from: fromModule, to: dep.artifactId });
      }
    }

    return results;
  }

  private async parsePomDependencies(
    pomPath: string
  ): Promise<Array<{ artifactId: string; scope: string }>> {
    try {
      let content = await fs.readFile(pomPath, 'utf-8');
      // Strip <dependencyManagement> sections to avoid false positives
      content = content.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '');

      const results: Array<{ artifactId: string; scope: string }> = [];
      const depBlockRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
      let match: RegExpExecArray | null;

      while ((match = depBlockRegex.exec(content)) !== null) {
        const block = match[1];
        const artifactMatch = /<artifactId>(.*?)<\/artifactId>/.exec(block);
        if (!artifactMatch) continue;
        const scopeMatch = /<scope>(.*?)<\/scope>/.exec(block);
        results.push({
          artifactId: artifactMatch[1].trim(),
          scope: scopeMatch ? scopeMatch[1].trim() : 'compile',
        });
      }

      return results;
    } catch {
      return [];
    }
  }
}
