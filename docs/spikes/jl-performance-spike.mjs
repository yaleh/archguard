#!/usr/bin/env node
/**
 * JL intrinsic-dimension performance spike (TASK-64, Phase A).
 *
 * Benchmarks ml-matrix SVD on the four matrix shapes the JL pipeline uses:
 *
 *   | size          | scenario                      | gate    |
 *   |---------------|-------------------------------|---------|
 *   | 300×300       | ArchGuard itself, DIRECT mode | < 200ms |
 *   | 1000×307      | mid project, JL mode          | < 500ms |
 *   | 5000×378      | llama.cpp, JL mode            | < 2000ms |
 *   | 5000×5000     | control (DIRECT at scale)     | n/a     |
 *
 * The control runs in a child process bounded to 60s so the spike stays
 * practical on slow machines; it never fails the spike (informational only).
 *
 * Exit code: 0 when all gated thresholds are met, 1 otherwise.
 *
 * Usage: node docs/spikes/jl-performance-spike.mjs
 */

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { SVD } from 'ml-matrix';

const CASES = [
  { name: '300x300 DIRECT', rows: 300, cols: 300, thresholdMs: 200, gated: true },
  { name: '1000x307 JL', rows: 1000, cols: 307, thresholdMs: 500, gated: true },
  { name: '5000x378 JL', rows: 5000, cols: 378, thresholdMs: 2000, gated: true },
  { name: '5000x5000 control', rows: 5000, cols: 5000, thresholdMs: null, gated: false },
];

/** Control-case wall-clock cap (ms). Keeps the spike practical on slow boxes. */
const CONTROL_CAP_MS = 60_000;

function randomMatrix(rows, cols) {
  const matrix = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row = new Array(cols);
    for (let j = 0; j < cols; j++) row[j] = Math.random() * 2 - 1;
    matrix[i] = row;
  }
  return matrix;
}

function timeSvd(rows, cols) {
  const matrix = randomMatrix(rows, cols);
  const start = performance.now();
  new SVD(matrix);
  return performance.now() - start;
}

function runControl() {
  const script = `
    const { performance } = require('node:perf_hooks');
    const { SVD } = require('ml-matrix');
    const rows = 5000, cols = 5000;
    const matrix = new Array(rows);
    for (let i = 0; i < rows; i++) {
      const row = new Array(cols);
      for (let j = 0; j < cols; j++) row[j] = Math.random() * 2 - 1;
      matrix[i] = row;
    }
    const start = performance.now();
    new SVD(matrix);
    process.stdout.write(String(performance.now() - start));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    timeout: CONTROL_CAP_MS,
    encoding: 'utf-8',
  });
  if (result.status === 0) {
    return { elapsedMs: Number(result.stdout.trim()), capped: false };
  }
  return { elapsedMs: CONTROL_CAP_MS, capped: true };
}

let allPass = true;
console.log('JL performance spike — ml-matrix SVD');
console.log('--------------------------------------');

for (const c of CASES) {
  let elapsedMs;
  let capped = false;
  if (c.gated) {
    elapsedMs = timeSvd(c.rows, c.cols);
  } else {
    ({ elapsedMs, capped } = runControl());
  }

  const pass = c.gated ? elapsedMs < c.thresholdMs : true;
  if (c.gated && !pass) allPass = false;

  const status = capped
    ? `>${Math.round(elapsedMs)}ms (capped — control only)`
    : `${elapsedMs.toFixed(1)}ms`;
  const gateText = c.gated
    ? ` | gate ${c.thresholdMs}ms | ${pass ? 'PASS' : 'FAIL'}`
    : ' | control (not gated)';
  console.log(`${c.name}: ${status}${gateText}`);
}

console.log('--------------------------------------');
if (!allPass) {
  console.error('Spike FAILED: one or more gated thresholds were exceeded.');
  process.exit(1);
}
console.log('All gated thresholds met.');
process.exit(0);
