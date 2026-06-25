/**
 * Kotlin Dependency Extractor
 *
 * Extracts dependencies from Gradle Kotlin DSL (build.gradle.kts) files
 */

import fs from 'fs-extra';
import type {
  IDependencyExtractor,
  Dependency,
  DependencyScope,
} from '@/core/interfaces/dependency.js';

function toScope(gradleScope: string): DependencyScope {
  if (gradleScope.toLowerCase().includes('test')) return 'development';
  return 'runtime';
}

/**
 * Extended Kotlin dependency with Maven coordinate fields and raw Gradle scope.
 *
 * The `scope` field stores the raw Gradle configuration name
 * (e.g. 'implementation', 'testImplementation') rather than the generic
 * DependencyScope union, giving callers precise Gradle semantics.
 */
export interface KotlinDependency extends Dependency {
  /** Maven group ID (e.g. com.squareup.okhttp3) */
  group?: string;
  /** Maven artifact ID (e.g. okhttp) */
  artifact?: string;
  /** Raw Gradle KTS configuration name (e.g. implementation, testImplementation) */
  gradleScope?: string;
}

// Gradle KTS configuration names that declare dependencies
const GRADLE_SCOPES = [
  'implementation',
  'testImplementation',
  'androidTestImplementation',
  'api',
  'compileOnly',
  'runtimeOnly',
  'kapt',
  'ksp',
  'debugImplementation',
  'releaseImplementation',
].join('|');

// Matches: implementation("com.squareup.okhttp3:okhttp:4.12.0")
const LITERAL_REGEX = new RegExp(`^\\s*(${GRADLE_SCOPES})\\s*\\(\\s*"([^"]+)"\\s*\\)`);

// Matches: implementation(libs.androidx.core.ktx)
const CATALOG_REGEX = new RegExp(
  `^\\s*(${GRADLE_SCOPES})\\s*\\(\\s*(libs\\.[a-zA-Z0-9._-]+)\\s*\\)`
);

export class KotlinDependencyExtractor implements IDependencyExtractor {
  readonly type = 'gradle-kts' as const;

  /**
   * Extract dependencies from a build.gradle.kts file path.
   * Searches common locations: root, app/, and any single-level subdirectory.
   */
  async extractDependencies(workspaceRoot: string): Promise<KotlinDependency[]> {
    const candidates = [
      `${workspaceRoot}/build.gradle.kts`,
      `${workspaceRoot}/app/build.gradle.kts`,
    ];

    const results: KotlinDependency[] = [];
    for (const candidate of candidates) {
      const deps = await this.extractFromFile(candidate);
      results.push(...deps);
    }
    return results;
  }

  /**
   * Extract dependencies from a single build.gradle.kts file.
   * Returns empty array when the file does not exist.
   */
  async extractFromFile(filePath: string): Promise<KotlinDependency[]> {
    try {
      if (!(await fs.pathExists(filePath))) {
        return [];
      }
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseContent(content);
    } catch (error) {
      console.warn(`Failed to parse ${filePath}: ${error}`);
      return [];
    }
  }

  /**
   * Parse build.gradle.kts content string and return dependency list.
   * Suitable for direct use in tests without file I/O.
   */
  parseContent(content: string): KotlinDependency[] {
    if (!content || content.trim() === '') {
      return [];
    }

    const dependencies: KotlinDependency[] = [];

    try {
      const lines = content.split('\n');

      for (const line of lines) {
        // Skip blank lines and comment lines
        const trimmed = line.trimStart();
        if (trimmed === '' || trimmed.startsWith('//')) {
          continue;
        }

        // Try string literal form first: scope("group:artifact:version")
        const literalMatch = LITERAL_REGEX.exec(line);
        if (literalMatch) {
          const [, scope, coords] = literalMatch;
          const parts = coords.split(':');

          if (parts.length >= 2) {
            const group = parts[0].trim();
            const artifact = parts[1].trim();
            const version = parts.length >= 3 ? parts[2].trim() : '';

            dependencies.push({
              name: artifact,
              version,
              type: 'gradle-kts',
              scope: toScope(scope),
              gradleScope: scope,
              source: 'build.gradle.kts',
              isDirect: true,
              group,
              artifact,
            } as KotlinDependency);
          }
          continue;
        }

        // Try version catalog form: scope(libs.xxx.yyy)
        const catalogMatch = CATALOG_REGEX.exec(line);
        if (catalogMatch) {
          const [, scope, ref] = catalogMatch;

          dependencies.push({
            name: ref,
            version: '',
            type: 'gradle-kts',
            scope: toScope(scope),
            gradleScope: scope,
            source: 'build.gradle.kts',
            isDirect: true,
          } as KotlinDependency);
        }
      }
    } catch (error) {
      console.warn(`Failed to parse build.gradle.kts content: ${error}`);
      return [];
    }

    return dependencies;
  }
}
