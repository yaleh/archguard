import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import { QueryLoader } from '@/plugins/shared/query-loader.js';
import { ParseError } from '@/parser/errors.js';
import type { ParserSession } from '@/plugins/shared/syntax-tree.js';

describe('QueryLoader', () => {
  let session: ParserSession;
  let dir: string;

  beforeAll(async () => {
    session = await nativeParserBackend.createSession('cpp');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-query-loader-'));
  });

  afterAll(async () => {
    session.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('load(name) reads and compiles a .scm file into a query', () => {
    fs.writeFileSync(
      path.join(dir, 'classes.scm'),
      '(class_specifier name: (type_identifier) @class.specifier)'
    );
    const loader = new QueryLoader(dir, session);
    const query = loader.load('classes');
    expect(typeof query.matches).toBe('function');
  });

  it('compiled queries are cached — load twice returns the same reference', () => {
    const loader = new QueryLoader(dir, session);
    const first = loader.load('classes');
    const second = loader.load('classes');
    expect(second).toBe(first);
  });

  it('loadAll() returns a Map keyed by filename-without-extension', () => {
    fs.writeFileSync(
      path.join(dir, 'enums.scm'),
      '(enum_specifier name: (type_identifier) @enum.specifier)'
    );
    fs.writeFileSync(
      path.join(dir, 'includes.scm'),
      '(preproc_include path: (system_lib_string) @include.path)'
    );
    const loader = new QueryLoader(dir, session);
    const all = loader.loadAll();
    expect([...all.keys()].sort()).toEqual(['classes', 'enums', 'includes']);
    for (const query of all.values()) {
      expect(typeof query.matches).toBe('function');
    }
  });

  it('throws ParseError with the file path on malformed .scm syntax', () => {
    const badPath = path.join(dir, 'bad.scm');
    fs.writeFileSync(badPath, '(class_specifier name: (type_identifier) @name');
    const loader = new QueryLoader(dir, session);
    let caught: unknown;
    try {
      loader.load('bad');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect((caught as ParseError).filePath).toBe(badPath);
  });

  it('returns an empty Map for an empty directory', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-query-empty-'));
    try {
      const loader = new QueryLoader(emptyDir, session);
      expect(loader.loadAll().size).toBe(0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns an empty Map when the queries directory does not exist', () => {
    const loader = new QueryLoader(path.join(dir, 'does-not-exist'), session);
    expect(loader.loadAll().size).toBe(0);
  });
});
