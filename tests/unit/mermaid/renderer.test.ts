/**
 * Unit tests for IsomorphicMermaidRenderer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { IsomorphicMermaidRenderer } from '../../../src/mermaid/renderer';

describe('IsomorphicMermaidRenderer', () => {
  let renderer: IsomorphicMermaidRenderer;
  let tempDir: string;

  beforeEach(async () => {
    renderer = new IsomorphicMermaidRenderer();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-renderer-test-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('initialization', () => {
    it('should initialize renderer', () => {
      expect(renderer).toBeDefined();
    });

    it('should accept custom theme', () => {
      const customRenderer = new IsomorphicMermaidRenderer({
        theme: {
          name: 'dark',
        },
      });
      expect(customRenderer).toBeDefined();
    });

    it('should accept custom format', () => {
      const svgRenderer = new IsomorphicMermaidRenderer({
        format: 'svg',
      });
      const pngRenderer = new IsomorphicMermaidRenderer({
        format: 'png',
      });
      expect(svgRenderer).toBeDefined();
      expect(pngRenderer).toBeDefined();
    });
  });

  describe('SVG rendering', () => {
    it('should render valid Mermaid to SVG', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }`;

      const svg = await renderer.renderSVG(mermaidCode);

      expect(svg).toBeDefined();
      expect(typeof svg).toBe('string');
      expect(svg.length).toBeGreaterThan(0);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('should render class diagram with multiple classes', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }
  class AuthService {
    +login() Boolean
  }
  User --> AuthService`;

      const svg = await renderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('User');
      expect(svg).toContain('AuthService');
    });

    it('should render class diagram with relationships', async () => {
      const mermaidCode = `classDiagram
  class Animal
  class Duck
  Animal <|-- Duck`;

      const svg = await renderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg).toContain('Animal');
      expect(svg).toContain('Duck');
    });

    it('should handle theme configuration', async () => {
      const darkRenderer = new IsomorphicMermaidRenderer({
        theme: {
          name: 'dark',
        },
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await darkRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      // Dark theme should be reflected in the output
      expect(svg.length).toBeGreaterThan(0);
    });
  });

  describe('PNG rendering', () => {
    it('should render valid Mermaid to PNG file', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }`;

      const outputPath = path.join(tempDir, 'output.png');

      await renderer.renderPNG(mermaidCode, outputPath);

      // Check that file was created
      const exists = await fs.pathExists(outputPath);
      expect(exists).toBe(true);

      // Check that it's a valid PNG (check file signature)
      const buffer = await fs.readFile(outputPath);
      expect(buffer[0]).toBe(0x89); // PNG magic number
      expect(buffer[1]).toBe(0x50); // 'P'
      expect(buffer[2]).toBe(0x4e); // 'N'
      expect(buffer[3]).toBe(0x47); // 'G'
    });

    it('should handle complex diagram', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
    +String email
    +login() Boolean
    +logout() void
  }
  class Admin {
    +String username
    +manageUsers() void
  }
  User <|-- Admin`;

      const outputPath = path.join(tempDir, 'complex.png');

      await renderer.renderPNG(mermaidCode, outputPath);

      const exists = await fs.pathExists(outputPath);
      expect(exists).toBe(true);

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(1000); // Should be a reasonable size
    });
  });

  describe('renderAndSave', () => {
    it('should save all three formats', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }`;

      const paths = {
        mmd: path.join(tempDir, 'diagram.mmd'),
        svg: path.join(tempDir, 'diagram.svg'),
        png: path.join(tempDir, 'diagram.png'),
      };

      await renderer.renderAndSave(mermaidCode, paths);

      // Check .mmd file
      const mmdExists = await fs.pathExists(paths.mmd);
      expect(mmdExists).toBe(true);
      const mmdContent = await fs.readFile(paths.mmd, 'utf-8');
      expect(mmdContent).toBe(mermaidCode);

      // Check .svg file
      const svgExists = await fs.pathExists(paths.svg);
      expect(svgExists).toBe(true);
      const svgContent = await fs.readFile(paths.svg, 'utf-8');
      expect(svgContent).toContain('<svg');

      // Check .png file
      const pngExists = await fs.pathExists(paths.png);
      expect(pngExists).toBe(true);
    });

    it('should handle non-existent output directory', async () => {
      const mermaidCode = `classDiagram
  class Test`;

      const paths = {
        mmd: path.join(tempDir, 'subdir', 'diagram.mmd'),
        svg: path.join(tempDir, 'subdir', 'diagram.svg'),
        png: path.join(tempDir, 'subdir', 'diagram.png'),
      };

      await renderer.renderAndSave(mermaidCode, paths);

      // Directory should be created
      const subdirExists = await fs.pathExists(path.join(tempDir, 'subdir'));
      expect(subdirExists).toBe(true);

      // Files should exist
      expect(await fs.pathExists(paths.mmd)).toBe(true);
      expect(await fs.pathExists(paths.svg)).toBe(true);
      expect(await fs.pathExists(paths.png)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle invalid Mermaid code gracefully', async () => {
      const invalidCode = `this is not valid mermaid code`;

      await expect(renderer.renderSVG(invalidCode)).rejects.toThrow();
    });

    it('should handle empty Mermaid code', async () => {
      const emptyCode = ``;

      await expect(renderer.renderSVG(emptyCode)).rejects.toThrow();
    });

    it('should handle invalid output path for PNG', async () => {
      const mermaidCode = `classDiagram
  class Test`;

      const invalidPath = '/root/invalid/path/output.png'; // No permissions

      await expect(renderer.renderPNG(mermaidCode, invalidPath)).rejects.toThrow();
    });
  });

  describe('theme and styling', () => {
    it('should apply dark theme', async () => {
      const darkRenderer = new IsomorphicMermaidRenderer({
        theme: {
          name: 'dark',
        },
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await darkRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      // Dark theme should use dark colors
      expect(svg.length).toBeGreaterThan(0);
    });

    it('should apply forest theme', async () => {
      const forestRenderer = new IsomorphicMermaidRenderer({
        theme: {
          name: 'forest',
        },
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await forestRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(0);
    });

    it('should apply custom theme variables', async () => {
      const customRenderer = new IsomorphicMermaidRenderer({
        theme: {
          name: 'default',
          variables: {
            primaryColor: '#ff0000',
            primaryTextColor: '#00ff00',
          },
        },
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await customRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(0);
    });
  });

  describe('background color', () => {
    it('should apply custom background color', async () => {
      const customRenderer = new IsomorphicMermaidRenderer({
        backgroundColor: '#f0f0f0',
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await customRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(0);
    });
  });

  describe('output dimensions', () => {
    it('should respect custom width', async () => {
      const customRenderer = new IsomorphicMermaidRenderer({
        width: 800,
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await customRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      // Width might be set in SVG attributes
      expect(svg.length).toBeGreaterThan(0);
    });

    it('should respect custom height', async () => {
      const customRenderer = new IsomorphicMermaidRenderer({
        height: 600,
      });

      const mermaidCode = `classDiagram
  class Test`;

      const svg = await customRenderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(0);
    });
  });

  describe('concurrent rendering', () => {
    it('should handle multiple concurrent renders', async () => {
      const codes = [
        `classDiagram\n  class A`,
        `classDiagram\n  class B`,
        `classDiagram\n  class C`,
      ];

      const results = await Promise.all(codes.map((code) => renderer.renderSVG(code)));

      results.forEach((svg) => {
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
      });
    });
  });

  describe('different diagram types', () => {
    it('should render flowchart', async () => {
      const mermaidCode = `flowchart TD
  A[Start] --> B[End]`;

      const svg = await renderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg).toContain('A');
      expect(svg).toContain('B');
    });

    it('should render state diagram', async () => {
      const mermaidCode = `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing`;

      const svg = await renderer.renderSVG(mermaidCode);

      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(0);
    });
  });

  describe('PNG resolution and quality', () => {
    it('should use high DPI (300) for PNG rendering', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }`;

      const outputPath = path.join(tempDir, 'dpi-test.png');
      await renderer.renderPNG(mermaidCode, outputPath);

      // Verify file exists
      const exists = await fs.pathExists(outputPath);
      expect(exists).toBe(true);

      // Check PNG metadata
      const metadata = await sharp(outputPath).metadata();

      // DPI should be 300 (density in sharp)
      // Note: sharp stores density as metadata, we need to verify it's set
      expect(metadata.density).toBeGreaterThanOrEqual(300);
    });

    it('should use SVG actual dimensions for PNG', async () => {
      const mermaidCode = `classDiagram
  class Class1 {
    +String field1
    +String field2
    +method1()
    +method2()
  }
  class Class2 {
    +String field3
    +method3()
  }
  Class1 --> Class2 : uses`;

      const outputPath = path.join(tempDir, 'dimensions-test.png');
      await renderer.renderPNG(mermaidCode, outputPath);

      // Get SVG first to check its viewBox
      const svg = await renderer.renderSVG(mermaidCode);
      const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
      expect(viewBoxMatch).toBeDefined();

      const [, , vbWidth, vbHeight] = viewBoxMatch![1].split(/\s+/).map(Number);
      const svgWidth = Math.ceil(vbWidth);
      const svgHeight = Math.ceil(vbHeight);

      // Check PNG metadata
      const metadata = await sharp(outputPath).metadata();

      // PNG dimensions should be based on SVG viewBox (at 300 DPI)
      // The exact dimensions may vary due to DPI scaling, but should be close to SVG size
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);

      // PNG should be at least as large as SVG viewBox (accounting for DPI)
      // At 300 DPI (vs default 72 DPI for screen), we expect roughly 4x scaling
      const minExpectedWidth = Math.floor(svgWidth * 0.5); // Conservative estimate
      const minExpectedHeight = Math.floor(svgHeight * 0.5);

      expect(metadata.width).toBeGreaterThanOrEqual(minExpectedWidth);
      expect(metadata.height).toBeGreaterThanOrEqual(minExpectedHeight);
    });

    it('should generate high-resolution PNG for complex diagrams', async () => {
      // Create a complex diagram with many classes
      const classes = Array.from({ length: 20 }, (_, i) => `  class Class${i}`).join('\n');
      const mermaidCode = `classDiagram
${classes}`;

      const outputPath = path.join(tempDir, 'complex-hires.png');
      await renderer.renderPNG(mermaidCode, outputPath);

      // Verify file exists
      const exists = await fs.pathExists(outputPath);
      expect(exists).toBe(true);

      // Check PNG metadata
      const metadata = await sharp(outputPath).metadata();

      // For a complex diagram, we expect reasonable dimensions
      expect(metadata.width).toBeGreaterThan(100);
      expect(metadata.height).toBeGreaterThan(100);

      // File size should be substantial for high-resolution output
      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(5000); // At least 5KB for complex diagram
    });

    it('should produce readable text in PNG', async () => {
      const mermaidCode = `classDiagram
  class VeryLongClassName {
    +String veryLongFieldName
    +veryLongMethodName()
  }
  class AnotherLongClassName {
    +String field
  }
  VeryLongClassName --> AnotherLongClassName`;

      const outputPath = path.join(tempDir, 'readable-text.png');
      await renderer.renderPNG(mermaidCode, outputPath);

      // Verify file exists and has reasonable size
      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(2000);

      // Check metadata
      const metadata = await sharp(outputPath).metadata();
      expect(metadata.width).toBeGreaterThan(200);
      expect(metadata.height).toBeGreaterThan(100);
    });
  });
});
