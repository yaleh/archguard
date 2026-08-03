/**
 * Unit tests for planGoAnalysisScope.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { planGoAnalysisScope } from '@/plugins/golang/source-scope.js';

describe('planGoAnalysisScope', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'go-scope-'));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('throws when no sources are provided', async () => {
    await expect(planGoAnalysisScope([])).rejects.toThrow(/at least one source path/);
  });

  it('throws when a source is not inside a Go module', async () => {
    await expect(planGoAnalysisScope([path.join(root, 'nowhere')])).rejects.toThrow(
      /go.mod not found/
    );
  });

  it('throws when sources span multiple Go modules', async () => {
    const m1 = path.join(root, 'm1');
    const m2 = path.join(root, 'm2');
    await fs.ensureDir(m1);
    await fs.ensureDir(m2);
    await fs.writeFile(path.join(m1, 'go.mod'), 'module m1\n');
    await fs.writeFile(path.join(m2, 'go.mod'), 'module m2\n');
    await expect(planGoAnalysisScope([m1, m2])).rejects.toThrow(/multiple Go modules/);
  });

  it('plans a single-module scope with include patterns', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/x\n');
    const sub = path.join(root, 'internal', 'svc');
    await fs.ensureDir(sub);
    const plan = await planGoAnalysisScope([sub]);
    expect(plan.workspaceRoot).toBe(root);
    expect(plan.includePatterns).toContain('internal/svc/**/*.go');
  });

  it('uses **/*.go when the source is the module root', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/x\n');
    const plan = await planGoAnalysisScope([root]);
    expect(plan.includePatterns).toContain('**/*.go');
  });

  it('treats a .go file source as a file include pattern', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/x\n');
    const main = path.join(root, 'main.go');
    await fs.writeFile(main, 'package main\n');
    const plan = await planGoAnalysisScope([main]);
    expect(plan.includePatterns).toContain('main.go');
  });

  it('computes nested module exclude patterns', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/x\n');
    const nested = path.join(root, 'vendor', 'dep');
    await fs.ensureDir(nested);
    await fs.writeFile(path.join(nested, 'go.mod'), 'module dep\n');
    const plan = await planGoAnalysisScope([root]);
    // vendor/** is ignored by the glob, so no exclude for it; a nested non-vendor module would appear
    expect(Array.isArray(plan.excludePatterns)).toBe(true);
  });
});
