/**
 * TASK-71 — KotlinPlugin.extractTestStructure branch-dense path extra tests.
 *
 * Fills gaps in kotlin-plugin.test.ts around the regex-scan branches of
 * extractTestStructure:
 *   - @Ignore / @Disabled skipped-test detection (isSkipped: true)
 *   - importedSourceFiles filtering (internal import kept, org.junit dropped)
 *   - assertion distribution with remainder across multiple cases
 *   - customAssertionRegexes from patternConfig
 *   - @RepeatedTest detection
 *   - testTypeHint = 'e2e' for e2eTest path
 *   - isTestFile custom-glob precedence + TestFoo.kt prefix pattern
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinPlugin } from '@/plugins/kotlin/index.js';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';

describe('KotlinPlugin.extractTestStructure — skipped-test branch', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin(nativeParserBackend);
  });

  it('marks @Ignore + @Test functions as isSkipped: true', () => {
    const code = `class FooTest {
  @Test
  fun runs() {
    assertTrue(true)
  }

  @Ignore
  @Test
  fun disabled() {
    assertTrue(false)
  }
}`;
    const result = plugin.extractTestStructure?.('src/test/FooTest.kt', code);
    const skipped = result?.testCases.find((c) => c.name === 'disabled' && c.isSkipped === true);
    expect(skipped).toBeDefined();
  });

  it('marks @Disabled + @Test functions as isSkipped: true', () => {
    const code = `class FooTest {
  @Disabled
  @Test
  fun ignored() {
    assertTrue(false)
  }
}`;
    const result = plugin.extractTestStructure?.('src/test/FooTest.kt', code);
    const skipped = result?.testCases.find((c) => c.name === 'ignored' && c.isSkipped === true);
    expect(skipped).toBeDefined();
  });
});

describe('KotlinPlugin.extractTestStructure — importedSourceFiles filtering', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin(nativeParserBackend);
  });

  it('keeps project-internal imports and drops org.junit', () => {
    const code = `import com.example.app.data.UserRepository
import org.junit.Test
class FooTest {
  @Test
  fun t() {
    assertTrue(true)
  }
}`;
    const result = plugin.extractTestStructure?.('src/test/FooTest.kt', code);
    expect(result?.importedSourceFiles).toContain('com.example.app.data.UserRepository');
    expect(result?.importedSourceFiles).not.toContain('org.junit.Test');
  });
});

describe('KotlinPlugin.extractTestStructure — assertion distribution with remainder', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin(nativeParserBackend);
  });

  it('distributes totalAssertions evenly across test cases', () => {
    const code = `class FooTest {
  @Test
  fun a() {
    assertTrue(true)
    assertEquals(1,1)
    assertNotNull(x)
  }

  @Test
  fun b() {
    assertTrue(false)
  }
}`;
    const result = plugin.extractTestStructure?.('src/test/FooTest.kt', code);
    expect(result?.testCases.map((c) => c.assertionCount)).toEqual([2, 2]);
    expect(result?.totalAssertions).toBe(4);
  });
});

describe('KotlinPlugin.extractTestStructure — custom assertion regexes', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin(nativeParserBackend);
  });

  it('counts custom assertion patterns from patternConfig', () => {
    const code = `class FooTest {
  @Test
  fun t() {
    myAssertEqual(1,1)
    myAssertEqual(2,2)
  }
}`;
    const result = plugin.extractTestStructure?.('src/test/FooTest.kt', code, {
      customAssertionRegexes: [String.raw`\bmyAssertEqual\s*\(`],
    });
    expect(result?.totalAssertions).toBe(2);
  });
});

describe('KotlinPlugin.extractTestStructure — @RepeatedTest + e2e hint', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin(nativeParserBackend);
  });

  it('detects @RepeatedTest annotated functions', () => {
    const code = `class FooTest {
  @RepeatedTest
  fun repeated() {
    assertTrue(true)
  }
}`;
    const result = plugin.extractTestStructure?.('src/test/FooTest.kt', code);
    expect(result?.testCases.some((c) => c.name === 'repeated')).toBe(true);
  });

  it('sets testTypeHint to e2e for e2eTest path', () => {
    const code = `class FooTest {
  @Test
  fun t() {
    assertTrue(true)
  }
}`;
    const result = plugin.extractTestStructure?.('src/e2eTest/FooTest.kt', code);
    expect(result?.testTypeHint).toBe('e2e');
  });
});

describe('KotlinPlugin.isTestFile — pattern config + name prefix', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin(nativeParserBackend);
  });

  it('custom testFileGlobs take precedence over built-in heuristics', () => {
    // 'plain.kt' is not a test by name, but the custom glob marks it as one
    expect(plugin.isTestFile('plain.kt', { testFileGlobs: ['**/*.kt'] })).toBe(true);
  });

  it('matches TestFoo.kt prefix naming convention', () => {
    expect(plugin.isTestFile('TestFoo.kt')).toBe(true);
  });
});
