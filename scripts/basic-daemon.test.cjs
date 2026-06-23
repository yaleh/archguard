#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

function parseTaskId(filename) {
  const base = path.basename(filename, path.extname(filename)).toUpperCase();
  for (const part of base.split(/\s+/)) { if (/^TASK-\d+(\.\d+)*$/.test(part)) return part; }
  const m = base.match(/\bTASK-(\d+(?:\.\d+)*)\b/); return m ? `TASK-${m[1]}` : null;
}
function isBasicReady(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const m = content.match(/^---\n([\s\S]*?)^---/m); if (!m) return false;
    const fm = m[1];
    const statusMatch = fm.match(/^status:\s*(.+)$/m);
    const status = statusMatch ? statusMatch[1].trim().toLowerCase() : null;
    if (status !== 'basic: ready') return false;
    const inlineLabels = fm.match(/^labels:\s*\[([^\]]*)\]/m);
    if (inlineLabels) { const labels = inlineLabels[1].split(',').map(s => s.trim().replace(/['"]/g,'')).filter(Boolean); return labels.includes('kind:basic') && !labels.includes('kind:epic'); }
  } catch { } return false;
}
function scanBasicReadyIds(tasksDir) {
  const ready = new Set(); let entries;
  try { entries = fs.readdirSync(tasksDir); } catch { return ready; }
  for (const entry of entries) { if (!entry.endsWith('.md')) continue; const id = parseTaskId(entry); if (id && isBasicReady(path.join(tasksDir, entry))) ready.add(id); }
  return ready;
}

let passed = 0, failed = 0;
function assert(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { process.stdout.write(`  ✓ ${desc}\n`); passed++; }
  else { process.stderr.write(`  ✗ ${desc}\n    expected: ${JSON.stringify(expected)}\n    got: ${JSON.stringify(actual)}\n`); failed++; }
}

process.stdout.write('parseTaskId\n');
assert('simple prefix', parseTaskId('task-3 - do something.md'), 'TASK-3');
assert('upper already', parseTaskId('TASK-10 - title.md'), 'TASK-10');
assert('no id returns null', parseTaskId('README.md'), null);
assert('multi-digit', parseTaskId('task-42 - long title here.md'), 'TASK-42');

process.stdout.write('isBasicReady\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-test-'));
const f1 = path.join(tmp, 'ready.md'); fs.writeFileSync(f1, '---\nstatus: Basic: Ready\nlabels: [kind:basic]\n---\n');
assert('basic ready', isBasicReady(f1), true);
const f2 = path.join(tmp, 'epic.md'); fs.writeFileSync(f2, '---\nstatus: Basic: Ready\nlabels: [kind:basic, kind:epic]\n---\n');
assert('kind:epic excluded', isBasicReady(f2), false);

process.stdout.write('scanBasicReadyIds\n');
const dir = path.join(tmp, 'tasks'); fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,'task-1 - a.md'), '---\nstatus: Basic: Ready\nlabels: [kind:basic]\n---\n');
fs.writeFileSync(path.join(dir,'task-2 - b.md'), '---\nstatus: Basic: Done\nlabels: [kind:basic]\n---\n');
fs.writeFileSync(path.join(dir,'task-3 - c.md'), '---\nstatus: Basic: Ready\nlabels: [kind:basic]\n---\n');
const ids = scanBasicReadyIds(dir);
assert('finds ready tasks', [...ids].sort(), ['TASK-1','TASK-3']);
assert('skips done tasks', ids.has('TASK-2'), false);

fs.rmSync(tmp, { recursive: true });
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
