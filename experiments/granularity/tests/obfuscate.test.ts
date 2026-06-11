/**
 * Stage 59.2 tests — semantic renaming + mapping.json.
 *
 * Runs the obfuscator against the micro fixture project in
 * tests/fixtures/obfuscate/proj and checks rename consistency,
 * structural isomorphism, mapping reversibility/completeness
 * (including interface-member propagation) and byte determinism.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { serializeMapping, type ObfuscateResult } from '../lib/obfuscate/index.js';
import { makeOutDir, readTree, runFixture } from './fixtures/obfuscate/helpers.js';

describe('obfuscate stage 59.2 — rename + mapping', () => {
  let outDir: string;
  let result: ObfuscateResult;
  let tree: Map<string, string>;

  beforeAll(() => {
    outDir = makeOutDir('rename');
    result = runFixture(outDir);
    tree = readTree(outDir);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('renames all top-level entities and records them in the entities namespace', () => {
    const fwd = result.mapping.entities.forward;
    for (const name of [
      'Diagram',
      'Theme',
      'DiagramKind',
      'DEFAULT_THEME',
      'SvgRenderer',
      'parseDiagram',
      'PARSER_VERSION',
    ]) {
      expect(fwd[name], `entity ${name} missing from mapping`).toBeDefined();
      expect(fwd[name]).toMatch(/^[A-Z][a-z]\d+$/);
    }
  });

  it('renames members and records them qualified by owner', () => {
    const fwd = result.mapping.members.forward;
    for (const key of [
      'Diagram.kind',
      'Diagram.render',
      'DiagramKind.CLASS',
      'DiagramKind.FLOW',
      'SvgRenderer.kind',
      'SvgRenderer.theme',
      'SvgRenderer.render',
      'SvgRenderer.setTheme',
    ]) {
      expect(fwd[key], `member ${key} missing from mapping`).toBeDefined();
      expect(fwd[key]).toMatch(/^[A-Z][a-z]\d+\.[mp]\d+$/);
    }
  });

  it('no original identifier text survives in the output tree', () => {
    const leak =
      /diagram|mermaid|render|parse|theme|forest|dark|svg|flowchart|kind|scale|header|matched|source/i;
    for (const [rel, text] of tree) {
      if (!rel.endsWith('.ts')) continue;
      expect(text, `leak in ${rel}`).not.toMatch(leak);
    }
  });

  it('interface member rename propagates to implementing class with a shared obfuscated member name', () => {
    const fwd = result.mapping.members.forward;
    const ifaceRender = fwd['Diagram.render']!;
    const classRender = fwd['SvgRenderer.render']!;
    expect(ifaceRender).toBeDefined();
    expect(classRender).toBeDefined();
    // Same member suffix (single language-service rename affected both declarations).
    expect(ifaceRender.split('.')[1]).toBe(classRender.split('.')[1]);
    // Owners map to their own obfuscated entity names.
    expect(ifaceRender.split('.')[0]).toBe(result.mapping.entities.forward['Diagram']);
    expect(classRender.split('.')[0]).toBe(result.mapping.entities.forward['SvgRenderer']);
  });

  it('relation structure is isomorphic: implements/heritage preserved under the mapping', () => {
    const project = new Project({ tsConfigFilePath: path.join(outDir, 'tsconfig.json') });
    const obfClassName = result.mapping.entities.forward['SvgRenderer'];
    const obfIfaceName = result.mapping.entities.forward['Diagram'];
    const obfEnumName = result.mapping.entities.forward['DiagramKind'];
    const classDecl = project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === obfClassName);
    expect(classDecl, 'obfuscated class not found').toBeDefined();
    const impls = classDecl!.getImplements().map((i) => i.getText());
    expect(impls).toContain(obfIfaceName);
    const enumDecl = project
      .getSourceFiles()
      .flatMap((sf) => sf.getEnums())
      .find((e) => e.getName() === obfEnumName);
    expect(enumDecl, 'obfuscated enum not found').toBeDefined();
    expect(enumDecl!.getMembers()).toHaveLength(2);
    // Method count preserved on the class (render + setTheme).
    expect(classDecl!.getMethods()).toHaveLength(2);
  });

  it('mapping is reversible with no omissions in every namespace', () => {
    for (const ns of ['entities', 'members', 'files', 'strings', 'packages'] as const) {
      const { forward, reverse } = result.mapping[ns];
      expect(Object.keys(forward).length, `${ns} forward empty`).toBeGreaterThan(0);
      expect(Object.keys(forward)).toHaveLength(Object.keys(reverse).length);
      for (const [orig, obf] of Object.entries(forward)) {
        expect(reverse[obf], `${ns}: reverse missing for ${orig} -> ${obf}`).toBe(orig);
      }
    }
    // Obfuscated names are globally unique across entities/members/locals
    // (member suffixes deduped first: propagated renames share one suffix by design).
    const memberSuffixes = [
      ...new Set(Object.values(result.mapping.members.forward).map((v) => v.split('.')[1])),
    ];
    const all = [
      ...Object.values(result.mapping.entities.forward),
      ...memberSuffixes,
      ...Object.keys(result.mapping.locals.reverse),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('two runs produce byte-identical trees and mapping (determinism)', () => {
    const outDir2 = makeOutDir('rename2');
    try {
      const result2 = runFixture(outDir2);
      expect(serializeMapping(result2.mapping)).toBe(serializeMapping(result.mapping));
      const tree2 = readTree(outDir2);
      expect([...tree2.keys()]).toEqual([...tree.keys()]);
      for (const [rel, text] of tree) {
        expect(tree2.get(rel), `file ${rel} differs between runs`).toBe(text);
      }
    } finally {
      rmSync(outDir2, { recursive: true, force: true });
    }
  });
});
