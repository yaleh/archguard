/**
 * Stage 59.3 tests — file moves, comment stripping, string/external
 * dependency replacement, and standalone compilability of the output tree.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import type { ObfuscateResult } from '../lib/obfuscate/index.js';
import { makeOutDir, readTree, runFixture } from './fixtures/obfuscate/helpers.js';

describe('obfuscate stage 59.3 — emit tree', () => {
  let outDir: string;
  let result: ObfuscateResult;
  let tree: Map<string, string>;

  beforeAll(() => {
    outDir = makeOutDir('emit');
    result = runFixture(outDir);
    tree = readTree(outDir);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('files and directories are renamed; no path leaks original names', () => {
    const files = result.mapping.files;
    expect(Object.keys(files.forward).sort()).toEqual([
      'src/index.ts',
      'src/mermaid/renderer.ts',
      'src/parser/parse.ts',
      'src/types/model.ts',
    ]);
    for (const [orig, obf] of Object.entries(files.forward)) {
      expect(obf).toMatch(/^(d\d+\/)+f\d+\.ts$/);
      expect(files.reverse[obf]).toBe(orig);
      expect(tree.has(obf), `output file ${obf} missing`).toBe(true);
    }
    for (const rel of tree.keys()) {
      expect(rel).not.toMatch(/mermaid|parser|types|model|renderer|parse|src/i);
    }
  });

  it('output contains zero comments', () => {
    for (const [rel, text] of tree) {
      if (!rel.endsWith('.ts')) continue;
      expect(text, `comment residue in ${rel}`).not.toMatch(/\/\/|\/\*/);
    }
  });

  it('string literal values are replaced consistently across value and type positions', () => {
    const strings = result.mapping.strings.forward;
    const dark = strings['dark'];
    const classDiagram = strings['classDiagram'];
    expect(dark).toMatch(/^s\d+$/);
    expect(classDiagram).toMatch(/^s\d+$/);
    const typesOut = tree.get(result.mapping.files.forward['src/types/model.ts']!)!;
    const rendererOut = tree.get(result.mapping.files.forward['src/mermaid/renderer.ts']!)!;
    // 'dark' appears in a type position (Theme union) and a value position (=== comparison).
    expect(typesOut).toContain(`'${dark}'`);
    expect(rendererOut).toContain(`'${dark}'`);
    // 'classDiagram' appears as enum initializer and as a const initializer — same placeholder.
    expect(typesOut).toContain(`'${classDiagram}'`);
    expect(rendererOut).toContain(`'${classDiagram}'`);
    // No original string values anywhere.
    for (const [rel, text] of tree) {
      if (!rel.endsWith('.ts')) continue;
      expect(text).not.toMatch(/classDiagram|flowchart|forest|dark/);
    }
  });

  it('regex literals are replaced and recorded in the strings namespace', () => {
    const parserOut = tree.get(result.mapping.files.forward['src/parser/parse.ts']!)!;
    expect(parserOut).not.toMatch(/classDiagram|flowchart/);
    const regexKey = Object.keys(result.mapping.strings.forward).find((k) => k.startsWith('/'));
    expect(regexKey, 'regex literal missing from strings namespace').toBeDefined();
    const placeholder = result.mapping.strings.forward[regexKey!]!;
    expect(placeholder).toMatch(/^r\d+$/);
    expect(parserOut).toContain(`/${placeholder}/`);
  });

  it('external bare specifiers stay bare and map to pkgN', () => {
    const pkgs = result.mapping.packages;
    expect(pkgs.forward['isomorphic-mermaid']).toMatch(/^pkg\d+$/);
    expect(pkgs.forward['node:path']).toMatch(/^pkg\d+$/);
    const rendererOut = tree.get(result.mapping.files.forward['src/mermaid/renderer.ts']!)!;
    for (const obf of Object.values(pkgs.forward)) {
      expect(obf).not.toMatch(/^\./);
      expect(rendererOut).toContain(`from '${obf}'`);
    }
    // Ambient declarations exist so the tree compiles standalone.
    const externals = tree.get('externals.d.ts')!;
    for (const obf of Object.values(pkgs.forward)) {
      expect(externals).toContain(`declare module '${obf}';`);
    }
  });

  it('alias (@x/*) and relative imports are rewritten to in-tree relative specifiers', () => {
    for (const [rel, text] of tree) {
      if (!rel.endsWith('.ts') || rel === 'externals.d.ts') continue;
      expect(text, `alias residue in ${rel}`).not.toContain('@x/');
    }
    const parserOut = tree.get(result.mapping.files.forward['src/parser/parse.ts']!)!;
    const typesObf = result.mapping.files.forward['src/types/model.ts']!.replace(/\.ts$/, '');
    // Specifier must point at the renamed types file via a relative path.
    expect(parserOut).toContain(`'../${typesObf.split('/').slice(1).join('/')}'`);
  });

  it('external member accesses on obfuscated packages do not leak API names', () => {
    const rendererOut = tree.get(result.mapping.files.forward['src/mermaid/renderer.ts']!)!;
    // mermaid.render(...) must not survive as ".render(" in the output.
    expect(rendererOut).not.toMatch(/\.render\(/);
  });

  it('obfuscated tree compiles standalone (tsc --noEmit equivalent, zero diagnostics)', () => {
    const project = new Project({ tsConfigFilePath: path.join(outDir, 'tsconfig.json') });
    const diags = project.getPreEmitDiagnostics();
    const messages = diags.map(
      (d) => `${d.getSourceFile()?.getFilePath() ?? '?'}:${d.getLineNumber() ?? '?'} ${JSON.stringify(d.getMessageText())}`
    );
    expect(messages).toEqual([]);
  });
});
