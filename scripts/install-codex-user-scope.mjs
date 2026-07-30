#!/usr/bin/env node
/**
 * install-codex-user-scope.mjs — user-scope Codex MCP registration for
 * ArchGuard (TASK-36).
 *
 * Codex does not consume Claude plugin manifests, so its MCP configuration
 * must invoke an ArchGuard installation that owns its own runtime dependency
 * closure. This installer registers exactly one `[mcp_servers.archguard]`
 * table in the Codex user config (`$CODEX_HOME/config.toml`, defaulting to
 * `~/.codex/config.toml`) whose command launches the npm-installed
 * `@yalehwang/archguard` CLI entry (`node <install>/dist/cli/index.js mcp`).
 *
 * Properties:
 * - Idempotent and TOML-safe: re-running UPDATES the single archguard table in
 *   place (never duplicates it) and leaves unrelated top-level keys and other
 *   `[mcp_servers.*]` tables byte-for-byte intact.
 * - Never points into Claude's versioned plugin cache
 *   (`~/.claude/plugins/cache/**`) or at the source checkout; the entry must
 *   resolve to an npm-installed ArchGuard that owns its dependencies.
 * - Forwards the same `ARCHGUARD_PARSER_RUNTIME` (`auto|native|wasm`) policy
 *   supported by TASK-39 as an `env` value on the server table.
 *
 * Usage:
 *   scripts/install-codex-user-scope.sh [options]
 *
 * Options:
 *   --archguard-root <dir>   Package root (contains dist/cli/index.js) or a
 *                            node_modules-style root (contains
 *                            @yalehwang/archguard/dist/cli/index.js) to launch.
 *                            Default: the global npm install discovered via
 *                            `npm root -g` (or $ARCHGUARD_INSTALL_ROOT).
 *   --parser-runtime <r>     auto|native|wasm (default: auto).
 *   --arch-dir <dir>         Pass `--arch-dir <dir>` through to the server.
 *   --startup-timeout <sec>  startup_timeout_sec (default: 30).
 *   --tool-timeout <sec>     tool_timeout_sec (default: 120).
 *   --no-verify              Skip the optional `codex` CLI smoke check.
 *
 * Environment:
 *   CODEX_HOME  Overrides the Codex config directory (default: ~/.codex).
 *   HOME        Used to derive ~/.codex when CODEX_HOME is unset.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'archguard';
export const SECTION_KEY = 'mcp_servers.archguard';
export const CORE_PACKAGE = '@yalehwang/archguard';
export const CLI_SUBPATH = 'dist/cli/index.js';
export const PARSER_RUNTIME_VALUES = ['auto', 'native', 'wasm'];
export const DEFAULT_STARTUP_TIMEOUT_SEC = 30;
export const DEFAULT_TOOL_TIMEOUT_SEC = 120;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// TOML document model (line-preserving section editor)
// ---------------------------------------------------------------------------

/**
 * Normalize a table header's inner key. Strips surrounding whitespace and any
 * per-segment quotes so `mcp_servers.archguard`, ` mcp_servers.archguard `,
 * and `"mcp_servers"."archguard"` compare equal.
 */
export function normalizeKey(rawKey) {
  return String(rawKey)
    .trim()
    .split('.')
    .map((segment) => segment.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
    .join('.');
}

/**
 * Parse a TOML document into an ordered list of nodes that preserves every
 * unrelated line exactly:
 *   - { type: 'raw', line }                — preamble / inter-section lines
 *   - { type: 'section', key, headerLine, body: string[] }
 * Array-of-tables headers (`[[foo]]`) are kept as opaque raw boundaries so we
 * never misinterpret or rewrite them.
 */
export function parseDoc(text) {
  const lines = String(text ?? '').split('\n');
  const nodes = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const isArrayOfTables = /^\[\[[^\]]*\]\]/.test(trimmed);
    const headerMatch = !isArrayOfTables && /^\[([^\]]+)\]\s*(#.*)?$/.exec(trimmed);
    if (isArrayOfTables) {
      current = { type: 'section', key: `@@array@@:${trimmed}`, headerLine: line, body: [] };
      nodes.push(current);
    } else if (headerMatch) {
      current = { type: 'section', key: normalizeKey(headerMatch[1]), headerLine: line, body: [] };
      nodes.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      nodes.push({ type: 'raw', line });
    }
  }
  return nodes;
}

