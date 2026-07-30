import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIRECT_CONSTRUCTION =
  /new\s+(?:GoPlugin|GoAtlasPlugin|JavaPlugin|PythonPlugin|CppPlugin|KotlinPlugin)\s*\(/g;

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory()
      ? sourceFiles(filePath)
      : entry.name.endsWith('.ts')
        ? [filePath]
        : [];
  });
}

describe('language plugin construction boundary', () => {
  it('allows direct construction only in the resolver-mediated factory', () => {
    const srcRoot = path.resolve('src');
    const factory = path.resolve('src/plugins/shared/plugin-factory.ts');
    const violations = sourceFiles(srcRoot)
      .filter((file) => file !== factory)
      .flatMap((file) => {
        const matches = [...fs.readFileSync(file, 'utf8').matchAll(DIRECT_CONSTRUCTION)];
        return matches.map((match) => path.relative(process.cwd(), file) + ':' + match[0]);
      });
    expect(violations).toEqual([]);
  });
});
