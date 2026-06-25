import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinPlugin } from '@/plugins/kotlin/index.js';

describe('KotlinPlugin', () => {
  let plugin: KotlinPlugin;

  beforeEach(() => {
    plugin = new KotlinPlugin();
  });

  describe('metadata', () => {
    it('has all required metadata fields', () => {
      const m = plugin.metadata;
      expect(m.name).toBe('kotlin');
      expect(m.version).toBeDefined();
      expect(m.displayName).toBe('Kotlin');
      expect(m.fileExtensions).toContain('.kt');
      expect(m.fileExtensions).toContain('.kts');
      expect(m.author).toBeDefined();
      expect(m.minCoreVersion).toBeDefined();
      expect(m.capabilities).toBeDefined();
    });

    it('capabilities include testStructureExtraction', () => {
      expect(plugin.metadata.capabilities.testStructureExtraction).toBe(true);
    });
  });

  describe('supportedLevels', () => {
    it('supports package and class levels', () => {
      expect(plugin.supportedLevels).toContain('package');
      expect(plugin.supportedLevels).toContain('class');
      expect(plugin.supportedLevels).not.toContain('method');
    });
  });

  describe('canHandle', () => {
    it('returns true for .kt files', () => {
      expect(plugin.canHandle('Foo.kt')).toBe(true);
    });

    it('returns true for .kts files', () => {
      expect(plugin.canHandle('build.gradle.kts')).toBe(true);
    });

    it('returns false for .java files', () => {
      expect(plugin.canHandle('Main.java')).toBe(false);
    });

    it('returns false for .ts files', () => {
      expect(plugin.canHandle('index.ts')).toBe(false);
    });
  });

  describe('isTestFile', () => {
    it('returns true for files ending with Test.kt', () => {
      expect(plugin.isTestFile?.('MainViewModelTest.kt')).toBe(true);
    });

    it('returns true for path containing src/test/', () => {
      expect(plugin.isTestFile?.('src/test/java/com/example/FooTest.kt')).toBe(true);
    });

    it('returns true for path containing src/androidTest/', () => {
      expect(plugin.isTestFile?.('src/androidTest/java/com/example/FooTest.kt')).toBe(true);
    });

    it('returns false for regular source files', () => {
      expect(plugin.isTestFile?.('src/main/java/com/example/Main.kt')).toBe(false);
    });

    it('returns false for non-test named files', () => {
      expect(plugin.isTestFile?.('MainViewModel.kt')).toBe(false);
    });
  });

  describe('extractTestStructure', () => {
    it('detects @Test annotated methods', () => {
      const code = `
        class FooTest {
          @Test
          fun testSomething() {
            assertEquals(1, 1)
          }
        }
      `;
      const result = plugin.extractTestStructure?.('FooTest.kt', code);
      expect(result).not.toBeNull();
      expect(result?.testCases.length).toBeGreaterThanOrEqual(1);
    });

    it('counts assert calls', () => {
      const code = `
        class FooTest {
          @Test
          fun testAsserts() {
            assertEquals(1, 1)
            assertTrue(true)
            assertNotNull(foo)
          }
        }
      `;
      const result = plugin.extractTestStructure?.('FooTest.kt', code);
      expect(result?.totalAssertions).toBeGreaterThanOrEqual(3);
    });

    it('returns null for non-test files', () => {
      const code = `class Main { fun run() {} }`;
      const result = plugin.extractTestStructure?.('Main.kt', code);
      expect(result).toBeNull();
    });

    it('detects @ParameterizedTest annotated methods', () => {
      const code = `
        class BarTest {
          @ParameterizedTest
          fun testWithParams(value: Int) {
            assertTrue(value > 0)
          }
        }
      `;
      const result = plugin.extractTestStructure?.('BarTest.kt', code);
      expect(result).not.toBeNull();
      expect(result?.testCases.length).toBeGreaterThanOrEqual(1);
    });

    it('sets frameworks to junit', () => {
      const code = `
        class FooTest {
          @Test
          fun testSomething() {
            assertEquals(1, 1)
          }
        }
      `;
      const result = plugin.extractTestStructure?.('FooTest.kt', code);
      expect(result?.frameworks).toContain('junit');
    });

    it('sets testTypeHint based on path', () => {
      const code = `
        class FooTest {
          @Test
          fun testSomething() {
            assertEquals(1, 1)
          }
        }
      `;
      const unitResult = plugin.extractTestStructure?.('src/test/FooTest.kt', code);
      expect(unitResult?.testTypeHint).toBe('unit');
    });

    it('sets testTypeHint to integration for androidTest path', () => {
      const code = `
        class FooTest {
          @Test
          fun testSomething() {
            assertEquals(1, 1)
          }
        }
      `;
      const integResult = plugin.extractTestStructure?.('src/androidTest/FooTest.kt', code);
      expect(integResult?.testTypeHint).toBe('integration');
    });

    it('detects backtick-named @Test functions (idiomatic Kotlin JUnit5)', () => {
      const code = `
        class UsbDeviceRefreshControllerTest {
          @Test
          fun \`refreshes when usb device is attached or detached\`() = runTest {
            assertEquals(2, refreshCalls)
          }

          @Test
          fun \`refreshes when lifecycle resumes\`() = runTest {
            assertEquals(1, refreshCalls)
          }
        }
      `;
      const result = plugin.extractTestStructure?.(
        'src/test/java/com/example/UsbDeviceRefreshControllerTest.kt',
        code
      );
      expect(result).not.toBeNull();
      expect(result?.testCases.length).toBe(2);
      expect(result?.testTypeHint).toBe('unit');
    });

    it('returns null when all @Test functions use backtick names and none matched by old regex', () => {
      // This test documents that backtick-only tests previously returned null — now they must not
      const code = `
        class AppShellTest {
          @Test
          fun \`shows project list on launch\`() {
            assertTrue(true)
          }
        }
      `;
      const result = plugin.extractTestStructure?.(
        'src/test/java/com/example/app/AppShellTest.kt',
        code
      );
      // Must find the test case, not return null
      expect(result).not.toBeNull();
      expect(result?.testCases.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('dispose', () => {
    it('can be called on a fresh instance without errors', async () => {
      await expect(plugin.dispose()).resolves.not.toThrow();
    });

    it('sets initialized to false after dispose', async () => {
      await plugin.dispose();
      expect((plugin as any).initialized).toBe(false);
    });
  });
});
