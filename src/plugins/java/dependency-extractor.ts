/**
 * Java Dependency Extractor
 *
 * Extracts dependencies from Maven (pom.xml) and Gradle (build.gradle) files
 */

import fs from 'fs-extra';
import path from 'path';
import type { Dependency, DependencyScope } from '@/core/interfaces/dependency.js';

/**
 * Java-specific dependency scopes
 */
type JavaDependencyScope = 'compile' | 'test' | 'runtime' | 'provided';

export class DependencyExtractor {
  /**
   * Auto-detect and extract dependencies from Java project
   */
  async extract(workspaceRoot: string): Promise<Dependency[]> {
    const pomPath = path.join(workspaceRoot, 'pom.xml');
    const gradlePath = path.join(workspaceRoot, 'build.gradle');

    // Try Maven first
    if (await fs.pathExists(pomPath)) {
      return this.extractFromMaven(pomPath);
    }

    // Then try Gradle
    if (await fs.pathExists(gradlePath)) {
      return this.extractFromGradle(gradlePath);
    }

    return [];
  }

  /**
   * Extract dependencies from Maven pom.xml
   */
  async extractFromMaven(pomPath: string): Promise<Dependency[]> {
    try {
      if (!(await fs.pathExists(pomPath))) {
        return [];
      }

      const content = await fs.readFile(pomPath, 'utf-8');
      const dependencies: Dependency[] = [];

      // Parse XML using regex (simple approach for MVP)
      // In production, use a proper XML parser like 'fast-xml-parser'
      const dependencyPattern = /<dependency>\s*<groupId>(.*?)<\/groupId>\s*<artifactId>(.*?)<\/artifactId>\s*<version>(.*?)<\/version>(?:\s*<scope>(.*?)<\/scope>)?/gs;

      let match;
      while ((match = dependencyPattern.exec(content)) !== null) {
        const [, groupId, artifactId, version, scope] = match;

        dependencies.push({
          name: artifactId.trim(),
          version: version.trim(),
          type: 'maven',
          scope: this.mapMavenScope(scope?.trim() || 'compile'),
          source: pomPath,
          isDirect: true,
        });
      }

      return dependencies;
    } catch (error) {
      console.warn(`Failed to parse Maven pom.xml: ${error}`);
      return [];
    }
  }

  /**
   * Extract dependencies from Gradle build.gradle
   */
  async extractFromGradle(gradlePath: string): Promise<Dependency[]> {
    try {
      if (!(await fs.pathExists(gradlePath))) {
        return [];
      }

      const content = await fs.readFile(gradlePath, 'utf-8');
      const dependencies: Dependency[] = [];

      // Parse Gradle dependencies using regex
      // Matches: implementation 'group:artifact:version'
      // Matches: testImplementation 'group:artifact:version'
      const dependencyPattern = /(implementation|testImplementation|runtimeOnly|compileOnly|api)\s+['"]([^:]+):([^:]+):([^'"]+)['"]/g;

      let match;
      while ((match = dependencyPattern.exec(content)) !== null) {
        const [, scope, groupId, artifactId, version] = match;

        dependencies.push({
          name: artifactId.trim(),
          version: version.trim(),
          type: 'maven', // Gradle uses Maven repositories
          scope: this.mapGradleScope(scope.trim()),
          source: gradlePath,
          isDirect: true,
        });
      }

      return dependencies;
    } catch (error) {
      console.warn(`Failed to parse Gradle build.gradle: ${error}`);
      return [];
    }
  }

  /**
   * Map Maven scope to standard DependencyScope
   */
  private mapMavenScope(scope: JavaDependencyScope): DependencyScope {
    switch (scope) {
      case 'compile':
        return 'runtime';
      case 'test':
        return 'development';
      case 'runtime':
        return 'runtime';
      case 'provided':
        return 'optional';
      default:
        return 'runtime';
    }
  }

  /**
   * Map Gradle scope to standard DependencyScope
   */
  private mapGradleScope(scope: string): DependencyScope {
    switch (scope) {
      case 'implementation':
      case 'api':
        return 'runtime';
      case 'testImplementation':
        return 'development';
      case 'runtimeOnly':
        return 'runtime';
      case 'compileOnly':
        return 'optional';
      default:
        return 'runtime';
    }
  }
}
