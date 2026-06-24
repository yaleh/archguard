#!/usr/bin/env tsx
/**
 * check-adr.ts — Mechanical compliance checker for ADR-006 and ADR-007.
 *
 * ADR-006: MCP tool descriptions must NOT start with "Get " (case-insensitive).
 * ADR-007: Every MCP tool must have a corresponding CLI flag in query.ts.
 *
 * Suppression: add `// adr-ok: ADR-NNN — <reason>` in the 3 lines before the violation.
 *
 * Usage: tsx scripts/check-adr.ts
 *   or:  npm run check:adr
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Violation {
  adr: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
}

// ---------------------------------------------------------------------------
// File scanning utilities
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .ts files under a directory.
 */
export function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract all `description` string literals from a source file.
 * Matches patterns like:
 *   'description', "..."
 *   'description',\n  "..."
 *   description: "..."
 * Returns { text, line } pairs (1-indexed line number of the string).
 */
export function extractDescriptions(filePath: string): Array<{ text: string; line: number }> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: Array<{ text: string; line: number }> = [];

  // Match: 'description',  <quote>text<quote>
  // The description string may start on the same line or the next line.
  const TOOL_DESC_RE = /^\s*(?:'description'|"description")\s*,\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")\s*$/;
  // Match: description: <quote>text<quote>   (parameter description)
  const PARAM_DESC_RE = /\.describe\(\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")\s*\)/g;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Check for server.tool description argument (second arg, after tool name)
    const m = TOOL_DESC_RE.exec(line);
    if (m) {
      const text = m[1] ?? m[2] ?? '';
      results.push({ text, line: lineNum });
    }

    // Also handle multi-line: 'description', followed by string on next line
    if (/^\s*(?:'description'|"description")\s*,\s*$/.test(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nm = /^\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")\s*$/.exec(nextLine);
      if (nm) {
        const text = nm[1] ?? nm[2] ?? '';
        results.push({ text, line: i + 2 }); // +2 for 1-indexed next line
      }
    }
  }

  return results;
}

/**
 * Extract MCP tool descriptions for ADR-006 checking.
 * Looks for server.tool( calls and captures the description string (2nd argument).
 *
 * Pattern in files:
 *   server.tool(
 *     'archguard_tool_name',
 *     'Description here...',
 *     ...
 *   )
 */
export function extractToolDescriptions(
  filePath: string
): Array<{ text: string; line: number; toolName: string }> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: Array<{ text: string; line: number; toolName: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for server.tool( call
    if (!/server\.tool\(/.test(line)) continue;

    // Find tool name on next line
    let toolName = '';
    let descLine = -1;
    let descText = '';

    // Search the next few lines for tool name and description
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const trimmed = lines[j].trim();
      const nameMatch = /^'(archguard_[^']+)'/.exec(trimmed) ?? /^"(archguard_[^"]+)"/.exec(trimmed);
      if (nameMatch) {
        toolName = nameMatch[1];

        // Description is on the next line(s) after the name
        for (let k = j + 1; k < Math.min(j + 5, lines.length); k++) {
          const descTrimmed = lines[k].trim();
          // Single-quote or double-quote string
          const singleMatch = /^'((?:[^'\\]|\\.)*)'/.exec(descTrimmed);
          const doubleMatch = /^"((?:[^"\\]|\\.)*)"/.exec(descTrimmed);
          const templateMatch = /^`((?:[^`\\]|\\.)*)`,?$/.exec(descTrimmed);
          if (singleMatch) {
            descText = singleMatch[1];
            descLine = k + 1; // 1-indexed
            break;
          } else if (doubleMatch) {
            descText = doubleMatch[1];
            descLine = k + 1;
            break;
          } else if (templateMatch) {
            descText = templateMatch[1];
            descLine = k + 1;
            break;
          } else if (descTrimmed === '' || descTrimmed.startsWith('//')) {
            // skip blank lines/comments
            continue;
          } else {
            // Not a string literal — stop searching
            break;
          }
        }
        break;
      }
    }

    if (toolName && descLine >= 0) {
      results.push({ text: descText, line: descLine, toolName });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Suppression support
// ---------------------------------------------------------------------------

/**
 * Check if there's a valid suppression annotation for a violation.
 *
 * Valid suppression format: `// adr-ok: ADR-NNN — <reason>`
 * The annotation must:
 *   1. Appear in the 3 lines before the violation line
 *   2. Reference the correct ADR number
 *   3. Have a reason after the em-dash (—)
 *
 * @param v - The violation to check
 * @param fileLines - All lines of the file (0-indexed)
 */
