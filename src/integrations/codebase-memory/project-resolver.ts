/**
 * Codebase Memory integration layer — project resolver.
 *
 * Resolves a Codebase Memory project for a given ArchGuard `projectRoot` using
 * `list_projects`, following the precedence defined in the proposal:
 *
 *   1. exact root-path match wins;
 *   2. otherwise, a unique repository-directory-name match;
 *   3. otherwise return an actionable diagnostic (not indexed / ambiguous).
 *
 * Ordinary query paths must never auto-run `index_repository`; the resolver
 * only reads `list_projects` and reports.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md (phase 1).
 *
 * @module integrations/codebase-memory/project-resolver
 */

import path from 'node:path';
import { CodebaseMemoryClient } from '@/integrations/codebase-memory/client.js';
import { createDiagnostic, type BackendDiagnostic } from '@/integrations/codebase-memory/types.js';

/** A single project entry as returned by `list_projects`. */
export interface CodebaseMemoryProjectInfo {
  /** Project name (used as the `project` arg to other tools). */
  name: string;
  /** Absolute root path of the indexed repository, if known. */
  root?: string;
  /** Whether the project has been indexed. */
  indexed?: boolean;
}

/** Shape of the `list_projects` payload this resolver understands. */
interface ListProjectsPayload {
  projects?: CodebaseMemoryProjectInfo[];
}

/** How a project name was matched. */
export type ProjectMatchKind = 'exact-path' | 'directory-name';

/** Discriminated outcome of {@link resolveProject}. */
export type ProjectResolution =
  | { ok: true; project: string; matchedBy: ProjectMatchKind }
  | { ok: false; diagnostic: BackendDiagnostic };

/** Normalize a path for comparison (resolve + strip trailing separators). */
function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  // path.resolve already removes trailing separators except for root.
  return resolved;
}

/** Build the actionable `index_repository` next-step command. */
function indexNextStep(projectRoot: string): string {
  return `codebase-memory-mcp cli index_repository '${JSON.stringify({
    repo_path: projectRoot,
  })}'`;
}

/**
 * Resolve a Codebase Memory project for `projectRoot`.
 *
 * @param client - a {@link CodebaseMemoryClient} (real or mocked).
 * @param projectRoot - the ArchGuard repository root to resolve.
 * @returns a discriminated resolution: project name + match kind, or a
 *   normalized diagnostic.
 */
export async function resolveProject(
  client: CodebaseMemoryClient,
  projectRoot: string
): Promise<ProjectResolution> {
  const listed = await client.call<ListProjectsPayload>('list_projects');
  if (listed.ok !== true) {
    // Surface the client's normalized diagnostic verbatim.
    return { ok: false, diagnostic: listed.diagnostic };
  }

  const projects = listed.data.projects ?? [];
  const targetPath = normalizePath(projectRoot);
  const targetDir = path.basename(targetPath);

  // 1. Exact root-path match.
  const exact = projects.filter(
    (p) => typeof p.root === 'string' && normalizePath(p.root) === targetPath
  );
  if (exact.length === 1) {
    return { ok: true, project: exact[0].name, matchedBy: 'exact-path' };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      diagnostic: ambiguousDiagnostic(
        projectRoot,
        exact.map((p) => p.name)
      ),
    };
  }

  // 2. Unique repository-directory-name match.
  const byDir = projects.filter((p) => p.name === targetDir);
  if (byDir.length === 1) {
    return { ok: true, project: byDir[0].name, matchedBy: 'directory-name' };
  }
  if (byDir.length > 1) {
    return {
      ok: false,
      diagnostic: ambiguousDiagnostic(
        projectRoot,
        byDir.map((p) => p.name)
      ),
    };
  }

  // 3. No match — not indexed.
  return {
    ok: false,
    diagnostic: createDiagnostic(
      'project-not-indexed',
      `Codebase Memory has not indexed the current repository: ${projectRoot}`,
      { nextSteps: [indexNextStep(projectRoot)] }
    ),
  };
}

/** Construct an ambiguity diagnostic listing the candidate project names. */
function ambiguousDiagnostic(projectRoot: string, candidates: string[]): BackendDiagnostic {
  return createDiagnostic(
    'project-ambiguous',
    `Multiple Codebase Memory projects matched repository ${projectRoot}: ${candidates.join(
      ', '
    )}. Specify the project explicitly.`,
    { nextSteps: candidates.map((name) => `--cbm-project ${name}`) }
  );
}