/** Serialize a node list back to text with a single trailing newline. */
export function serializeDoc(nodes) {
  const parts = [];
  for (const node of nodes) {
    if (node.type === 'raw') parts.push(node.line);
    else parts.push([node.headerLine, ...node.body].join('\n'));
  }
  const joined = parts.join('\n').replace(/\n+$/, '');
  return joined.length > 0 ? `${joined}\n` : '';
}

function isArchguardNode(node) {
  return (
    node.type === 'section' &&
    (node.key === SECTION_KEY || node.key.startsWith(`${SECTION_KEY}.`))
  );
}

function docHasContent(nodes) {
  return nodes.some((node) =>
    node.type === 'raw' ? node.line.trim().length > 0 : true
  );
}

function endsWithBlankLine(nodes) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const lastLine =
      node.type === 'raw'
        ? node.line
        : node.body.length > 0
          ? node.body[node.body.length - 1]
          : node.headerLine;
    if (lastLine.trim().length > 0) return false;
    // A trailing blank line counts only if there is some content before it.
    if (i > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// TOML value rendering / parsing (controlled shapes)
// ---------------------------------------------------------------------------

/** Render a JS string as a TOML basic string. */
export function tomlString(value) {
  return JSON.stringify(String(value));
}

function isBareKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

function formatKey(key) {
  return isBareKey(key) ? key : tomlString(key);
}

function tomlStringArray(values) {
  return `[${values.map((v) => tomlString(v)).join(', ')}]`;
}

/** Render the body lines (no header) for one archguard server entry. */
export function renderEntryLines(entry) {
  const lines = [];
  lines.push(`command = ${tomlString(entry.command)}`);
  lines.push(`args = ${tomlStringArray(entry.args ?? [])}`);
  if (entry.env && Object.keys(entry.env).length > 0) {
    const inner = Object.entries(entry.env)
      .map(([key, value]) => `${formatKey(key)} = ${tomlString(value)}`)
      .join(', ');
    lines.push(`env = { ${inner} }`);
  }
  if (entry.startupTimeoutSec != null) {
    lines.push(`startup_timeout_sec = ${Number(entry.startupTimeoutSec)}`);
  }
  if (entry.toolTimeoutSec != null) {
    lines.push(`tool_timeout_sec = ${Number(entry.toolTimeoutSec)}`);
  }
  if (entry.cwd) lines.push(`cwd = ${tomlString(entry.cwd)}`);
  return lines;
}

/** True when bracket/brace nesting is balanced and no string is left open. */
function isBalanced(text) {
  let depth = 0;
  let inString = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
  }
  return depth === 0 && inString === null;
}

/** Remove a trailing `# comment` that is not inside a string. */
function stripTrailingComment(text) {
  let inString = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '#') return text.slice(0, i);
  }
  return text;
}

function parseTomlString(text) {
  const trimmed = text.trim();
  const quote = trimmed[0];
  if (quote === '"') return JSON.parse(trimmed);
  if (quote === "'") return trimmed.slice(1, trimmed.lastIndexOf("'"));
  throw new Error(`not a TOML string: ${text}`);
}