export function hasSuppression(v: Violation, fileLines: string[]): boolean {
  const violationIdx = v.line - 1; // convert to 0-indexed
  const start = Math.max(0, violationIdx - 3);

  // Pattern: // adr-ok: ADR-NNN — reason
  // The em-dash (—) separates the ADR number from the reason.
  // The reason must be non-empty (at least one non-whitespace char after the dash).
  const suppressionRe = /\/\/\s*adr-ok:\s*(ADR-\d+)\s*—\s*(\S.*)/i;

  for (let i = start; i < violationIdx; i++) {
    const line = fileLines[i];
    const m = suppressionRe.exec(line);
    if (m) {
      const adrRef = m[1].toUpperCase();
      const reason = m[2].trim();
      if (adrRef === v.adr.toUpperCase() && reason.length > 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter out suppressed violations from the list.
 */
export function filterViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => {
    const fileLines = fs.readFileSync(v.file, 'utf-8').split('\n');
    return !hasSuppression(v, fileLines);
  });
}

// ---------------------------------------------------------------------------
// ADR-006: Tool descriptions must not start with "Get "
// ---------------------------------------------------------------------------

/**
 * Check all MCP tool descriptions for ADR-006 compliance.
 * Descriptions must NOT start with "Get " (case-insensitive).
 *
 * @param mcpDir - Directory to scan (default: src/cli/mcp)
 */
export function checkAdr006(mcpDir?: string): Violation[] {
  const dir = mcpDir ?? path.join(process.cwd(), 'src', 'cli', 'mcp');
  const files = collectTsFiles(dir);
  const violations: Violation[] = [];

  for (const file of files) {
    const descriptions = extractToolDescriptions(file);
    for (const { text, line } of descriptions) {
      if (/^get\s/i.test(text)) {
        violations.push({
          adr: 'ADR-006',
          file,
          line,
          message: `Tool description starts with "Get" (violates ADR-006 §2.1 verb-first rule)`,
          evidence: text.slice(0, 80) + (text.length > 80 ? '...' : ''),
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// ADR-007: CLI/MCP parity
// ---------------------------------------------------------------------------

/**
 * Extract MCP tool names from all .ts files in mcpDir.
 * Scans for server.tool( calls.
 */
export function extractMcpToolNames(mcpDir?: string): string[] {
  const dir = mcpDir ?? path.join(process.cwd(), 'src', 'cli', 'mcp');
  const files = collectTsFiles(dir);
  const tools: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    // Match server.tool( followed by the tool name
    const re = /server\.tool\(\s*['"](\w+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      tools.push(m[1]);
    }
  }

  return tools;
}

/**
 * Extract CLI flags from query.ts (or similar).
 * Scans for .option('--flag...' patterns.
 */
export function extractCliFlags(queryFile?: string): string[] {
  const file =
    queryFile ?? path.join(process.cwd(), 'src', 'cli', 'commands', 'query.ts');
  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf-8');
  const flags: string[] = [];

  // Match .option('--flag-name ...' or .option("--flag-name ..."
  const re = /\.option\(\s*['"](--([\w-]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    flags.push(m[1]); // e.g. --entity, --deps-of
  }

  return flags;
}

/**
 * Convert an MCP tool name or CLI flag to a canonical form for comparison.
 *
 * Examples:
 *   'archguard_get_atlas_layer' → 'atlas-layer'  (strip archguard_ prefix + verb + replace _ with -)
 *   '--atlas-layer'             → 'atlas-layer'  (strip --)
 *
 * For MCP tools, the canonical form is: strip 'archguard_' prefix, strip leading verb,
 * replace remaining underscores with hyphens, lowercase.
 *
 * Verbs stripped: get, find, detect, analyze, create, update, list, show
 */
export function toCanonical(nameOrFlag: string): string {
  const VERBS = ['get', 'find', 'detect', 'analyze', 'create', 'update', 'list', 'show'];

  if (nameOrFlag.startsWith('--')) {
    return nameOrFlag.slice(2).toLowerCase();
  }

  // MCP tool name: archguard_{verb}_{resource}
  let s = nameOrFlag.toLowerCase();
  if (s.startsWith('archguard_')) {
    s = s.slice('archguard_'.length);
  }

  // Strip leading verb
  for (const verb of VERBS) {
    if (s.startsWith(verb + '_')) {
      s = s.slice(verb.length + 1);
      break;
    }
  }

  return s.replace(/_/g, '-');
}

/**
 * Build a set of canonical forms from CLI flags (including singular/plural variants).
 */
function buildCliCanonicals(flags: string[]): Set<string> {
  const set = new Set<string>();
  for (const flag of flags) {
    const c = toCanonical(flag);
    set.add(c);
    // Add singular/plural variants
    if (c.endsWith('s')) set.add(c.slice(0, -1)); // packages → package
    else set.add(c + 's'); // package → packages
  }
  return set;
}

/**
 * Known semantic aliases where MCP tool name and CLI flag use different wording.
 * Format: MCP tool canonical → set of CLI flag canonicals that count as a match.
 *
 * These are documented in ADR-007 §4 parity table and represent cases where
 * CLI flag names predate the MCP naming convention.
 */
const KNOWN_ADR007_ALIASES: Record<string, string[]> = {
  // archguard_get_dependencies (canonical: 'dependencies') → --deps-of (canonical: 'deps-of')
  'dependencies': ['deps-of'],
  // archguard_get_dependents (canonical: 'dependents') → --used-by (canonical: 'used-by')
  'dependents': ['used-by'],
  // archguard_find_implementers (canonical: 'implementers') → --implementers-of (canonical: 'implementers-of')
  'implementers': ['implementers-of'],
  // archguard_find_subclasses (canonical: 'subclasses') → --subclasses-of (canonical: 'subclasses-of')
  'subclasses': ['subclasses-of'],
  // archguard_get_file_entities (canonical: 'file-entities') → --file (canonical: 'file')
  'file-entities': ['file'],
};

/**
 * Check ADR-007: every MCP tool must have a corresponding CLI flag.
 *
 * Matching strategy:
 * 1. Direct canonical match: toCanonical(tool) === toCanonical(flag)
 * 2. Plural variant match: canonical + 's' or canonical - 's'
 * 3. Known alias: check KNOWN_ADR007_ALIASES table (for documented semantic divergence)
 * 4. Suppression: // adr-ok: ADR-007 — reason (for agent-only tools with no CLI use case)
 *
 * @param mcpDir - MCP directory (default: src/cli/mcp)
 * @param queryFile - CLI query command file (default: src/cli/commands/query.ts)
 */
export function checkAdr007(mcpDir?: string, queryFile?: string): Violation[] {
  const dir = mcpDir ?? path.join(process.cwd(), 'src', 'cli', 'mcp');
  const qFile =
    queryFile ?? path.join(process.cwd(), 'src', 'cli', 'commands', 'query.ts');

  const mcpTools = extractMcpToolNames(dir);
  const cliFlags = extractCliFlags(qFile);
  const cliCanonicals = buildCliCanonicals(cliFlags);
  const violations: Violation[] = [];

  // Exclusions: tools that map to top-level CLI sub-commands (not query flags).
  // Write/trigger operations correspond to `archguard analyze` and `archguard analyze-git`
  // subcommands, not --flags on `archguard query`.
  const CLI_SUBCOMMAND_TOOLS = new Set(['archguard_analyze', 'archguard_analyze_git']);

  for (const tool of mcpTools) {
    if (CLI_SUBCOMMAND_TOOLS.has(tool)) continue;

    const canonical = toCanonical(tool);

    // Check direct match (canonical matching handles plural variants via buildCliCanonicals)
    if (cliCanonicals.has(canonical)) continue;

    // Check known aliases
    const aliases = KNOWN_ADR007_ALIASES[canonical] ?? [];
    if (aliases.some((alias) => cliCanonicals.has(alias) || cliFlags.some((f) => toCanonical(f) === alias))) {
      continue;
    }

    // Find the file where this tool is defined for the violation report
    const files = collectTsFiles(dir);
    let toolFile = files[0] ?? path.join(dir, 'mcp-server.ts');
    let toolLine = 1;

    outer: for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        // Match tool name as a standalone string literal on the line
        if (trimmed === `'${tool}',` || trimmed === `"${tool}",` ||
            trimmed === `'${tool}'` || trimmed === `"${tool}"`) {
          toolFile = file;
          toolLine = i + 1; // 1-indexed
          break outer;
        }
        // Also match inline: server.tool('toolname', ...
        if (lines[i].includes(`server.tool(`) && lines[i].includes(`'${tool}'`)) {
          toolFile = file;
          toolLine = i + 1;
          break outer;
        }
      }
    }

    violations.push({
      adr: 'ADR-007',
      file: toolFile,
      line: toolLine,
      message: `MCP tool "${tool}" has no matching CLI flag in query.ts (canonical: "${canonical}")`,
      evidence: tool,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printViolation(v: Violation, idx: number): void {
  console.error(`  [${idx + 1}] ${v.adr} violation at ${path.relative(process.cwd(), v.file)}:${v.line}`);
  console.error(`      ${v.message}`);
  console.error(`      Evidence: "${v.evidence}"`);
}

export async function main(): Promise<void> {
  console.log('ArchGuard ADR Compliance Checker');
  console.log('=================================');

  const adr006Raw = checkAdr006();
  const adr007Raw = checkAdr007();

  const adr006 = filterViolations(adr006Raw);
  const adr007 = filterViolations(adr007Raw);

  const total = adr006.length + adr007.length;

  if (adr006.length > 0) {
    console.error(`\nADR-006 violations (${adr006.length}):`);
    adr006.forEach((v, i) => printViolation(v, i));
  } else {
    console.log('\nADR-006: OK — all tool descriptions pass verb-first check');
  }

  if (adr007.length > 0) {
    console.error(`\nADR-007 violations (${adr007.length}):`);
    adr007.forEach((v, i) => printViolation(v, i));
  } else {
    console.log('ADR-007: OK — all MCP tools have matching CLI flags');
  }

  if (total > 0) {
    console.error(
      `\n${total} ADR violation(s) found. Fix or add suppression annotation:\n` +
        `  // adr-ok: ADR-NNN — <reason>`
    );
    process.exit(1);
  } else {
    console.log('\nAll ADR checks passed.');
    process.exit(0);
  }
}

// Run when invoked directly (not when imported for tests)
if (process.argv[1] && (process.argv[1].endsWith('check-adr.ts') || process.argv[1].endsWith('check-adr.js'))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
