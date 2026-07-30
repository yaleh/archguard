#!/usr/bin/env node
/**
 * fake-codex.mjs — stateful stand-in for the `codex` CLI used by
 * tests/integration/installer-codex-user-scope.test.ts.
 *
 * Simulates the `codex mcp` read surface that
 * scripts/install-codex-user-scope.mjs smoke-checks, reading its state from
 * the live Codex config (`$CODEX_HOME/config.toml`, defaulting to
 * `$HOME/.codex/config.toml`) — the config file IS the state, exactly as for
 * the real codex. Every invocation is appended as a JSON line to
 * $FAKE_CODEX_LOG for assertions.
 *
 * The `[mcp_servers.*]` parser here is deliberately independent of the
 * installer's own TOML editor, so tests cross-check that what the installer
 * wrote is readable by a second implementation (mirroring how the real codex
 * parses it).
 *
 * JSON output shape mirrors codex-cli 0.146.0 `codex mcp list --json`:
 *   [{ name, enabled, disabled_reason, transport: { type, command, args,
 *      env, env_vars, cwd }, startup_timeout_sec, tool_timeout_sec,
 *      auth_status }]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.FAKE_CODEX_LOG) {
  appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function configPath() {
  if (process.env.CODEX_HOME) return path.join(process.env.CODEX_HOME, 'config.toml');
  if (process.env.HOME) return path.join(process.env.HOME, '.codex', 'config.toml');
  return null;
}

// --- Minimal, independent TOML reader for [mcp_servers.*] tables -----------

function balanced(text) {
  let depth = 0;
  let str = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (str) {
      if (c === '\\') i += 1;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") str = c;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
  }
  return depth === 0 && str === null;
}

function dropComment(text) {
  let str = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (str) {
      if (c === '\\') i += 1;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") str = c;
    else if (c === '#') return text.slice(0, i);
  }
  return text;
}

function parseString(text) {
  const t = text.trim();
  if (t[0] === '"') return JSON.parse(t);
  if (t[0] === "'") return t.slice(1, t.lastIndexOf("'"));
  return t;
}

function splitTop(text, delim) {
  const out = [];
  let depth = 0;
  let str = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (str) {
      if (c === '\\') i += 1;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") str = c;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
    else if (c === delim && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseValue(raw) {
  const t = dropComment(raw).trim();
  if (!t) return undefined;
  if (t[0] === '"' || t[0] === "'") return parseString(t);
  if (t[0] === '[') return splitTop(t.slice(1, t.lastIndexOf(']')), ',').map(parseValue);
  if (t[0] === '{') {
    const obj = {};
    for (const pair of splitTop(t.slice(1, t.lastIndexOf('}')), ',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      obj[pair.slice(0, eq).trim().replace(/^"|"$/g, '')] = parseValue(pair.slice(eq + 1));
    }
    return obj;
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  return Number.isNaN(n) ? t : n;
}

/** Parse the config into { servers: { name: {command,args,env,...} }, order }. */
function readServers(text) {
  const lines = String(text ?? '').split('\n');
  const servers = {};
  const order = [];
  let current = null;
  let buffer = [];
  const flush = () => {
    if (!current) return;
    let i = 0;
    while (i < buffer.length) {
      const m = /^\s*([A-Za-z0-9_-]+|"[^"]*")\s*=\s*(.*)$/.exec(buffer[i]);
      if (!m) {
        i += 1;
        continue;
      }
      const key = m[1].replace(/^"|"$/g, '');
      let value = m[2];
      while (!balanced(value) && i + 1 < buffer.length) {
        i += 1;
        value += `\n${buffer[i]}`;
      }
      const parsed = parseValue(value);
      if (parsed !== undefined) servers[current][key] = parsed;
      i += 1;
    }
    buffer = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const header = /^\[([^\]]+)\]\s*(#.*)?$/.exec(trimmed);
    if (header && !trimmed.startsWith('[[')) {
      flush();
      const key = header[1]
        .trim()
        .split('.')
        .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
        .join('.');
      const mcp = /^mcp_servers\.(.+)$/.exec(key);
      if (mcp && !key.slice('mcp_servers.'.length).includes('.')) {
        current = mcp[1];
        if (!servers[current]) {
          servers[current] = {};
          order.push(current);
        }
      } else {
        current = null;
      }
    } else if (current) {
      buffer.push(line);
    }
  }
  flush();
  return { servers, order };
}

function serverToJson(name, cfg) {
  return {
    name,
    enabled: cfg.enabled !== false,
    disabled_reason: cfg.enabled === false ? 'manually disabled' : null,
    transport: {
      type: cfg.url ? 'streamable_http' : 'stdio',
      command: cfg.command ?? null,
      args: Array.isArray(cfg.args) ? cfg.args : [],
      env: cfg.env && typeof cfg.env === 'object' ? cfg.env : null,
      env_vars: Array.isArray(cfg.env_vars) ? cfg.env_vars : [],
      cwd: cfg.cwd ?? null,
    },
    startup_timeout_sec: cfg.startup_timeout_sec ?? null,
    tool_timeout_sec: cfg.tool_timeout_sec ?? null,
    auth_status: 'unsupported',
  };
}

// --- Command dispatch ------------------------------------------------------

const args = process.argv.slice(2);
const wantJson = args.includes('--json');

if (args[0] === '--version' || args[0] === '-V') {
  console.log('codex-cli 0.146.0 (fake-codex)');
} else if (args[0] === 'mcp' && args[1] === 'list') {
  const cfg = configPath();
  const { servers, order } = cfg && existsSync(cfg) ? readServers(readFileSync(cfg, 'utf8')) : { servers: {}, order: [] };
  if (wantJson) {
    console.log(JSON.stringify(order.map((name) => serverToJson(name, servers[name])), null, 2));
  } else if (order.length === 0) {
    console.log('No MCP servers configured.');
  } else {
    for (const name of order) {
      const s = servers[name];
      console.log(`${name} (${s.command ?? s.url ?? 'unknown'})`);
    }
  }
} else if (args[0] === 'mcp' && args[1] === 'get') {
  const name = args[2];
  const cfg = configPath();
  const { servers } = cfg && existsSync(cfg) ? readServers(readFileSync(cfg, 'utf8')) : { servers: {} };
  if (!name || !servers[name]) fail(`no MCP server named '${name}'`);
  console.log(JSON.stringify(serverToJson(name, servers[name]), null, 2));
} else {
  fail(`fake-codex: unsupported command: ${args.join(' ')}`);
}
