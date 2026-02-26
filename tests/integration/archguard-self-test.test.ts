/**
 * Integration test - ArchGuard Self Test
 * Parse the ArchGuard project itself to validate Phase 1
 */

import { describe, it, expect } from 'vitest';
import { TypeScriptParser } from '@/parser/typescript-parser';
import * as path from 'path';

describe('ArchGuard Self Test - Integration', () => {
  it('should parse ArchGuard project src directory', () => {
    const parser = new TypeScriptParser();
    const srcDir = path.resolve(__dirname, '../../src');

    const startTime = Date.now();
    const archJson = parser.parseProject(srcDir);
    const duration = Date.now() - startTime;

    // Performance: Should parse in < 30 seconds (with coverage instrumentation)
    // Normal run: ~5 seconds, with coverage: ~12 seconds
    // Future optimization target: < 2 seconds
    expect(duration).toBeLessThan(30000);

    // Should have entities
    expect(archJson.entities.length).toBeGreaterThan(0);

    // Should have source files
    expect(archJson.sourceFiles.length).toBeGreaterThan(0);

    // Verify basic structure
    expect(archJson.version).toBe('1.0');
    expect(archJson.language).toBe('typescript');
    expect(archJson.timestamp).toBeDefined();

    // Validate specific extractors exist
    const classExtractor = archJson.entities.find(
      (e) => e.name === 'ClassExtractor' && e.type === 'class'
    );
    expect(classExtractor).toBeDefined();
    expect(classExtractor?.members.length).toBeGreaterThan(0);

    const interfaceExtractor = archJson.entities.find(
      (e) => e.name === 'InterfaceExtractor' && e.type === 'class'
    );
    expect(interfaceExtractor).toBeDefined();

    const enumExtractor = archJson.entities.find(
      (e) => e.name === 'EnumExtractor' && e.type === 'class'
    );
    expect(enumExtractor).toBeDefined();

    const relationExtractor = archJson.entities.find(
      (e) => e.name === 'RelationExtractor' && e.type === 'class'
    );
    expect(relationExtractor).toBeDefined();

    const typeScriptParser = archJson.entities.find(
      (e) => e.name === 'TypeScriptParser' && e.type === 'class'
    );
    expect(typeScriptParser).toBeDefined();

    // Should have relationships
    expect(archJson.relations.length).toBeGreaterThan(0);

    // Verify TypeScriptParser uses other extractors
    const parserRelations = archJson.relations.filter((r) => r.source === 'TypeScriptParser');
    expect(parserRelations.length).toBeGreaterThan(0);
  }, 10000); // 10 second timeout for integration test

  it('should generate valid JSON', () => {
    const parser = new TypeScriptParser();
    const srcDir = path.resolve(__dirname, '../../src');

    const archJson = parser.parseProject(srcDir);
    const json = parser.toJSON(archJson);

    // Should be valid JSON
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(json)).not.toThrow();

    // Should be parseable back
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed = JSON.parse(json) as { version: string; language: string };
    expect(parsed.version).toBe('1.0');
    expect(parsed.language).toBe('typescript');
  }, 10000);

  it('should have correct entity types', () => {
    const parser = new TypeScriptParser();
    const srcDir = path.resolve(__dirname, '../../src');

    const archJson = parser.parseProject(srcDir);

    // Should have classes
    const classes = archJson.entities.filter((e) => e.type === 'class');
    expect(classes.length).toBeGreaterThan(0);

    // Should have interfaces
    const interfaces = archJson.entities.filter((e) => e.type === 'interface');
    expect(interfaces.length).toBeGreaterThan(0);

    // Each entity should have required fields
    archJson.entities.forEach((entity) => {
      expect(entity.id).toBeDefined();
      expect(entity.name).toBeDefined();
      expect(entity.type).toBeDefined();
      expect(entity.visibility).toBeDefined();
      expect(entity.members).toBeDefined();
      expect(entity.sourceLocation).toBeDefined();
      expect(entity.sourceLocation.file).toBeDefined();
      expect(entity.sourceLocation.startLine).toBeGreaterThan(0);
      expect(entity.sourceLocation.endLine).toBeGreaterThan(0);
    });
  }, 10000);

  it('should have correct relation types', () => {
    const parser = new TypeScriptParser();
    const srcDir = path.resolve(__dirname, '../../src');

    const archJson = parser.parseProject(srcDir);

    // Each relation should have required fields
    archJson.relations.forEach((relation) => {
      expect(relation.id).toBeDefined();
      expect(relation.type).toBeDefined();
      expect(relation.source).toBeDefined();
      expect(relation.target).toBeDefined();

      // Type should be one of the valid types
      expect([
        'inheritance',
        'implementation',
        'composition',
        'aggregation',
        'dependency',
      ]).toContain(relation.type);
    });

    // Should have composition relations (classes using other classes)
    const compositions = archJson.relations.filter((r) => r.type === 'composition');
    expect(compositions.length).toBeGreaterThan(0);
  }, 10000);
});
