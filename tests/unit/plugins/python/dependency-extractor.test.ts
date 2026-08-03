/**
 * Unit tests for the Python DependencyExtractor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { DependencyExtractor } from '@/plugins/python/dependency-extractor.js';

describe('Python DependencyExtractor', () => {
  let root: string;
  const extractor = new DependencyExtractor();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'py-dep-'));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('returns [] when neither pyproject.toml nor requirements.txt exists', async () => {
    expect(await extractor.extractDependencies(root)).toEqual([]);
  });

  it('parses requirements.txt with version operators and comments', async () => {
    await fs.writeFile(
      path.join(root, 'requirements.txt'),
      [
        '# comment',
        'requests==2.25.0',
        'numpy>=1.21.0',
        'pytest; python_version >= "3.6"',
        'flask[async]==2.0.0',
        '',
      ].join('\n'),
      'utf-8'
    );
    const deps = await extractor.extractDependencies(root);
    expect(deps).toHaveLength(4);
    expect(deps[0]).toMatchObject({ name: 'requests', version: '==2.25.0', type: 'pip' });
    expect(deps[1]).toMatchObject({ name: 'numpy', version: '>=1.21.0' });
    // markers stripped entirely → version becomes '*'
    expect(deps[2]).toMatchObject({ name: 'pytest', version: '*' });
    // extras stripped
    expect(deps[3]).toMatchObject({ name: 'flask', version: '==2.0.0' });
  });

  it('skips invalid requirement lines', async () => {
    await fs.writeFile(path.join(root, 'requirements.txt'), 'invalid name with spaces\n', 'utf-8');
    expect(await extractor.extractDependencies(root)).toEqual([]);
  });

  it('prefers pyproject.toml over requirements.txt', async () => {
    await fs.writeFile(path.join(root, 'requirements.txt'), 'requests==1.0.0\n', 'utf-8');
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      [
        '[tool.poetry.dependencies]',
        'python = "^3.10"',
        'django = "^4.0"',
        'celery = { version = "^5.2", optional = true }',
      ].join('\n'),
      'utf-8'
    );
    const deps = await extractor.extractDependencies(root);
    // python constraint skipped; django + celery parsed from pyproject only
    expect(deps.some((d) => d.name === 'requests')).toBe(false);
    expect(deps.some((d) => d.name === 'django')).toBe(true);
    expect(deps.find((d) => d.name === 'celery')?.scope).toBe('optional');
  });

  it('parses dev-dependencies with development scope and marks extras as optional', async () => {
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      [
        '[tool.poetry.dependencies]',
        'flask = "^2.0"',
        '[tool.poetry.dev-dependencies]',
        'pytest = "^7.0"',
        '[tool.poetry.extras]',
        'web = ["flask"]',
      ].join('\n'),
      'utf-8'
    );
    const deps = await extractor.extractDependencies(root);
    const flask = deps.find((d) => d.name === 'flask');
    const pytest = deps.find((d) => d.name === 'pytest');
    expect(flask?.scope).toBe('optional'); // marked via extras
    expect(pytest?.scope).toBe('development');
  });

  it('returns [] when pyproject.toml is malformed', async () => {
    await fs.writeFile(path.join(root, 'pyproject.toml'), 'not toml {{{', 'utf-8');
    expect(await extractor.extractDependencies(root)).toEqual([]);
  });
});
