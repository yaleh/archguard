import fs from 'fs-extra';

export async function readModuleName(workspaceRoot: string): Promise<string> {
  try {
    const goModContent = await fs.readFile(`${workspaceRoot}/go.mod`, 'utf-8');
    const match = goModContent.match(/^module\s+(.+)$/m);
    return match ? match[1].trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}
