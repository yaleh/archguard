import fs from 'fs-extra';
import path from 'path';
import type { DiagramConfig } from '../../types/config.js';

const KOTLIN_EXTENSIONS = ['.kt', '.kts'];

const EXCLUDED_DIRS = new Set([
  '.git',
  '.idea',
  '.gradle',
  '.kotlin',
  'node_modules',
  'target',
  'build',
  'dist',
  '.archguard',
]);

function isExcluded(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name);
}

async function directoryHasKotlinFiles(dir: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && KOTLIN_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      return true;
    }
    if (entry.isDirectory() && !isExcluded(entry.name)) {
      if (await directoryHasKotlinFiles(path.join(dir, entry.name))) {
        return true;
      }
    }
  }

  return false;
}

async function readGradleModules(projectRoot: string): Promise<string[]> {
  const settingsPath = path.join(projectRoot, 'settings.gradle.kts');
  let settings: string;
  try {
    settings = await fs.readFile(settingsPath, 'utf-8');
  } catch {
    return [];
  }

  const modules: string[] = [];
  // Match include(":app"), include(':core'), include("core"), include(':core:network')
  // Note: must allow ':' inside the capture group since Gradle module paths start with ':'
  const includeRegex = /include\s*\(\s*["']\s*([^"')]+)\s*["']\s*\)/g;

  for (const match of settings.matchAll(includeRegex)) {
    const rawName = match[1]?.trim();
    if (!rawName) continue;
    // Strip leading colon if present, then replace remaining colons with slashes
    const moduleName = rawName.replace(/^:/, '').replace(/:/g, '/');
    if (moduleName) {
      modules.push(moduleName);
    }
  }

  return [...new Set(modules)];
}

export async function detectKotlinProjectStructure(
  projectRoot: string,
  options?: { label?: string; format?: DiagramConfig['format']; exclude?: string[] }
): Promise<DiagramConfig[]> {
  const label = options?.label ?? path.basename(projectRoot);
  const common: Partial<DiagramConfig> = {
    language: 'kotlin',
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
      queryRole: 'primary',
    } as DiagramConfig,
  ];

  const modules = await readGradleModules(projectRoot);
  const validModules: string[] = [];

  for (const moduleName of modules) {
    const moduleRoot = path.join(projectRoot, moduleName);
    if (await directoryHasKotlinFiles(moduleRoot)) {
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
