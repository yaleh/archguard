import fs from 'fs-extra';
import path from 'path';
import type { DiagramConfig } from '../../types/config.js';

export const CPP_EXTENSIONS = ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h', '.h++'];

const CPP_EXCLUDED_DIRS = new Set([
  'build', '.cmake',
  'vendor', 'third_party', 'thirdparty', 'external',
  'node_modules', '.git', 'dist',
  '.cache', '.tmp', 'tmp',
  'docs', 'doc', 'media', 'licenses',
  'scripts', 'ci',
]);

function isExcluded(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (name.startsWith('cmake-build-')) return true;
  return CPP_EXCLUDED_DIRS.has(name);
}

export async function directoryHasCppFiles(dir: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && CPP_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      return true;
    }
    if (entry.isDirectory() && !isExcluded(entry.name)) {
      if (await directoryHasCppFiles(path.join(dir, entry.name))) return true;
    }
  }
  return false;
}

export async function getCppTopLevelModules(sourceRoot: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const modules: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isExcluded(entry.name)) continue;
    if (await directoryHasCppFiles(path.join(sourceRoot, entry.name))) {
      modules.push(entry.name);
    }
  }
  return modules.sort();
}

export async function detectCppProjectStructure(
  sourceRoot: string,
  moduleName: string,
  options?: { format?: string; exclude?: string[] },
): Promise<DiagramConfig[]> {
  const common: Partial<DiagramConfig> = {
    language: 'cpp',
    ...(options?.format  !== undefined && { format:  options.format  as DiagramConfig['format'] }),
    ...(options?.exclude !== undefined && { exclude: options.exclude }),
  };

  const root: DiagramConfig[] = [
    { ...common, name: `${moduleName}/package`, sources: [sourceRoot], level: 'package' } as DiagramConfig,
    { ...common, name: `${moduleName}/class`,   sources: [sourceRoot], level: 'class'   } as DiagramConfig,
  ];

  const modules = await getCppTopLevelModules(sourceRoot);

  const perModule: DiagramConfig[] = modules.map((mod) => ({
    ...common,
    name: `${moduleName}/class/${mod}`,
    sources: [path.join(sourceRoot, mod)],
    level: 'class',
  } as DiagramConfig));

  return [...root, ...perModule];
}
