import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';

export interface GoAnalysisScopePlan {
  workspaceRoot: string;
  includePatterns: string[];
  excludePatterns: string[];
}

export async function planGoAnalysisScope(sources: string[]): Promise<GoAnalysisScopePlan> {
  const resolvedSources = dedupe(sources.map((source) => path.resolve(source)));
  if (resolvedSources.length === 0) {
    throw new Error('Go analysis requires at least one source path.');
  }

  const scoped = await Promise.all(
    resolvedSources.map(async (source) => ({
      source,
      moduleRoot: await findNearestGoModuleRoot(source),
    }))
  );

  const moduleRoots = dedupe(scoped.map((entry) => entry.moduleRoot));
  if (moduleRoots.length !== 1) {
    throw new Error(
      `Go analysis sources span multiple Go modules: ${moduleRoots.join(', ')}. Analyze one module at a time.`
    );
  }

  const workspaceRoot = moduleRoots[0];
  const includePatterns = dedupe(
    await Promise.all(scoped.map((entry) => toIncludePattern(workspaceRoot, entry.source)))
  );
  const excludePatterns = await findNestedModuleExcludePatterns(workspaceRoot);

  return {
    workspaceRoot,
    includePatterns,
    excludePatterns,
  };
}

async function findNearestGoModuleRoot(source: string): Promise<string> {
  let current = await normalizeSourceStart(source);

  while (true) {
    const candidate = path.join(current, 'go.mod');
    if (await fs.pathExists(candidate)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Go source path "${source}" is not inside a Go module (go.mod not found).`);
    }
    current = parent;
  }
}

async function normalizeSourceStart(source: string): Promise<string> {
  if (await fs.pathExists(source)) {
    const stat = await fs.stat(source);
    return stat.isDirectory() ? source : path.dirname(source);
  }
  return path.extname(source) === '.go' ? path.dirname(source) : source;
}

async function toIncludePattern(workspaceRoot: string, source: string): Promise<string> {
  const rel = toPosix(path.relative(workspaceRoot, source));
  if (!rel || rel === '.') {
    return '**/*.go';
  }

  if (await fs.pathExists(source)) {
    const stat = await fs.stat(source);
    if (stat.isFile()) {
      return rel;
    }
  } else if (path.extname(source) === '.go') {
    return rel;
  }

  return `${stripTrailingSlash(rel)}/**/*.go`;
}

async function findNestedModuleExcludePatterns(workspaceRoot: string): Promise<string[]> {
  const goMods = await glob('**/go.mod', {
    cwd: workspaceRoot,
    absolute: false,
    ignore: ['go.mod', '**/vendor/**', '**/node_modules/**'],
  });

  return dedupe(
    goMods
      .map((goModPath) => toPosix(path.dirname(goModPath)))
      .filter((dir) => dir && dir !== '.')
      .map((dir) => `${stripTrailingSlash(dir)}/**`)
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
