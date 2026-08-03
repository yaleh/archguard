/**
 * Unit tests covering PluginRegistry gaps not exercised by the existing
 * tests/core/plugin-registry.test.ts (duplicate registration, overwrite,
 * version lookups, extension lookup, listing, loadFromPath, compareVersions).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { PluginRegistry } from '@/core/plugin-registry.js';
import type { ILanguagePlugin } from '@/core/interfaces/index.js';

function makePlugin(
  name: string,
  version: string,
  extensions: string[] = [`.${name}`]
): ILanguagePlugin {
  return {
    metadata: {
      name,
      version,
      displayName: name,
      fileExtensions: extensions,
      author: 'test',
      minCoreVersion: '1.0.0',
      capabilities: {
        singleFileParsing: true,
        incrementalParsing: false,
        dependencyExtraction: false,
        typeInference: false,
      },
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    canHandle: () => false,
    parseProject: vi.fn().mockResolvedValue({}),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as ILanguagePlugin;
}

describe('PluginRegistry register edge cases', () => {
  it('throws when registering a duplicate name/version without overwrite', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('p', '1.0.0'));
    expect(() => reg.register(makePlugin('p', '1.0.0'))).toThrow(/already registered/);
  });

  it('allows the same name with different versions', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('p', '1.0.0'));
    reg.register(makePlugin('p', '2.0.0'));
    expect(reg.listVersions('p')).toEqual(['1.0.0', '2.0.0']);
  });

  it('replaces the old version when overwrite is true', () => {
    const reg = new PluginRegistry();
    const v1 = makePlugin('p', '1.0.0', ['.p']);
    const v2 = makePlugin('p', '1.0.0', ['.p']);
    reg.register(v1);
    reg.register(v2, { overwrite: true });
    expect(reg.getByName('p', '1.0.0')).toBe(v2);
    // extension map should hold only one instance after overwrite
    expect(reg.getByExtension('.p')).toBe(v2);
  });
});

describe('PluginRegistry lookups', () => {
  it('getByName returns null for unknown name', () => {
    expect(new PluginRegistry().getByName('nope')).toBeNull();
  });

  it('getByName with a version returns that version', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('p', '1.0.0'));
    reg.register(makePlugin('p', '2.0.0'));
    expect(reg.getByName('p', '1.0.0')?.metadata.version).toBe('1.0.0');
    expect(reg.getByName('p', '9.9.9')).toBeNull();
  });

  it('getByName without a version returns the latest', () => {
    const reg = new PluginRegistry();
    const v2 = makePlugin('p', '2.0.0');
    reg.register(makePlugin('p', '1.0.0'));
    reg.register(v2);
    expect(reg.getByName('p')).toBe(v2);
  });

  it('getByExtension returns the highest-version plugin for an extension', () => {
    const reg = new PluginRegistry();
    const v1 = makePlugin('a', '1.0.0', ['.x']);
    const v2 = makePlugin('a', '2.0.0', ['.x']);
    const other = makePlugin('b', '1.0.0', ['.x']);
    reg.register(v1);
    reg.register(v2);
    reg.register(other);
    expect(reg.getByExtension('.x')).toBe(v2);
  });

  it('getByExtension returns null for unregistered extensions', () => {
    expect(new PluginRegistry().getByExtension('.nope')).toBeNull();
  });
});

describe('PluginRegistry listing and presence', () => {
  it('listVersions returns [] for unknown names', () => {
    expect(new PluginRegistry().listVersions('nope')).toEqual([]);
  });

  it('listAll returns every registered plugin instance', () => {
    const reg = new PluginRegistry();
    const a = makePlugin('a', '1.0.0');
    const b1 = makePlugin('b', '1.0.0');
    const b2 = makePlugin('b', '2.0.0');
    reg.register(a);
    reg.register(b1);
    reg.register(b2);
    expect(reg.listAll()).toHaveLength(3);
  });

  it('has returns false for unknown names and versions', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('p', '1.0.0'));
    expect(reg.has('nope')).toBe(false);
    expect(reg.has('p', '9.0.0')).toBe(false);
    expect(reg.has('p')).toBe(true);
    expect(reg.has('p', '1.0.0')).toBe(true);
  });
});

describe('PluginRegistry.loadFromPath', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-load-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('instantiates the default export class', async () => {
    const reg = new PluginRegistry();
    const p = path.join(dir, 'default-plugin.mjs');
    await fs.writeFile(
      p,
      'export default class { constructor() { this.metadata = { name: "esm", version: "1.0.0", fileExtensions: [".esm"] }; } }'
    );
    const plugin = await reg.loadFromPath(p);
    expect(plugin.metadata.name).toBe('esm');
  });

  it('instantiates a named Plugin export', async () => {
    const reg = new PluginRegistry();
    const p = path.join(dir, 'named-plugin.mjs');
    await fs.writeFile(
      p,
      'export class Plugin { constructor() { this.metadata = { name: "named", version: "1.0.0", fileExtensions: [".named"] }; } }'
    );
    const plugin = await reg.loadFromPath(p);
    expect(plugin.metadata.name).toBe('named');
  });

  it('throws when the module has no Plugin export', async () => {
    const reg = new PluginRegistry();
    const p = path.join(dir, 'no-plugin.mjs');
    await fs.writeFile(p, 'export const unrelated = 42;');
    await expect(reg.loadFromPath(p)).rejects.toThrow(/default class or named 'Plugin'/);
  });
});

describe('PluginRegistry.detectPluginForDirectory', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-detect-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('returns null when no marker file is found', async () => {
    const reg = new PluginRegistry();
    expect(await reg.detectPluginForDirectory(dir)).toBeNull();
  });

  it('returns the matching plugin when a go.mod marker exists', async () => {
    const reg = new PluginRegistry();
    const golang = makePlugin('golang', '1.0.0');
    reg.register(golang);
    await fs.writeFile(path.join(dir, 'go.mod'), 'module example.com/x\n');
    expect(await reg.detectPluginForDirectory(dir)).toBe(golang);
  });

  it('prefers the first matching detection rule (go.mod before package.json)', async () => {
    const reg = new PluginRegistry();
    const golang = makePlugin('golang', '1.0.0');
    const ts = makePlugin('typescript', '1.0.0');
    reg.register(golang);
    reg.register(ts);
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    await fs.writeFile(path.join(dir, 'go.mod'), 'module example.com/x\n');
    // go.mod is checked first in DETECTION_RULES
    expect(await reg.detectPluginForDirectory(dir)).toBe(golang);
  });
});

describe('PluginRegistry version comparison ordering', () => {
  it('sorts versions numerically, not lexically', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('p', '1.10.0'));
    reg.register(makePlugin('p', '1.2.0'));
    reg.register(makePlugin('p', '1.0.0'));
    expect(reg.listVersions('p')).toEqual(['1.0.0', '1.2.0', '1.10.0']);
    expect(reg.getByName('p')?.metadata.version).toBe('1.10.0');
  });

  it('handles unequal-length version segments', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('p', '1.0'));
    reg.register(makePlugin('p', '1.0.0'));
    reg.register(makePlugin('p', '1.0.1'));
    expect(reg.getByName('p')?.metadata.version).toBe('1.0.1');
  });
});
