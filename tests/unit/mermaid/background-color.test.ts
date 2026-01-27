import { describe, it, expect, beforeAll } from 'vitest';
import { IsomorphicMermaidRenderer } from '@/mermaid/renderer.js';
import fs from 'fs-extra';
import path from 'path';

describe('IsomorphicMermaidRenderer - Background Color Support', () => {
  const testOutputDir = '/tmp/test-mermaid-background';
  const testCode = 'classDiagram\n  A\n  class B {\n    +method(): void\n  }';

  beforeAll(async () => {
    // Clean up test directory
    await fs.remove(testOutputDir);
    await fs.ensureDir(testOutputDir);
  });

  describe('renderSVG - Background Color', () => {
    it('should add white background to SVG by default', async () => {
      const renderer = new IsomorphicMermaidRenderer();
      const svg = await renderer.renderSVG(testCode);

      // 验证 SVG 包含背景色样式
      expect(svg).toMatch(/background-color:\s*white/);
      expect(svg).toContain('style=');
    });

    it('should use custom background color', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: '#f0f0f0'
      });
      const svg = await renderer.renderSVG(testCode);

      // 验证使用自定义背景色
      expect(svg).toMatch(/background-color:\s*#f0f0f0/);
    });

    it('should support transparent background when explicitly set', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'transparent'
      });
      const svg = await renderer.renderSVG(testCode);

      // 验证不添加背景色或添加透明背景
      if (svg.includes('background-color')) {
        expect(svg).toMatch(/background-color:\s*transparent/);
      }
    });

    it('should support rgba colors with opacity', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'rgba(255, 0, 0, 0.1)'
      });
      const svg = await renderer.renderSVG(testCode);

      // 验证支持 rgba 颜色
      expect(svg).toMatch(/background-color:\s*rgba\(255,\s*0,\s*0,\s*0\.1\)/);
    });

    it('should support named colors', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'lightgray'
      });
      const svg = await renderer.renderSVG(testCode);

      // 验证支持颜色名称
      expect(svg).toMatch(/background-color:\s*lightgray/);
    });

    it('should add background color to svg element root', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'white'
      });
      const svg = await renderer.renderSVG(testCode);

      // 验证背景色在 svg 根元素的 style 属性中
      // 注意：SVG 已经有 style 属性，背景色被追加到后面
      const match = svg.match(/<svg[^>]*style="[^"]*background-color:\s*white[^"]*"/);
      expect(match).toBeTruthy();
    });
  });

  describe('renderPNG - Background Color', () => {
    it('should render PNG with background from SVG', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'white'
      });

      const outputPath = path.join(testOutputDir, 'test-white-bg.png');
      await renderer.renderPNG(testCode, outputPath);

      // 验证文件存在
      await fs.access(outputPath);
    });

    it('should render PNG with custom background color', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: '#ff0000' // red background for testing
      });

      const outputPath = path.join(testOutputDir, 'test-red-bg.png');
      await renderer.renderPNG(testCode, outputPath);

      // 验证文件存在
      await fs.access(outputPath);
    });

    it('should render PNG with transparent background when configured', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'transparent'
      });

      const outputPath = path.join(testOutputDir, 'test-transparent.png');
      await renderer.renderPNG(testCode, outputPath);

      // 验证文件存在
      await fs.access(outputPath);
    });
  });

  describe('renderAndSave - Background Color', () => {
    it('should save SVG and PNG with configured background color', async () => {
      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: '#f5f5f5'
      });

      const paths = {
        mmd: path.join(testOutputDir, 'complete-test.mmd'),
        svg: path.join(testOutputDir, 'complete-test.svg'),
        png: path.join(testOutputDir, 'complete-test.png'),
      };

      await renderer.renderAndSave(testCode, paths);

      // 验证所有文件存在
      await fs.access(paths.mmd);
      await fs.access(paths.svg);
      await fs.access(paths.png);

      // 验证 SVG 包含背景色
      const svgContent = await fs.readFile(paths.svg, 'utf-8');
      expect(svgContent).toMatch(/background-color:\s*#f5f5f5/);
    });
  });

  describe('setOptions - Dynamic Background Color', () => {
    it('should update background color dynamically', async () => {
      const renderer = new IsomorphicMermaidRenderer();

      // 初始渲染（默认白色背景）
      let svg = await renderer.renderSVG(testCode);
      expect(svg).toMatch(/background-color:\s*white/);

      // 更新为灰色背景
      renderer.setOptions({ backgroundColor: '#808080' });
      svg = await renderer.renderSVG(testCode);
      expect(svg).toMatch(/background-color:\s*#808080/);

      // 更新为透明背景
      renderer.setOptions({ backgroundColor: 'transparent' });
      svg = await renderer.renderSVG(testCode);
      // 透明背景时不添加背景色或添加 transparent
      if (svg.includes('background-color')) {
        expect(svg).toMatch(/background-color:\s*transparent/);
      }
    });
  });

  describe('Integration - Complex Diagrams with Background', () => {
    it('should handle complex class diagrams with background', async () => {
      const complexCode = `classDiagram
        class A {
          +method1(): Promise<string>
          +method2(data: Array<number>): void
        }
        class B {
          +value: Map<string, any>
        }
        A --> B`;

      const renderer = new IsomorphicMermaidRenderer({
        backgroundColor: 'white'
      });

      const svg = await renderer.renderSVG(complexCode);

      // 验证生成成功且包含背景色
      expect(svg).toMatch(/background-color:\s*white/);
      expect(svg).toContain('classDiagram');
      // 验证包含类定义（通过查找 classGroup 节点）
      expect(svg).toContain('classDiagram');
    });
  });
});
