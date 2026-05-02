import { describe, it, expect } from 'vitest';
import { KotlinDependencyExtractor } from '@/plugins/kotlin/dependency-extractor.js';

describe('KotlinDependencyExtractor', () => {
  const extractor = new KotlinDependencyExtractor();

  describe('parseContent', () => {
    it('parses string literal dependency', () => {
      const content = `implementation("com.squareup.okhttp3:okhttp:4.12.0")`;
      const deps = extractor.parseContent(content);
      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        name: 'okhttp',
        group: 'com.squareup.okhttp3',
        artifact: 'okhttp',
        version: '4.12.0',
        type: 'gradle-kts',
        scope: 'runtime',
        gradleScope: 'implementation',
      });
    });

    it('parses testImplementation dependency', () => {
      const content = `testImplementation("junit:junit:4.13.2")`;
      const deps = extractor.parseContent(content);
      expect(deps[0].scope).toBe('development');
      expect((deps[0] as any).gradleScope).toBe('testImplementation');
    });

    it('parses androidTestImplementation dependency', () => {
      const content = `androidTestImplementation("androidx.test.ext:junit:1.1.5")`;
      const deps = extractor.parseContent(content);
      expect(deps[0].scope).toBe('development');
      expect((deps[0] as any).gradleScope).toBe('androidTestImplementation');
    });

    it('parses version catalog reference', () => {
      const content = `implementation(libs.androidx.core.ktx)`;
      const deps = extractor.parseContent(content);
      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        name: 'libs.androidx.core.ktx',
        type: 'gradle-kts',
        scope: 'runtime',
        gradleScope: 'implementation',
      });
    });

    it('parses multiple dependencies', () => {
      const content = `
        implementation("com.squareup.okhttp3:okhttp:4.12.0")
        testImplementation(libs.junit)
        api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
      `;
      const deps = extractor.parseContent(content);
      expect(deps).toHaveLength(3);
    });

    it('ignores commented lines', () => {
      const content = `
        // implementation("foo:bar:1.0")
        implementation("real:dep:1.0")
      `;
      const deps = extractor.parseContent(content);
      expect(deps).toHaveLength(1);
    });

    it('returns empty array for empty content', () => {
      expect(extractor.parseContent('')).toEqual([]);
    });

    it('returns empty array on parse error gracefully', () => {
      // 只有不相关的内容
      expect(extractor.parseContent('plugins { id("com.android.application") }')).toEqual([]);
    });
  });

  describe('extractFromFile', () => {
    it('returns empty array when file does not exist', async () => {
      const deps = await extractor.extractFromFile('/nonexistent/build.gradle.kts');
      expect(deps).toEqual([]);
    });
  });
});