/** Split on top-level commas (respecting nesting and strings). */
function splitTopLevel(text, delimiter) {
  const parts = [];
  let depth = 0;
  let inString = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Parse a TOML value: string, string array, inline table, number, boolean. */
export function parseTomlValue(raw) {
  const text = stripTrailingComment(raw).trim();
  if (text.length === 0) return undefined;
  const first = text[0];
  if (first === '"' || first === "'") return parseTomlString(text);
  if (first === '[') {
    const inner = text.slice(1, text.lastIndexOf(']'));
    return splitTopLevel(inner, ',').map((element) => parseTomlValue(element));
  }
  if (first === '{') {
    const inner = text.slice(1, text.lastIndexOf('}'));
    const obj = {};
    for (const pair of splitTopLevel(inner, ',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const key = normalizeKey(pair.slice(0, eq));
      obj[key] = parseTomlValue(pair.slice(eq + 1));
    }
    return obj;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  const num = Number(text);
  return Number.isNaN(num) ? text : num;
}

/**
 * Parse the top-level `key = value` pairs of one table body, joining values
 * that span multiple lines until their nesting balances.
 */
export function parseSectionKV(bodyText) {
  const lines = String(bodyText).split('\n');
  const result = {};
  let i = 0;
  while (i < lines.length) {
    const match = /^\s*([A-Za-z0-9_-]+|"[^"]*")\s*=\s*(.*)$/.exec(lines[i]);
    if (!match) {
      i += 1;
      continue;
    }
    const key = normalizeKey(match[1]);
    let valueText = match[2];
    while (!isBalanced(valueText) && i + 1 < lines.length) {
      i += 1;
      valueText += `\n${lines[i]}`;
    }
    const value = parseTomlValue(valueText);
    if (value !== undefined) result[key] = value;
    i += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Entry read / write
// ---------------------------------------------------------------------------

function kvToEntry(kv) {
  const entry = {};
  if ('command' in kv) entry.command = kv.command;
  if ('args' in kv) entry.args = kv.args;
  if ('env' in kv && kv.env && typeof kv.env === 'object') entry.env = kv.env;
  if ('startup_timeout_sec' in kv) entry.startupTimeoutSec = kv.startup_timeout_sec;
  if ('tool_timeout_sec' in kv) entry.toolTimeoutSec = kv.tool_timeout_sec;
  if ('cwd' in kv) entry.cwd = kv.cwd;
  return entry;
}

/**
 * Read the archguard server entry from a Codex config document. Merges a
 * `[mcp_servers.archguard.env]` subtable into `env` when that form is used.
 * Returns null when no archguard table is present.
 */
export function readArchguardEntry(text) {
  const nodes = parseDoc(text);
  const main = nodes.find((n) => n.type === 'section' && n.key === SECTION_KEY);
  if (!main) return null;
  const entry = kvToEntry(parseSectionKV(main.body.join('\n')));
  const envSubtable = nodes.find(
    (n) => n.type === 'section' && n.key === `${SECTION_KEY}.env`
  );
  if (envSubtable) {
    entry.env = { ...(entry.env ?? {}), ...parseSectionKV(envSubtable.body.join('\n')) };
  }
  return entry;
}

/** Count archguard server tables (main header only, not subtables). */
export function countArchguardSections(text) {
  return parseDoc(text).filter((n) => n.type === 'section' && n.key === SECTION_KEY).length;
}

/**
 * Idempotently ensure exactly one `[mcp_servers.archguard]` table carrying the
 * given entry. An existing table is updated in place; archguard subtables and
 * duplicate headers are removed; unrelated content is preserved. When absent,
 * a new table is appended with a separating blank line.
 */
export function upsertArchguardEntry(text, entry) {
  const nodes = parseDoc(text);
  const body = renderEntryLines(entry);
  const mainIdx = nodes.findIndex((n) => n.type === 'section' && n.key === SECTION_KEY);

  if (mainIdx >= 0) {
    nodes[mainIdx].body = [...body];
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (i !== mainIdx && isArchguardNode(nodes[i])) nodes.splice(i, 1);
    }
  } else {
    if (docHasContent(nodes)) {
      if (!endsWithBlankLine(nodes)) nodes.push({ type: 'raw', line: '' });
    } else {
      // Essentially-empty document: drop stray blank preamble lines so we do
      // not emit a leading blank line before the new table.
      nodes.length = 0;
    }
    nodes.push({ type: 'section', key: SECTION_KEY, headerLine: `[${SECTION_KEY}]`, body });
  }
  return serializeDoc(nodes);
}

/** Remove the archguard server table (and its subtables), preserving the rest. */
export function removeArchguardEntry(text) {
  const nodes = parseDoc(text).filter((n) => !isArchguardNode(n));
  return serializeDoc(nodes);
}

// ---------------------------------------------------------------------------
// Entry construction / target validation / resolution
// ---------------------------------------------------------------------------

/**
 * Build the archguard server entry. The server is always launched via
 * `node <cliEntry> mcp`; `parserRuntime` (when set) is forwarded as
 * `ARCHGUARD_PARSER_RUNTIME` in the server environment.
 */
export function buildEntry({
  cliEntry,
  parserRuntime,
  archDir,
  startupTimeoutSec = DEFAULT_STARTUP_TIMEOUT_SEC,
  toolTimeoutSec = DEFAULT_TOOL_TIMEOUT_SEC,
}) {
  const args = [cliEntry, 'mcp'];
  if (archDir) args.push('--arch-dir', archDir);
  const entry = { command: 'node', args };
  if (parserRuntime) {
    entry.env = { ARCHGUARD_PARSER_RUNTIME: parserRuntime };
  }
  if (startupTimeoutSec != null) entry.startupTimeoutSec = startupTimeoutSec;
  if (toolTimeoutSec != null) entry.toolTimeoutSec = toolTimeoutSec;
  return entry;
}

/**
 * Return the list of policy violations for a resolved CLI entry path. Empty
 * when the target is acceptable. The entry must never point into Claude's
 * versioned plugin cache or at the ArchGuard source checkout; it must be an
 * npm-installed ArchGuard that owns its dependency closure.
 */
export function validateEntryTarget(cliEntry, { repoRoot = REPO_ROOT, home } = {}) {
  const reasons = [];
  const resolved = path.resolve(cliEntry);
  const sep = path.sep;

  const cacheMarkers = [`${sep}.claude${sep}plugins${sep}cache${sep}`];
  if (home) {
    cacheMarkers.push(
      path.join(home, '.claude', 'plugins', 'cache') + sep
    );
  }
  if (cacheMarkers.some((marker) => resolved.includes(marker) || resolved.startsWith(marker))) {
    reasons.push(
      `entry points into Claude's versioned plugin cache: ${resolved} ` +
        '(Codex must launch an npm-installed ArchGuard, not the Claude plugin closure)'
    );
  }

  if (repoRoot && (resolved === repoRoot || resolved.startsWith(repoRoot + sep))) {
    reasons.push(
      `entry points at the ArchGuard source checkout: ${resolved} ` +
        '(Codex must launch an npm-installed ArchGuard, not the source checkout)'
    );
  }
  return reasons;
}

/** Resolve `<root>/dist/cli/index.js` across the supported root layouts. */
function entryFromRoot(root) {
  if (!root) return null;
  const candidates = [
    path.join(root, CLI_SUBPATH),
    path.join(root, CORE_PACKAGE, CLI_SUBPATH),
    path.join(root, 'node_modules', CORE_PACKAGE, CLI_SUBPATH),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

/**
 * Resolve the ArchGuard CLI entry to launch, in precedence order:
 *   1. explicit `archguardRoot`
 *   2. `ARCHGUARD_INSTALL_ROOT` environment variable
 *   3. the global npm root (`npmRoot()`, default `npm root -g`)
 * Throws when no installation provides `dist/cli/index.js`.
 */
export function resolveCliEntry({
  archguardRoot,
  env = process.env,
  npmRoot = () => execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(),
} = {}) {
  const sources = [
    archguardRoot ? { label: '--archguard-root', root: archguardRoot } : null,
    env.ARCHGUARD_INSTALL_ROOT
      ? { label: 'ARCHGUARD_INSTALL_ROOT', root: env.ARCHGUARD_INSTALL_ROOT }
      : null,
  ].filter(Boolean);

  for (const { label, root } of sources) {
    const entry = entryFromRoot(root);
    if (entry) return entry;
    throw new Error(
      `${label}=${root} does not contain ${CORE_PACKAGE}/${CLI_SUBPATH}; ` +
        'point it at an npm-installed ArchGuard package root or node_modules root'
    );
  }

  let globalRoot;
  try {
    globalRoot = npmRoot();
  } catch (error) {
    throw new Error(
      `could not determine the global npm root (${error.message}); ` +
        `install ArchGuard with \`npm install -g ${CORE_PACKAGE}\` or pass --archguard-root`
    );
  }
  const entry = entryFromRoot(globalRoot);
  if (entry) return entry;
  throw new Error(
    `${CORE_PACKAGE} is not installed at the global npm root (${globalRoot}); ` +
      `install it with \`npm install -g ${CORE_PACKAGE}\` or pass --archguard-root <dir>`
  );
}

/** Resolve the Codex config path, refusing to infer one from cwd. */
export function resolveConfigPath(env) {
  if (env.CODEX_HOME) return path.join(env.CODEX_HOME, 'config.toml');
  if (env.HOME) return path.join(env.HOME, '.codex', 'config.toml');
  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function commandExists(command) {
  const probe = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  return probe.status === 0 && Boolean(probe.stdout && probe.stdout.trim());
}

export function main(argv, env = process.env, io = { stdout: process.stdout, stderr: process.stderr }) {
  const log = (msg) => io.stdout.write(`[archguard-install] ${msg}\n`);
  const warn = (msg) => io.stderr.write(`[archguard-install] WARNING: ${msg}\n`);
  const fail = (msg) => {
    io.stderr.write(`[archguard-install] ERROR: ${msg}\n`);
    process.exitCode = 1;
  };

  const options = {
    archguardRoot: undefined,
    parserRuntime: 'auto',
    archDir: undefined,
    startupTimeoutSec: DEFAULT_STARTUP_TIMEOUT_SEC,
    toolTimeoutSec: DEFAULT_TOOL_TIMEOUT_SEC,
    verify: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const needsValue = (name) => {
      const value = argv[i + 1];
      if (!value) throw new Error(`${name} requires a value`);
      i += 1;
      return value;
    };
    try {
      if (arg === '--archguard-root') options.archguardRoot = needsValue(arg);
      else if (arg === '--parser-runtime') options.parserRuntime = needsValue(arg);
      else if (arg === '--arch-dir') options.archDir = needsValue(arg);
      else if (arg === '--startup-timeout') options.startupTimeoutSec = Number(needsValue(arg));
      else if (arg === '--tool-timeout') options.toolTimeoutSec = Number(needsValue(arg));
      else if (arg === '--no-verify') options.verify = false;
      else if (arg === '--help' || arg === '-h') {
        log('usage: install-codex-user-scope.sh [--archguard-root <dir>] [--parser-runtime auto|native|wasm]');
        return 0;
      } else {
        fail(`unknown argument: ${arg}`);
        return 1;
      }
    } catch (error) {
      fail(error.message);
      return 1;
    }
  }

  if (!PARSER_RUNTIME_VALUES.includes(options.parserRuntime)) {
    fail(
      `invalid --parser-runtime "${options.parserRuntime}" (expected one of: ` +
        `${PARSER_RUNTIME_VALUES.join(', ')})`
    );
    return 1;
  }

  const configPath = resolveConfigPath(env);
  if (!configPath) {
    fail('HOME or CODEX_HOME is required; refusing to infer a Codex config path from cwd');
    return 1;
  }

  let cliEntry;
  try {
    cliEntry = resolveCliEntry({ archguardRoot: options.archguardRoot, env });
  } catch (error) {
    fail(error.message);
    return 1;
  }

  const violations = validateEntryTarget(cliEntry, { repoRoot: REPO_ROOT, home: env.HOME });
  if (violations.length > 0) {
    for (const reason of violations) fail(reason);
    return 1;
  }

  const entry = buildEntry({
    cliEntry,
    parserRuntime: options.parserRuntime,
    archDir: options.archDir,
    startupTimeoutSec: options.startupTimeoutSec,
    toolTimeoutSec: options.toolTimeoutSec,
  });

  const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const after = upsertArchguardEntry(before, entry);

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, after);

  // Self-verify: re-read and confirm exactly one valid, non-forbidden entry.
  const written = readFileSync(configPath, 'utf8');
  const sections = countArchguardSections(written);
  if (sections !== 1) {
    fail(`expected exactly one [${SECTION_KEY}] table after install, found ${sections}`);
    return 1;
  }
  const readBack = readArchguardEntry(written);
  if (!readBack || readBack.command !== 'node' || !Array.isArray(readBack.args) ||
      path.resolve(readBack.args[0]) !== cliEntry) {
    fail(`verification failed: [${SECTION_KEY}] in ${configPath} does not launch ${cliEntry}`);
    return 1;
  }
  const readBackViolations = validateEntryTarget(readBack.args[0], {
    repoRoot: REPO_ROOT,
    home: env.HOME,
  });
  if (readBackViolations.length > 0) {
    for (const reason of readBackViolations) fail(reason);
    return 1;
  }

  log('done');
  log(`  config:  ${configPath}`);
  log(`  server:  [${SECTION_KEY}]`);
  log(`  command: node ${cliEntry} mcp`);
  log(`  runtime: ARCHGUARD_PARSER_RUNTIME=${options.parserRuntime}`);

  if (options.verify) {
    if (!commandExists('codex')) {
      warn('the `codex` CLI was not found on PATH; skipped the connection smoke check');
      warn(`verify manually by starting Codex and running /mcp (config: ${configPath})`);
    } else {
      try {
        const list = execFileSync('codex', ['mcp', 'list', '--json'], {
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        // Real codex may emit non-JSON warnings around the payload; isolate the
        // outermost JSON array before parsing.
        const start = list.indexOf('[');
        const end = list.lastIndexOf(']');
        const servers = start >= 0 && end > start ? JSON.parse(list.slice(start, end + 1)) : [];
        const match = Array.isArray(servers)
          ? servers.find((s) => s && s.name === SERVER_NAME)
          : undefined;
        if (!match) {
          warn('`codex mcp list` did not report the archguard server after registration');
        } else if (match.enabled === false) {
          warn('`codex mcp list` reports the archguard server as disabled');
        } else {
          log('  verify:  codex mcp list reports archguard (enabled)');
        }
      } catch (error) {
        warn(`codex connection smoke check failed: ${error.message}`);
      }
    }
  }
  return 0;
}

const isDirectRun = (() => {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return invoked === fileURLToPath(import.meta.url);
})();

if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}
