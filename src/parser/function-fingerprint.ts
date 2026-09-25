/**
 * Function fingerprinting — normalized structural hash of every function body.
 *
 * Independent of FunctionExtractor / the Entity model: this pass only parses syntax (no type
 * resolution) and covers function declarations, arrow functions, function expressions, class and
 * object-literal methods, constructors, accessors and nested functions — exported or not.
 *
 * Normalization (Type-1/2 clones):
 *  - locally declared names (parameters, variables, nested function names, catch variables) are
 *    numbered by first occurrence, so renaming them does not change the hash;
 *  - string/number/regex/bigint/template literals collapse to a per-type placeholder;
 *  - comments, whitespace and type annotations do not take part;
 *  - called function names and property names are KEPT — they carry the semantics.
 */

import { createHash } from 'crypto';
import { ts } from 'ts-morph';

export type FunctionFingerprintKind =
  | 'function'
  | 'arrow'
  | 'function-expression'
  | 'method'
  | 'constructor'
  | 'accessor';

export interface FunctionFingerprint {
  /** Truncated SHA-256 of the normalized token stream. */
  hash: string;
  /** Number of tokens in the normalized stream. */
  tokenCount: number;
  /** Number of statements in the body, nested ones included (expression-bodied arrow = 1). */
  statementCount: number;
  name: string;
  kind: FunctionFingerprintKind;
  file: string;
  startLine: number;
  endLine: number;
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

const STATEMENT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.WithStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.DebuggerStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
]);

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function kindOf(fn: FunctionLike): FunctionFingerprintKind {
  if (ts.isFunctionDeclaration(fn)) return 'function';
  if (ts.isArrowFunction(fn)) return 'arrow';
  if (ts.isFunctionExpression(fn)) return 'function-expression';
  if (ts.isMethodDeclaration(fn)) return 'method';
  if (ts.isConstructorDeclaration(fn)) return 'constructor';
  return 'accessor';
}

function nameOf(fn: FunctionLike): string {
  if (ts.isConstructorDeclaration(fn)) return 'constructor';
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    if (ts.isFunctionExpression(fn) && fn.name) return fn.name.text;
    const parent = fn.parent;
    if (
      (ts.isVariableDeclaration(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isPropertyDeclaration(parent)) &&
      parent.name
    ) {
      return parent.name.getText();
    }
    return '<anonymous>';
  }
  return fn.name ? fn.name.getText() : 'default';
}

/** Collect identifiers bound inside `fn`: parameters, variables, nested function names, catch vars. */
function collectLocalNames(fn: FunctionLike): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) addBinding(el.name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) addBinding(node.name);
    else if (ts.isFunctionDeclaration(node) && node.name && node !== fn) names.add(node.name.text);
    else if (ts.isFunctionExpression(node) && node.name && node !== fn) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return names;
}

/** True when `id` sits in a position where it names a property/member rather than a variable. */
function isPropertyNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p)) return p.name === id;
  if (ts.isQualifiedName(p)) return p.right === id;
  if (
    ts.isPropertyAssignment(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isEnumMember(p)
  ) {
    return p.name === id;
  }
  if (ts.isBindingElement(p)) return p.propertyName === id;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  return false;
}

interface NormalizedBody {
  tokens: string[];
  statementCount: number;
}

function normalize(fn: FunctionLike): NormalizedBody {
  const locals = collectLocalNames(fn);
  const numbering = new Map<string, number>();
  const tokens: string[] = [];
  let statementCount = 0;

  const emit = (node: ts.Node): void => {
    // Type annotations are not part of the structural fingerprint.
    if (ts.isTypeNode(node) && node.kind !== ts.SyntaxKind.ExpressionWithTypeArguments) return;
    if (STATEMENT_KINDS.has(node.kind)) statementCount++;

    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        tokens.push('Str');
        return;
      case ts.SyntaxKind.NumericLiteral:
        tokens.push('Num');
        return;
      case ts.SyntaxKind.BigIntLiteral:
        tokens.push('BigInt');
        return;
      case ts.SyntaxKind.RegularExpressionLiteral:
        tokens.push('Regex');
        return;
      default:
    }

    if (ts.isIdentifier(node)) {
      if (locals.has(node.text) && !isPropertyNamePosition(node)) {
        let n = numbering.get(node.text);
        if (n === undefined) {
          n = numbering.size;
          numbering.set(node.text, n);
        }
        tokens.push(`$${n}`);
      } else {
        tokens.push(`Id:${node.text}`);
      }
      return;
    }

    let label = ts.SyntaxKind[node.kind];
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      label += `:${ts.SyntaxKind[node.operator]}`;
    } else if (ts.isVariableDeclarationList(node)) {
      label +=
        node.flags & ts.NodeFlags.Const
          ? ':const'
          : node.flags & ts.NodeFlags.Let
            ? ':let'
            : ':var';
    } else if (ts.isShorthandPropertyAssignment(node)) {
      // `{ a }` keeps the key text even when `a` is a renamed local.
      tokens.push(`Shorthand:${node.name.text}`);
    }
    tokens.push(label);
    ts.forEachChild(node, emit);
    tokens.push(')');
  };

  // Parameters + body; the function's own name is deliberately not part of the fingerprint.
  const emitChildren = (node: ts.Node | undefined): void => {
    if (node) emit(node);
  };
  tokens.push(kindOf(fn));
  for (const p of fn.parameters) emitChildren(p);
  const modifiers = ts.canHaveModifiers(fn) ? ts.getModifiers(fn) : undefined;
  for (const m of modifiers ?? []) {
    if (m.kind === ts.SyntaxKind.AsyncKeyword) tokens.push('async');
  }
  if ('asteriskToken' in fn && fn.asteriskToken) tokens.push('*');
  if (fn.body) {
    if (!ts.isBlock(fn.body)) statementCount++; // expression-bodied arrow
    emit(fn.body);
  }

  return { tokens, statementCount };
}

/**
 * Fingerprint every function that has a body in `sourceText`.
 *
 * @param sourceText - file contents
 * @param relativeFilePath - path recorded on each fingerprint (also selects TS vs TSX parsing)
 */
export function fingerprintSourceText(
  sourceText: string,
  relativeFilePath: string
): FunctionFingerprint[] {
  const sf = ts.createSourceFile(relativeFilePath, sourceText, ts.ScriptTarget.Latest, true);
  const out: FunctionFingerprint[] = [];

  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body) {
      const { tokens, statementCount } = normalize(node);
      out.push({
        hash: hashTokens(tokens),
        tokenCount: tokens.length,
        statementCount,
        name: nameOf(node),
        kind: kindOf(node),
        file: relativeFilePath,
        startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function hashTokens(tokens: string[]): string {
  return createHash('sha256').update(tokens.join(' ')).digest('hex').slice(0, 16);
}
