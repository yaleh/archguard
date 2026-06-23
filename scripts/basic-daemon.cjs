#!/usr/bin/env node
// daemon-version: v7
/**
 * basic-daemon.js — UNIFIED B″ poller. Polls backlog tasks dir and emits three
 * event channels to stdout:
 *
 *   basic-ready:TASK-N   kind:basic AND status "Basic: Ready"   → worker executes task
 *   epic-ready:TASK-N    kind:epic  AND status "Epic: Ready"    → worker auto-decomposes
 *   child-done:TASK-N    kind:basic AND status "Basic: Done" AND has parent_task_id
 *                                                               → worker re-checks parent epic
 *
 * Pure Node.js stdlib — no npm dependencies.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const BASIC_READY_STATUS = 'basic: ready';
const EPIC_READY_STATUS  = 'epic: ready';
const BASIC_DONE_STATUS  = 'basic: done';

function parseArgs(argv) {
  const args = { tasksDir: 'backlog/tasks', pidFile: 'backlog/.basic-daemon.pid', stopFile: 'backlog/.loop-stop', interval: 0.5 };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--tasks-dir':  args.tasksDir = argv[++i]; break;
      case '--pid-file':   args.pidFile  = argv[++i]; break;
      case '--stop-file':  args.stopFile = argv[++i]; break;
      case '--interval':   args.interval = parseFloat(argv[++i]); break;
    }
  }
  return args;
}

function parseTaskId(filename) {
  const base = path.basename(filename, path.extname(filename)).toUpperCase();
  for (const part of base.split(/\s+/)) {
    if (/^TASK-\d+(\.\d+)*$/.test(part)) return part;
  }
  const m = base.match(/\bTASK-(\d+(?:\.\d+)*)\b/);
  return m ? `TASK-${m[1]}` : null;
}

function readTaskMeta(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const m = content.match(/^---\n([\s\S]*?)^---/m);
    if (!m) return null;
    const fm = m[1];
    const statusMatch = fm.match(/^status:\s*(.+)$/m);
    const status = statusMatch ? statusMatch[1].trim().replace(/['"]/g, '').toLowerCase() : null;
    const parentMatch = content.match(/^parent_task_id:\s*(.+)$/m);
    const parent_task_id = parentMatch ? parentMatch[1].trim().toUpperCase() : null;
    let labels = [];
    const inlineLabels = fm.match(/^labels:\s*\[([^\]]*)\]/m);
    if (inlineLabels) {
      labels = inlineLabels[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    } else {
      const blockMatch = fm.match(/^labels:\s*\n((?:  - .+\n?)*)/m);
      if (blockMatch) {
        labels = blockMatch[1].split('\n').map(l => l.replace(/^\s+-\s+/, '').trim().replace(/['"]/g, '')).filter(Boolean);
      }
    }
    return { status, hasKindBasic: labels.includes('kind:basic'), hasKindEpic: labels.includes('kind:epic'), parent_task_id };
  } catch { }
  return null;
}

function isBasicReady(fp)  { const m = readTaskMeta(fp); return m && m.hasKindBasic && !m.hasKindEpic && m.status === BASIC_READY_STATUS; }
function isEpicReady(fp)   { const m = readTaskMeta(fp); return m && m.hasKindEpic  && !m.hasKindBasic && m.status === EPIC_READY_STATUS; }
function isChildDone(fp)   { const m = readTaskMeta(fp); return m && m.hasKindBasic && !m.hasKindEpic && m.status === BASIC_DONE_STATUS && !!m.parent_task_id; }

function scanIds(tasksDir, predicate) {
  const out = new Set();
  let entries;
  try { entries = fs.readdirSync(tasksDir); } catch { return out; }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const id = parseTaskId(entry);
    if (id && predicate(path.join(tasksDir, entry))) out.add(id);
  }
  return out;
}

function scanBasicReadyIds(tasksDir) { return scanIds(tasksDir, isBasicReady); }

const args       = parseArgs(process.argv);
const intervalMs = Math.round(args.interval * 1000);
const pidDir     = path.dirname(args.pidFile);
if (pidDir) fs.mkdirSync(pidDir, { recursive: true });
fs.writeFileSync(args.pidFile, String(process.pid));
function removePid() { try { fs.unlinkSync(args.pidFile); } catch { } }
process.on('exit', removePid);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));

const channels = [
  { prefix: 'basic-ready', predicate: isBasicReady, notified: new Set() },
  { prefix: 'epic-ready',  predicate: isEpicReady,  notified: new Set() },
  { prefix: 'child-done',  predicate: isChildDone,  notified: new Set() },
];

const timer = setInterval(() => {
  if (fs.existsSync(args.stopFile)) { clearInterval(timer); process.exit(0); }
  for (const ch of channels) {
    const ids = scanIds(args.tasksDir, ch.predicate);
    for (const id of ch.notified) { if (!ids.has(id)) ch.notified.delete(id); }
    for (const id of [...ids].filter(id => !ch.notified.has(id)).sort()) {
      process.stdout.write(`${ch.prefix}:${id}\n`);
      ch.notified.add(id);
    }
  }
}, intervalMs);
