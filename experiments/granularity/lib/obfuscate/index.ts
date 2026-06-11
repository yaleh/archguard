/**
 * Symbol obfuscator (Stages 59.2 + 59.3) — public API.
 *
 * Pipeline: load project (entry modules + repo-internal import closure, main
 * tsconfig paths active) → rename passes (entities/members, then external
 * import aliases, object-literal props, locals) → emit obfuscated tree
 * (renamed dirs/files, rewritten specifiers, replaced strings/regexes,
 * comments stripped) + bidirectional mapping. In-memory only: the original
 * source tree is never modified on disk.
 */
import { NameGenerator } from './name-generator.js';
import { MappingBuilder, type ObfuscationMapping } from './mapping.js';
import { loadProject, runRenamePasses } from './renamer.js';
import { emitTree, type EmittedFile } from './emitter.js';

export { serializeMapping, type ObfuscationMapping, type BidiMap } from './mapping.js';
export { NameGenerator } from './name-generator.js';

export const DEFAULT_SEED = 59;

export interface ObfuscateOptions {
  /** tsconfig used to LOAD the original project (path aliases active). */
  tsConfigFilePath: string;
  /** Base for relative paths in the mapping (repo root). */
  repoRoot: string;
  /** Globs of the scoped modules, e.g. `<repo>/src/mermaid/**\/*.ts`. */
  entryGlobs: string[];
  /** Directory bound for the import-closure BFS, e.g. `<repo>/src`. */
  closureDir: string;
  /** Output directory for the obfuscated tree. */
  outDir: string;
  seed?: number;
}

export interface ObfuscateResult {
  mapping: ObfuscationMapping;
  files: EmittedFile[];
  fileCount: number;
  totalBytes: number;
  warnings: string[];
}

export function obfuscate(opts: ObfuscateOptions): ObfuscateResult {
  const seed = opts.seed ?? DEFAULT_SEED;
  const gen = new NameGenerator(seed);
  const builder = new MappingBuilder(seed);

  const { project, files } = loadProject({
    tsConfigFilePath: opts.tsConfigFilePath,
    entryGlobs: opts.entryGlobs,
    closureDir: opts.closureDir,
  });

  const { warnings, memberNameTable } = runRenamePasses(project, files, opts.repoRoot, gen, builder); // 59.2
  const emitted = emitTree(
    project,
    files,
    { outDir: opts.outDir, repoRoot: opts.repoRoot },
    gen,
    builder,
    memberNameTable
  ); // 59.3

  return {
    mapping: builder.build(),
    files: emitted,
    fileCount: emitted.length,
    totalBytes: emitted.reduce((acc, f) => acc + f.bytes, 0),
    warnings,
  };
}
