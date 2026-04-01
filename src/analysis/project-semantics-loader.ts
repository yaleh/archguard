import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ProjectSemanticsInputSchema,
  type ProjectSemanticsInput,
} from '@/types/extensions/project-semantics.js';

const PROJECT_SEMANTICS_FILE_NAME = 'project-semantics.json';

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
