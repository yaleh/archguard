/**
 * Tree-sitter bridge for C++ language parsing (query-based, TASK-62).
 *
 * Extraction is driven by `.scm` query files (see ./queries/) compiled once via
 * QueryLoader; each concern has a concrete CaptureMapper. The trivial
 * top-level-namespace walk stays imperative, and extractFromErrorNodes()
 * remains as a documented supplement for the tree-sitter-cpp `extern "C"`
 * grammar limitation (ERROR nodes wrapping otherwise-parseable content).
 */
import { fileURLToPath } from 'node:url';
import type { ParserSession, SyntaxNodeLike } from '../shared/syntax-tree.js';
import { QueryLoader } from '../shared/query-loader.js';
import { ClassBuilder } from './builders/class-builder.js';
import { CppClassMapper } from './mappers/class-capture-mapper.js';
import { CppEnumMapper } from './mappers/enum-capture-mapper.js';
import { CppFieldMapper } from './mappers/field-capture-mapper.js';
import { CppFuncMapper } from './mappers/function-capture-mapper.js';
import { CppIncludeMapper } from './mappers/include-capture-mapper.js';
import type { RawClass, RawCppFile, RawEnum, RawFunction } from './types.js';

interface ErrorSupplement {
  classes: RawClass[];
  enums: RawEnum[];
  functions: RawFunction[];
}

export class TreeSitterBridge {
  private readonly parser: ParserSession;
  private readonly classMapper: CppClassMapper;
  private readonly enumMapper: CppEnumMapper;
  private readonly funcMapper: CppFuncMapper;
  private readonly includeMapper: CppIncludeMapper;

  constructor(parser: ParserSession) {
    this.parser = parser;
    const queriesDir = fileURLToPath(new URL('./queries/', import.meta.url));
    const loader = new QueryLoader(queriesDir, parser);
    this.classMapper = new CppClassMapper(
      loader.load('classes'),
      new ClassBuilder(),
      new CppFieldMapper(loader.load('fields'))
    );
    this.enumMapper = new CppEnumMapper(loader.load('enums'));
    this.funcMapper = new CppFuncMapper(loader.load('functions'));
    this.includeMapper = new CppIncludeMapper(loader.load('includes'));
  }

  parseCode(code: string, filePath: string): RawCppFile {
    const tree = this.parser.parse(code);
    try {
      const root = tree.rootNode;
      const namespace = this.extractTopLevelNamespace(root);
      const supplement = this.extractFromErrorNodes(root, filePath);
      return {
        filePath,
        namespace,
        classes: mergeUnique(this.classMapper.runQuery(root, filePath), supplement.classes),
        enums: mergeUnique(this.enumMapper.runQuery(root, filePath), supplement.enums),
        functions: mergeUnique(this.funcMapper.runQuery(root, filePath), supplement.functions),
        includes: this.includeMapper.runQuery(root, filePath),
      };
    } finally {
      tree.dispose();
    }
  }

  private extractTopLevelNamespace(root: SyntaxNodeLike): string {
    for (const child of root.namedChildren) {
      if (child.type === 'namespace_definition') {
        return child.childForFieldName('name')?.text ?? '';
      }
    }
    return '';
  }

  /**
   * Supplement for the tree-sitter-cpp `extern "C"` grammar limitation: when
   * braces are split across #ifdef __cplusplus blocks tree-sitter may wrap the
   * outer block in an ERROR node. Query matching already descends into ERROR
   * subtrees on tree-sitter >=0.20, so this re-runs the mappers over each ERROR
   * subtree as a defensive fallback; parseCode() merges the results and dedupes
   * by (name, startLine).
   */
  private extractFromErrorNodes(root: SyntaxNodeLike, filePath: string): ErrorSupplement {
    const classes: RawClass[] = [];
    const enums: RawEnum[] = [];
    const functions: RawFunction[] = [];
    const visit = (node: SyntaxNodeLike): void => {
      if (node.type === 'ERROR') {
        // runQuery over the ERROR subtree already descends into nested ERROR
        // nodes, so process each ERROR once at its outermost level only.
        classes.push(...this.classMapper.runQuery(node, filePath));
        enums.push(...this.enumMapper.runQuery(node, filePath));
        functions.push(...this.funcMapper.runQuery(node, filePath));
        return;
      }
      for (const child of node.namedChildren) visit(child);
    };
    visit(root);
    return { classes, enums, functions };
  }
}

/** Merge query results with the ERROR-node supplement, deduping by name+startLine. */
function mergeUnique<T extends { name: string; startLine: number }>(
  primary: T[],
  supplement: T[]
): T[] {
  if (supplement.length === 0) return primary;
  const seen = new Set(primary.map((e) => `${e.name}:${e.startLine}`));
  const additions: T[] = [];
  for (const entity of supplement) {
    const key = `${entity.name}:${entity.startLine}`;
    if (!seen.has(key)) {
      seen.add(key);
      additions.push(entity);
    }
  }
  return [...primary, ...additions];
}
