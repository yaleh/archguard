/**
 * Project Structure Detector
 *
 * Auto-detects project source layout and generates multi-level DiagramConfig[]
 * when no explicit config or CLI sources are provided.
 *
 * Detection logic:
 * 1. Locate the source root: src/ → lib/ → app/ → source/ → ./
 * 2. List direct subdirectories (skip empty dirs with no .ts/.js files)
 * 3. If 0-1 modules → single diagram (architecture, class)
 * 4. If 2+ modules → three-layer set:
 *    - overview/package  (package level, full source root)
 *    - class/all-classes (class level, full source root)
 *    - method/<name>     (method level, per module)
 *
 * @module cli/utils/project-structure-detector
 */

import fs from 'fs-extra';
import path from 'path';
import type { DiagramConfig } from '../../types/config.js';

/** Source root candidates, checked in priority order */
const SOURCE_ROOT_CANDIDATES = ['src', 'lib', 'app', 'source'];

/** Directory names to skip when scanning for top-level modules */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '__tests__',
  'tests',
  'test',
  '.cache',
  '.tmp',
  'tmp',
]);

/**
 * Detect project source root by checking well-known directory names.
 *
 * @param rootDir - Project root directory (absolute path)
 * @returns Relative path to source root (e.g. "./src"), or "./" as fallback
 */
export async function findSourceRoot(rootDir: string): Promise<string> {
  for (const candidate of SOURCE_ROOT_CANDIDATES) {
    const fullPath = path.join(rootDir, candidate);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        return `./${candidate}`;
      }
    } catch {
      // directory doesn't exist — try next
    }
  }
  return './';
}

/**
 * List top-level module names inside sourceRoot that contain TypeScript/JavaScript files.
 *
 * Only immediate subdirectories are returned; empty directories are excluded.
 *
 * @param rootDir   - Project root directory (absolute path)
 * @param sourceRoot - Source root path — may be relative (e.g. "./src") or absolute
 * @returns Sorted array of module directory names (e.g. ["cli", "parser", "utils"])
 */
export async function getTopLevelModules(rootDir: string, sourceRoot: string): Promise<string[]> {
  // path.resolve with an absolute sourceRoot ignores rootDir, which is the desired behavior
  const absoluteRoot = path.resolve(rootDir, sourceRoot);

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const modules: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    // Check whether this subdirectory contains any source files
    const hasSource = await directoryHasSourceFiles(path.join(absoluteRoot, entry.name));
    if (hasSource) {
      modules.push(entry.name);
    }
  }

  return modules.sort();
}

/**
 * Check whether the given directory has any direct (non-recursive) .ts or .js files.
 *
 * @param sourceRootPath - Absolute path to the source root directory
 * @returns true if at least one direct .ts or .js file exists
 */
export async function hasTopLevelSourceFiles(sourceRootPath: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(sourceRootPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === '.ts' || ext === '.js') {
      return true;
    }
  }

  return false;
}

/**
 * Recursively check whether a directory contains any .ts or .js files.
 *
 * Stops as soon as it finds one to keep IO minimal.
 */
async function directoryHasSourceFiles(dir: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.ts' || ext === '.js') {
        return true;
      }
    } else if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
      const nested = await directoryHasSourceFiles(path.join(dir, entry.name));
      if (nested) return true;
    }
  }

  return false;
}

/**
 * Auto-detect project structure and return appropriate DiagramConfig[].
 *
 * This is the default (Priority 3) when neither config.diagrams nor CLI -s is set.
 *
 * @param rootDir - Project root directory (default: process.cwd())
 * @param externalSourceRoot - Optional absolute path to an external source root.
 *   When provided, `findSourceRoot()` is skipped and this path is used directly.
 *   All generated DiagramConfig `sources` will contain absolute paths.
 * @returns Array of DiagramConfig representing the auto-detected diagram set
 */
export async function detectProjectStructure(
  rootDir: string,
  externalSourceRoot?: string
): Promise<DiagramConfig[]> {
  let sourceRoot: string;
  let projectRoot: string;
  let useAbsolutePaths: boolean;

  if (externalSourceRoot !== undefined) {
    // External mode: use the provided absolute path directly
    sourceRoot = externalSourceRoot;
    useAbsolutePaths = true;

    // Derive projectRoot: if the basename is a known source dir, use the parent
    const basename = path.basename(externalSourceRoot);
    if (SOURCE_ROOT_CANDIDATES.includes(basename)) {
      projectRoot = path.dirname(externalSourceRoot);
    } else {
      projectRoot = externalSourceRoot;
    }
  } else {
    // Default mode: detect relative source root from rootDir
    sourceRoot = await findSourceRoot(rootDir);
    projectRoot = rootDir;
    useAbsolutePaths = false;
  }

  const modules = await getTopLevelModules(projectRoot, sourceRoot);

  // Helper to build a source path for a module
  const modulePath = (mod: string): string => `${sourceRoot}/${mod}`;

  // Fewer than 2 modules → degenerate to single-diagram mode
  if (modules.length < 2) {
    return [
      {
        name: 'architecture',
        sources: [sourceRoot],
        level: 'class',
      },
    ];
  }

  // 2+ modules → three-layer diagram set
  const diagrams: DiagramConfig[] = [
    {
      name: 'overview/package',
      sources: [sourceRoot],
      level: 'package',
      description: 'Package-level overview of entire project',
    },
    {
      name: 'class/all-classes',
      sources: [sourceRoot],
      level: 'class',
      description: 'Class-level view of entire project',
    },
  ];

  // Per-module method diagrams
  diagrams.push(
    ...modules.map((mod) => ({
      name: `method/${mod}`,
      sources: [modulePath(mod)],
      level: 'method' as const,
      description: `Method-level detail for ${mod} module`,
    }))
  );

  return diagrams;
}
