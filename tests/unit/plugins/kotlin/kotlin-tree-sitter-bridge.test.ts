import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterBridge } from '@/plugins/kotlin/tree-sitter-bridge.js';

describe('TreeSitterBridge', () => {
  let bridge: TreeSitterBridge;

  beforeAll(() => {
    bridge = new TreeSitterBridge();
    bridge.initialize();
  });

  // ─── package name ──────────────────────────────────────────────────────────

  it('parses package name correctly', () => {
    const code = `package com.example.app\n\nclass Foo`;
    const result = bridge.parseCode(code, 'Foo.kt');
    expect(result.packageName).toBe('com.example.app');
  });

  it('returns empty string when no package statement', () => {
    const code = `class Foo`;
    const result = bridge.parseCode(code, 'Foo.kt');
    expect(result.packageName).toBe('');
  });

  // ─── imports ───────────────────────────────────────────────────────────────

  it('parses import statements into imports array', () => {
    const code = [
      'package com.example.app',
      'import com.example.data.UserRepository',
      'import android.os.Bundle',
    ].join('\n');
    const result = bridge.parseCode(code, 'Main.kt');
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].path).toBe('com.example.data.UserRepository');
    expect(result.imports[1].path).toBe('android.os.Bundle');
  });

  it('parses import alias correctly', () => {
    const code = 'import com.example.data.UserRepository as Repo';
    const result = bridge.parseCode(code, 'Main.kt');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].path).toBe('com.example.data.UserRepository');
    expect(result.imports[0].alias).toBe('Repo');
  });

  it('preserves wildcard imports with .*', () => {
    const code = 'import com.example.app.*';
    const result = bridge.parseCode(code, 'Main.kt');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].path).toBe('com.example.app.*');
    expect(result.imports[0].alias).toBeUndefined();
  });

  it('returns empty imports array when no import statements', () => {
    const code = 'package com.example\n\nclass Foo';
    const result = bridge.parseCode(code, 'Foo.kt');
    expect(result.imports).toHaveLength(0);
  });

  // ─── data class extraction ─────────────────────────────────────────────────

  it('extracts top-level data class', () => {
    const code = ['package com.example.app', 'data class User(val id: Int, val name: String)'].join(
      '\n'
    );
    const result = bridge.parseCode(code, 'User.kt');
    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls.name).toBe('User');
    expect(cls.kind).toBe('data_class');
    expect(cls.packageName).toBe('com.example.app');
  });

  // ─── object declaration ────────────────────────────────────────────────────

  it('extracts top-level object declaration', () => {
    const code = ['package com.example.app', 'object AppConfig {', '  val DEBUG = false', '}'].join(
      '\n'
    );
    const result = bridge.parseCode(code, 'AppConfig.kt');
    expect(result.classes).toHaveLength(1);
    const obj = result.classes[0];
    expect(obj.name).toBe('AppConfig');
    expect(obj.kind).toBe('object');
  });

  // ─── top-level function ────────────────────────────────────────────────────

  it('extracts top-level function with name and isComposable flag', () => {
    const code = [
      'package com.example.app',
      'import androidx.compose.runtime.Composable',
      '',
      '@Composable',
      'fun UserScreen(userId: Int) {}',
      '',
      'fun helperFn() {}',
    ].join('\n');
    const result = bridge.parseCode(code, 'UserScreen.kt');
    expect(result.functions.length).toBeGreaterThanOrEqual(2);

    const composable = result.functions.find((f) => f.name === 'UserScreen');
    expect(composable).toBeDefined();
    expect(composable.isComposable).toBe(true);
    expect(composable.packageName).toBe('com.example.app');

    const helper = result.functions.find((f) => f.name === 'helperFn');
    expect(helper).toBeDefined();
    expect(helper.isComposable).toBe(false);
  });

  // ─── error resilience ─────────────────────────────────────────────────────

  it('does not throw on syntax errors — returns empty stub', () => {
    // Severely malformed code — tree-sitter is error-tolerant but
    // if it does throw our catch should return the stub
    expect(() => bridge.parseCode('class {{{{{ @@@ broken', 'broken.kt')).not.toThrow();
    const result = bridge.parseCode('class {{{{{ @@@ broken', 'broken.kt');
    expect(result.filePath).toBe('broken.kt');
    // packageName may be '' but should not throw
    expect(typeof result.packageName).toBe('string');
  });

  // ─── constructor initialization ───────────────────────────────────────────

  it('parses code immediately after construction without calling initialize()', () => {
    const bridge = new TreeSitterBridge();
    const result = bridge.parseCode('class Foo', 'Foo.kt');
    expect(result.filePath).toBe('Foo.kt');
  });
});
