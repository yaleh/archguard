#!/usr/bin/env node

/**
 * 准确分析 SVG 文件的边界
 */

import fs from 'fs-extra';
import * as path from 'path';

interface SVGBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  elements: {
    rects: number;
    texts: number;
    lines: number;
  };
}

function analyzeSVGBounds(svgPath: string): SVGBounds {
  const svgContent = fs.readFileSync(svgPath, 'utf-8');

  // 提取 viewBox
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].split(' ').map(Number) : null;

  // 分析矩形
  const rectMatches = svgContent.matchAll(/<rect[^>]*>/g);
  const bounds: SVGBounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    elements: { rects: 0, texts: 0, lines: 0 }
  };

  for (const match of rectMatches) {
    bounds.elements.rects++;
    const x = match[0].match(/x="(\d+)"/);
    const y = match[0].match(/y="(\d+)"/);
    const width = match[0].match(/width="(\d+)"/);
    const height = match[0].match(/height="(\d+)"/);

    if (x && y && width && height) {
      const numX = parseInt(x[1]);
      const numY = parseInt(y[1]);
      const numW = parseInt(width[1]);
      const numH = parseInt(height[1]);

      bounds.minX = Math.min(bounds.minX, numX);
      bounds.maxX = Math.max(bounds.maxX, numX + numW);
      bounds.minY = Math.min(bounds.minY, numY);
      bounds.maxY = Math.max(bounds.maxY, numY + numH);
    }
  }

  // 分析文本（通常在矩形内，不需要额外计算边界）
  const textMatches = svgContent.match(/<text/g);
  bounds.elements.texts = textMatches ? textMatches.length : 0;

  // 分析线条
  const lineMatches = svgContent.matchAll(/<line[^>]*>/g);
  for (const match of lineMatches) {
    bounds.elements.lines++;
    const x1 = match[0].match(/x1="(\d+)"/);
    const y1 = match[0].match(/y1="(\d+)"/);
    const x2 = match[0].match(/x2="(\d+)"/);
    const y2 = match[0].match(/y2="(\d+)"/);

    if (x1) bounds.minX = Math.min(bounds.minX, parseInt(x1[1]));
    if (x2) bounds.maxX = Math.max(bounds.maxX, parseInt(x2[1]));
    if (y1) bounds.minY = Math.min(bounds.minY, parseInt(y1[1]));
    if (y2) bounds.maxY = Math.max(bounds.maxY, parseInt(y2[1]));
  }

  return bounds;
}

async function main() {
  const testDir = '/home/yale/work/archguard/experiments/elk-layout-experiment/results/real-file-test';
  const allFiles = await fs.readdir(testDir);
  const files = allFiles.filter((f: string) => f.endsWith('.svg'));

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║     SVG 边界分析 - cli-method.mmd 渲染结果              ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  for (const file of files) {
    const svgPath = path.join(testDir, file);
    const bounds = analyzeSVGBounds(svgPath);

    // 读取 viewBox
    const svgContent = await fs.readFile(svgPath, 'utf-8');
    const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1].split(' ').map(Number) : null;

    if (!viewBox) continue;

    const viewBoxWidth = viewBox[2];
    const viewBoxHeight = viewBox[3];
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const overflowX = Math.max(0, contentWidth - viewBoxWidth);
    const overflowY = Math.max(0, contentHeight - viewBoxHeight);
    const aspectRatio = viewBoxWidth / viewBoxHeight;

    console.log(`📄 ${file}`);
    console.log(`   viewBox: ${viewBoxWidth}×${viewBoxHeight}px`);
    console.log(`   内容边界: ${contentWidth}×${contentHeight}px`);
    console.log(`   内容范围: X[${bounds.minX}, ${bounds.maxX}], Y[${bounds.minY}, ${bounds.maxY}]`);
    console.log(`   宽高比: ${aspectRatio.toFixed(2)}:1`);
    console.log(`   溢出: X=${overflowX}px, Y=${overflowY}px ${overflowY === 0 ? '✅' : '❌'}`);
    console.log(`   元素: ${bounds.elements.rects} 节点, ${bounds.elements.lines} 边`);
    console.log(`   结论: ${overflowY === 0 && aspectRatio >= 0.5 && aspectRatio <= 2.0 ? '✅ 完美' : overflowY > 0 ? '❌ 内容被截断' : '⚠️  宽高比异常'}`);
    console.log(``);
  }

  console.log(`${'='.repeat(70)}`);
  console.log(`分析完成！`);
  console.log(`${'='.repeat(70)}`);
}

main().catch(console.error);
