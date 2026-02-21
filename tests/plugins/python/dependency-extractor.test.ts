/**
 * Tests for Python DependencyExtractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { DependencyExtractor } from '@/plugins/python/dependency-extractor.js';
import type { Dependency } from '@/core/interfaces/dependency.js';

describe('DependencyExtractor', () => {
  let extractor: DependencyExtractor;
  let tempDir: string;

  beforeEach(async () => {
    extractor = new DependencyExtractor();
    tempDir = path.join(process.cwd(), 'test-temp-python-deps');
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('extractDependencies', () => {
    describe('requirements.txt', () => {
      it('should parse simple requirements.txt', async () => {
        const requirementsTxt = `
flask==2.0.1
requests>=2.25.0
numpy
        `.trim();

        await fs.writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt);

        const deps = await extractor.extractDependencies(tempDir);

        expect(deps).toHaveLength(3);

        const flask = deps.find(d => d.name === 'flask');
        expect(flask).toBeDefined();
        expect(flask?.version).toBe('==2.0.1');
        expect(flask?.type).toBe('pip');
        expect(flask?.scope).toBe('runtime');
        expect(flask?.source).toBe('requirements.txt');
        expect(flask?.isDirect).toBe(true);

        const requests = deps.find(d => d.name === 'requests');
        expect(requests).toBeDefined();
        expect(requests?.version).toBe('>=2.25.0');

        const numpy = deps.find(d => d.name === 'numpy');
        expect(numpy).toBeDefined();
        expect(numpy?.version).toBe('*'); // No version constraint
      });

      it('should handle version specifiers', async () => {
        const requirementsTxt = `
django>=3.2,<4.0
pytest~=6.2.0
black==21.5b1
        `.trim();

        await fs.writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt);

        const deps = await extractor.extractDependencies(tempDir);

        expect(deps).toHaveLength(3);

        const django = deps.find(d => d.name === 'django');
        expect(django?.version).toBe('>=3.2,<4.0');

        const pytest = deps.find(d => d.name === 'pytest');
        expect(pytest?.version).toBe('~=6.2.0');

        const black = deps.find(d => d.name === 'black');
        expect(black?.version).toBe('==21.5b1');
      });

      it('should ignore comments and empty lines', async () => {
        const requirementsTxt = `
# This is a comment
flask==2.0.1

# Another comment
requests>=2.25.0
        `.trim();

        await fs.writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt);

        const deps = await extractor.extractDependencies(tempDir);

        expect(deps).toHaveLength(2);
        expect(deps.map(d => d.name).sort()).toEqual(['flask', 'requests']);
      });

      it('should handle extras and markers', async () => {
        const requirementsTxt = `
requests[security]==2.25.0
pytest>=6.0; python_version >= "3.6"
        `.trim();

        await fs.writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt);

        const deps = await extractor.extractDependencies(tempDir);

        expect(deps).toHaveLength(2);

        // Should extract package name without extras
        const requests = deps.find(d => d.name === 'requests');
        expect(requests).toBeDefined();
        expect(requests?.version).toBe('==2.25.0');

        const pytest = deps.find(d => d.name === 'pytest');
        expect(pytest).toBeDefined();
      });
    });

    describe('pyproject.toml (Poetry)', () => {
      it('should parse Poetry dependencies', async () => {
        const pyprojectToml = `
[tool.poetry]
name = "test-project"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.8"
flask = "^2.0.0"

[tool.poetry.dev-dependencies]
pytest = "^6.2.0"
        `.trim();

        await fs.writeFile(path.join(tempDir, 'pyproject.toml'), pyprojectToml);

        const deps = await extractor.extractDependencies(tempDir);

        // Should have at least flask and pytest
        expect(deps.length).toBeGreaterThanOrEqual(2);

        const flask = deps.find(d => d.name === 'flask');
        expect(flask).toBeDefined();
        expect(flask?.type).toBe('pip');
        expect(flask?.scope).toBe('runtime');
        expect(flask?.source).toBe('pyproject.toml');

        const pytest = deps.find(d => d.name === 'pytest');
        expect(pytest).toBeDefined();
        expect(pytest?.scope).toBe('development');
      });

      it('should handle complex dependency formats', async () => {
        const pyprojectToml = `
[tool.poetry]
name = "test-project"

[tool.poetry.dependencies]
python = "^3.8"
flask = { version = "^2.0.0" }
        `.trim();

        await fs.writeFile(path.join(tempDir, 'pyproject.toml'), pyprojectToml);

        const deps = await extractor.extractDependencies(tempDir);

        const flask = deps.find(d => d.name === 'flask');
        expect(flask).toBeDefined();
        expect(flask?.version).toBe('^2.0.0');
      });
    });

    describe('priority and edge cases', () => {
      it('should prioritize pyproject.toml over requirements.txt when pyproject exists', async () => {
        const requirementsTxt = `flask==1.0.0`;
        const pyprojectToml = `
[tool.poetry]
name = "test-project"

[tool.poetry.dependencies]
python = "^3.8"
flask = "^2.0.0"
        `.trim();

        await fs.writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt);
        await fs.writeFile(path.join(tempDir, 'pyproject.toml'), pyprojectToml);

        const deps = await extractor.extractDependencies(tempDir);

        // When pyproject.toml exists, it should be used instead of requirements.txt
        const flask = deps.find(d => d.name === 'flask');
        expect(flask).toBeDefined();
        expect(flask?.source).toBe('pyproject.toml');
      });

      it('should return empty array when no dependency files found', async () => {
        const deps = await extractor.extractDependencies(tempDir);
        expect(deps).toEqual([]);
      });

      it('should handle malformed requirements.txt gracefully', async () => {
        const requirementsTxt = `
flask==2.0.1
this is not a valid requirement
requests>=2.25.0
        `.trim();

        await fs.writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt);

        const deps = await extractor.extractDependencies(tempDir);

        // Should still parse valid lines
        expect(deps.length).toBeGreaterThanOrEqual(2);
        expect(deps.find(d => d.name === 'flask')).toBeDefined();
        expect(deps.find(d => d.name === 'requests')).toBeDefined();
      });

      it('should handle malformed pyproject.toml gracefully', async () => {
        const pyprojectToml = `
[tool.poetry
name = "test-project"
invalid toml syntax
        `.trim();

        await fs.writeFile(path.join(tempDir, 'pyproject.toml'), pyprojectToml);

        const deps = await extractor.extractDependencies(tempDir);

        // Should return empty array or minimal dependencies
        expect(deps.length).toBeLessThanOrEqual(1);
      });
    });
  });
});
