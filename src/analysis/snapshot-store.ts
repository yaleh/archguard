import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'node:child_process';
import type { MetricVector } from '@/types/metric-vector.js';

export interface MetricSnapshot {
  schemaVersion: number;
  commitSha: string | null;
  branch: string | null;
  timestamp: string; // ISO 8601
  archguardVersion: string;
  metricVector: MetricVector;
}

const SNAPSHOTS_SUBDIR = 'snapshots';

function snapshotsDir(outputDir: string): string {
  return path.join(outputDir, SNAPSHOTS_SUBDIR);
}

function buildFilename(snapshot: MetricSnapshot): string {
  const prefix = snapshot.commitSha ?? 'unknown';
  // Sanitize timestamp for use as filename (replace colons)
  const ts = snapshot.timestamp.replace(/[:.]/g, '-').replace(/Z$/, 'Z');
  return `${prefix}-${ts}.json`;
}

export async function saveSnapshot(outputDir: string, snapshot: MetricSnapshot): Promise<void> {
  const dir = snapshotsDir(outputDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, buildFilename(snapshot));
  await fs.writeJson(filePath, snapshot, { spaces: 2 });
}

export async function loadSnapshots(outputDir: string): Promise<MetricSnapshot[]> {
  const dir = snapshotsDir(outputDir);

  if (!(await fs.pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir);
  const jsonFiles = entries.filter((f) => f.endsWith('.json'));

  const snapshots: MetricSnapshot[] = [];
  for (const file of jsonFiles) {
    try {
      const data = await fs.readJson(path.join(dir, file));
      snapshots.push(data as MetricSnapshot);
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp DESC (newest first)
  snapshots.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return tb - ta;
  });

  return snapshots;
}

export async function pruneSnapshots(outputDir: string, maxCount: number): Promise<number> {
  const dir = snapshotsDir(outputDir);

  if (!(await fs.pathExists(dir))) {
    return 0;
  }

  const entries = await fs.readdir(dir);
  const jsonFiles = entries.filter((f) => f.endsWith('.json'));

  if (jsonFiles.length <= maxCount) {
    return 0;
  }

  // Load with filenames to identify which to delete
  const fileSnapshots: Array<{ file: string; timestamp: number }> = [];
  for (const file of jsonFiles) {
    try {
      const data = await fs.readJson(path.join(dir, file));
      fileSnapshots.push({
        file,
        timestamp: new Date((data as MetricSnapshot).timestamp).getTime(),
      });
    } catch {
      // Include unparseable files as timestamp=0 so they get pruned first
      fileSnapshots.push({ file, timestamp: 0 });
    }
  }

  // Sort DESC; keep first maxCount, delete the rest
  fileSnapshots.sort((a, b) => b.timestamp - a.timestamp);
  const toDelete = fileSnapshots.slice(maxCount);

  for (const { file } of toDelete) {
    await fs.remove(path.join(dir, file));
  }

  return toDelete.length;
}

function runGitCommand(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

export async function resolveCommitSha(): Promise<string | null> {
  return runGitCommand(['rev-parse', 'HEAD']);
}

export async function resolveBranch(): Promise<string | null> {
  return runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
}
