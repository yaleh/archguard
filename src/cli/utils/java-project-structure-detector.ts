import fs from 'fs-extra';
import path from 'path';
import type { DiagramConfig } from '../../types/config.js';

const JAVA_EXTENSIONS = ['.java'];

const EXCLUDED_DIRS = new Set([
  '.git',
  '.idea',
  '.gradle',
  '.settings',
  'node_modules',
  'target',
  'build',
  'dist',
  '.archguard',
]);

function isExcluded(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name);
}

async function directoryHasJavaFiles(dir: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && JAVA_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      return true;
    }
    if (entry.isDirectory() && !isExcluded(entry.name)) {
      if (await directoryHasJavaFiles(path.join(dir, entry.name))) {
        return true;
      }
    }
  }

  return false;
}

async function readMavenModules(projectRoot: string): Promise<string[]> {
  const pomPath = path.join(projectRoot, 'pom.xml');
  let pom: string;
  try {
    pom = await fs.readFile(pomPath, 'utf-8');
  } catch {
    return [];
  }

  const modules: string[] = [];
  const moduleRegex = /<module>\s*([^<\s][^<]*)\s*<\/module>/g;

  for (const match of pom.matchAll(moduleRegex)) {
    const moduleName = match[1]?.trim();
    if (moduleName) {
      modules.push(moduleName);
    }
  }

  return modules;
}

export async function detectJavaProjectStructure(
  projectRoot: string,
  options?: { label?: string; format?: DiagramConfig['format']; exclude?: string[] }
): Promise<DiagramConfig[]> {
  const label = options?.label ?? path.basename(projectRoot);
  const common: Partial<DiagramConfig> = {
    language: 'java',
    ...(options?.format !== undefined && { format: options.format }),
    ...(options?.exclude !== undefined && { exclude: options.exclude }),
  };

  const diagrams: DiagramConfig[] = [
    {
      ...common,
      name: `${label}/overview/package`,
      sources: [projectRoot],
      level: 'package',
    } as DiagramConfig,
    {
      ...common,
      name: `${label}/class/all-classes`,
      sources: [projectRoot],
      level: 'class',
    } as DiagramConfig,
  ];

  const modules = await readMavenModules(projectRoot);
  const validModules: string[] = [];

  for (const moduleName of modules) {
    const moduleRoot = path.join(projectRoot, moduleName);
    if (await directoryHasJavaFiles(moduleRoot)) {
      validModules.push(moduleName);
    }
  }

  validModules.sort();

  return [
    ...diagrams,
    ...validModules.map(
      (moduleName) =>
        ({
          ...common,
          name: `${label}/class/${moduleName}`,
          sources: [path.join(projectRoot, moduleName)],
          level: 'class',
        }) as DiagramConfig
    ),
  ];
}
