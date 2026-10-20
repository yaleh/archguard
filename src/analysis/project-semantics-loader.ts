import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ProjectSemanticsInputSchema,
  type ProjectSemanticsInput,
} from '@/types/extensions/project-semantics.js';

const PROJECT_SEMANTICS_FILE_NAME = 'project-semantics.json';

/**
 * Explicit three-valued load status for the project-semantics sidecar.
 *
 * `missing` is a first-class outcome (not an empty object / silent null): callers
 * that would otherwise degrade coverage ratios to null can report WHY instead of
 * leaving a bare null indistinguishable from "loaded but empty".
 */
export type ProjectSemanticsStatus = 'loaded' | 'missing' | 'invalid';

export interface ProjectSemanticsPreflight {
  /** Explicit sidecar status. */
  projectSemantics: ProjectSemanticsStatus;
  /** Parsed semantics — present only when projectSemantics === 'loaded'. */
  semantics?: ProjectSemanticsInput;
  /** Validation/read error — present only when projectSemantics === 'invalid'. */
  error?: string;
}

export async function loadProjectSemanticsSidecar(
  workDir: string
): Promise<ProjectSemanticsInput | undefined> {
  const filePath = path.join(workDir, PROJECT_SEMANTICS_FILE_NAME);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = ProjectSemanticsInputSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid ${PROJECT_SEMANTICS_FILE_NAME}:\n${issues}`);
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Preflight the project-semantics sidecar without collapsing "no sidecar" into
 * an absent value. A caller that pairs this with nullable coverage fields can
 * emit `projectSemantics: "missing"` instead of a bare `null` ratio.
 *
 * Never throws for a malformed sidecar — an invalid file is reported as
 * `{ projectSemantics: 'invalid', error }` so it stays distinguishable from
 * both a valid file and a missing one.
 */
export async function preflightProjectSemantics(
  workDir: string
): Promise<ProjectSemanticsPreflight> {
  try {
    const semantics = await loadProjectSemanticsSidecar(workDir);
    if (semantics === undefined) {
      return { projectSemantics: 'missing' };
    }
    return { projectSemantics: 'loaded', semantics };
  } catch (error) {
    return {
      projectSemantics: 'invalid',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
