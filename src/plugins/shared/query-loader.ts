/**
 * QueryLoader — reads tree-sitter S-expression (`.scm`) query files from a
 * `queries/` directory and compiles them exactly once against a parser
 * session's grammar via `session.query()`. Compiled queries are cached for the
 * loader's lifetime, so repeated `load(name)` calls return the same instance.
 *
 * Standard layout: `src/plugins/<lang>/queries/<concern>.scm`
 * (classes, functions, fields, enums, includes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ParseError } from '@/parser/errors.js';
import type { ParserQueryLike } from './syntax-tree.js';

/** Map of query name (filename without `.scm`) → compiled query. */
export type QuerySet = Map<string, ParserQueryLike>;

/** Anything that can compile an S-expression query (a `ParserSession` qualifies). */
export interface QueryCompiler {
  query(source: string): ParserQueryLike;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error) ?? 'unknown error';
}

export class QueryLoader {
  private readonly cache = new Map<string, ParserQueryLike>();

  constructor(
    private readonly queryDir: string,
    private readonly session: QueryCompiler
  ) {}

  /**
   * Load and compile all `.scm` files in `queryDir`. Keys are filenames
   * without the `.scm` extension. A missing or empty directory yields an empty
   * Map.
   */
  loadAll(): QuerySet {
    const queries: QuerySet = new Map();
    if (!fs.existsSync(this.queryDir)) return queries;
    const files = fs.readdirSync(this.queryDir).filter((f) => f.endsWith('.scm'));
    for (const file of files) {
      const name = path.basename(file, '.scm');
      queries.set(name, this.load(name));
    }
    return queries;
  }

  /** Load and compile a single named query file (`<name>.scm`), caching it. */
  load(name: string): ParserQueryLike {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const filePath = path.join(this.queryDir, `${name}.scm`);
    const source = fs.readFileSync(filePath, 'utf-8');
    let query: ParserQueryLike;
    try {
      query = this.session.query(source);
    } catch (error) {
      throw new ParseError(
        `Failed to compile tree-sitter query ${JSON.stringify(filePath)}: ${errorMessage(error)}`,
        filePath
      );
    }
    this.cache.set(name, query);
    return query;
  }
}
