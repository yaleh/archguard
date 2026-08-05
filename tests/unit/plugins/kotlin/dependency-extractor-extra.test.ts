/**
 * TASK-71 — KotlinDependencyExtractor branch-dense path extra tests.
 *
 * Fills gaps in dependency-extractor.test.ts for parseContent branches:
 *   - literal coordinate WITHOUT a version segment (`group:artifact`)
 *   - single-segment coordinates that must be skipped (`parts.length < 2`)
 *   - non-"test"-containing Gradle scopes → DependencyScope 'runtime'
 *     (compileOnly / kapt / debugImplementation / api)
 *   - leading-whitespace handling in the scope regex
 */
import { describe, it, expect } from 'vitest';
import { KotlinDependencyExtractor } from '@/plugins/kotlin/dependency-extractor.js';

describe('KotlinDependencyExtractor.parseContent — coordinate shapes', () => {
  const extractor = new KotlinDependencyExtractor();

  it('parses literal with group:artifact but no version segment', () => {
    const deps = extractor.parseContent(`implementation("com.google.android.material:material")`);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      name: 'material',
      group: 'com.google.android.material',
      artifact: 'material',
      version: '',
      type: 'gradle-kts',
      scope: 'runtime',
      gradleScope: 'implementation',
    });
  });

  it('skips a single-segment coordinate (no colon → not a maven coord)', () => {
    const deps = extractor.parseContent(`implementation("com.foo")`);
    expect(deps).toHaveLength(0);
  });
});

describe('KotlinDependencyExtractor.parseContent — scope → DependencyScope mapping', () => {
  const extractor = new KotlinDependencyExtractor();

  it('maps compileOnly to runtime (no "test" substring)', () => {
    const deps = extractor.parseContent(`compileOnly("com.foo:bar:1.0")`);
    expect(deps[0].scope).toBe('runtime');
    expect(deps[0].gradleScope).toBe('compileOnly');
  });

  it('maps kapt to runtime', () => {
    const deps = extractor.parseContent(`kapt("com.foo:bar:1.0")`);
    expect(deps[0].scope).toBe('runtime');
    expect(deps[0].gradleScope).toBe('kapt');
  });

  it('maps debugImplementation to runtime', () => {
    const deps = extractor.parseContent(`debugImplementation("com.foo:bar:1.0")`);
    expect(deps[0].scope).toBe('runtime');
    expect(deps[0].gradleScope).toBe('debugImplementation');
  });

  it('maps api to runtime', () => {
    const deps = extractor.parseContent(`api("com.foo:bar:1.0")`);
    expect(deps[0].scope).toBe('runtime');
  });

  it('maps androidTestImplementation to development (contains "test")', () => {
    const deps = extractor.parseContent(`androidTestImplementation("com.foo:bar:1.0")`);
    expect(deps[0].scope).toBe('development');
  });
});

describe('KotlinDependencyExtractor.parseContent — whitespace / noise', () => {
  const extractor = new KotlinDependencyExtractor();

  it('accepts leading whitespace before the scope call', () => {
    const deps = extractor.parseContent(`    implementation("com.foo:bar:1.0")`);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('bar');
  });

  it('ignores a comment-only file', () => {
    expect(extractor.parseContent(`// no deps\n// another comment`)).toEqual([]);
  });

  it('ignores non-dependency statements (plugins block)', () => {
    expect(extractor.parseContent(`plugins {\n  id("com.android.application")\n}`)).toEqual([]);
  });
});
