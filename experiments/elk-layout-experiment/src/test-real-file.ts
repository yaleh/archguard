#!/usr/bin/env node

/**
 * 测试真实的 cli-method.mmd 文件
 * 验证 Plan B (Direct ELK) 能够正确渲染大型文件
 */

import fs from 'fs-extra';
import * as path from 'path';
import { parseMermaidClassDiagram, archjsonToELK } from './plan-b/archjson-elk.js';
import { layoutGraph } from './plan-b/elk-adapter.js';
import { generateSVGFromELK } from './plan-b/svg-generator.js';

interface TestConfig {
  name: string;
  mermaidPath: string;
  aspectRatio: number;
  direction: 'DOWN' | 'RIGHT';
}

async function testRealFile(config: TestConfig): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`测试文件: ${config.name}`);
  console.log(`Mermaid 文件: ${config.mermaidPath}`);
  console.log(`目标宽高比: ${config.aspectRatio}`);
  console.log(`布局方向: ${config.direction}`);
  console.log(`${'='.repeat(70)}\n`);

  // 读取 Mermaid 文件
  const mermaidCode = await fs.readFile(config.mermaidPath, 'utf-8');

  // 统计信息
  const classCount = (mermaidCode.match(/^    class /gm) || []).length;
  const lineCount = mermaidCode.split('\n').length;

  console.log(`文件统计:`);
  console.log(`  总行数: ${lineCount}`);
  console.log(`  类数量: ${classCount}`);
  console.log(`  复杂度: ${classCount < 10 ? '简单' : classCount < 20 ? '中等' : '复杂'}`);
  console.log(``);

  // 解析为 ArchJSON
  console.log(`步骤 1: 解析 Mermaid → ArchJSON`);
  const archjson = parseMermaidClassDiagram(mermaidCode);
  console.log(`  ✓ 解析完成`);
  console.log(`  实体数: ${archjson.entities.length}`);
  console.log(`  关系数: ${archjson.relations.length}`);
  console.log(``);

  // 转换为 ELK 图
  console.log(`步骤 2: 转换 ArchJSON → ELK Graph`);
  const elkGraph = archjsonToELK(archjson);
  console.log(`  ✓ 转换完成`);
  console.log(``);

  // 执行布局
  console.log(`步骤 3: 应用 ELK 布局`);
  const layoutOptions = {
    'elk.aspectRatio': config.aspectRatio.toString(),
    'elk.direction': config.direction,
    'elk.algorithm': 'layered',
    'elk.spacing.nodeNode': '50'
  };

  const layoutResult = await layoutGraph(elkGraph, layoutOptions);

  if (!layoutResult.success) {
    console.error(`  ✗ 布局失败: ${layoutResult.error}`);
    return;
  }

  console.log(`  ✓ 布局完成`);
  console.log(`  计算宽度: ${layoutResult.width}px`);
  console.log(`  计算高度: ${layoutResult.height}px`);

  const actualAspectRatio = layoutResult.width / layoutResult.height;
  console.log(`  实际宽高比: ${actualAspectRatio.toFixed(2)}:1`);

  const isAcceptable = actualAspectRatio >= 0.5 && actualAspectRatio <= 2.0;
  console.log(`  目标范围: 0.5-2.0`);
  console.log(`  是否达标: ${isAcceptable ? '✓ 是' : '✗ 否'}`);
  console.log(``);

  // 生成 SVG
  console.log(`步骤 4: 生成 SVG 和 PNG`);
  const outputDir = path.join(process.cwd(), 'results', 'real-file-test');
  await fs.ensureDir(outputDir);

  const svgResult = await generateSVGFromELK(layoutResult.layout, {
    outputDir,
    filename: `${config.name}-${config.direction}-ar${config.aspectRatio}`,
    theme: 'light'
  });

  if (!svgResult.success) {
    console.error(`  ✗ SVG 生成失败: ${svgResult.error}`);
    return;
  }

  console.log(`  ✓ SVG 生成完成`);
  console.log(`  SVG 路径: ${svgResult.svgPath}`);
  console.log(`  PNG 路径: ${svgResult.pngPath}`);
  console.log(``);

  // 验证 SVG 内容
  const svgContent = await fs.readFile(svgResult.svgPath, 'utf-8');
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].split(' ').map(Number) : null;

  if (viewBox) {
    console.log(`SVG 验证:`);
    console.log(`  viewBox 宽度: ${viewBox[2]}px`);
    console.log(`  viewBox 高度: ${viewBox[3]}px`);

    // 检查是否有元素超出 viewBox
    const maxYMatch = svgContent.match(/y="(\d+)"/g);
    if (maxYMatch) {
      const maxY = Math.max(...maxYMatch.map(m => parseInt(m.replace('y=', '').replace('"', ''))));
      const rectHeightMatch = svgContent.match(/height="(\d+)"/g);
      const maxRectHeight = rectHeightMatch
        ? Math.max(...rectHeightMatch.map(m => parseInt(m.replace('height=', '').replace('"', ''))))
        : 0;

      const maxContentY = maxY + maxRectHeight;
      const overflow = maxContentY - viewBox[3];

      console.log(`  内容最大 Y: ${maxContentY}px`);
      console.log(`  内容溢出: ${overflow > 0 ? overflow + 'px ❌' : '无 ✅'}`);
    }

    // 统计元素数量
    const rectCount = (svgContent.match(/<rect/g) || []).length;
    const textCount = (svgContent.match(/<text/g) || []).length;
    const lineCount = (svgContent.match(/<line/g) || []).length;

    console.log(``);
    console.log(`SVG 元素统计:`);
    console.log(`  矩形 (节点): ${rectCount}`);
    console.log(`  文本 (标签): ${textCount}`);
    console.log(`  线条 (边): ${lineCount}`);
  }

  console.log(``);
  console.log(`${'='.repeat(70)}`);
  console.log(`测试完成！`);
  console.log(`${'='.repeat(70)}`);
}

async function main() {
  const cliMethodPath = '/home/yale/work/archguard/archguard-self-analysis/cli-method.mmd';

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║     Plan B 真实文件测试 - cli-method.mmd                 ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);

  // 测试不同配置
  const tests: TestConfig[] = [
    {
      name: 'cli-method',
      mermaidPath: cliMethodPath,
      aspectRatio: 1.5,
      direction: 'DOWN'
    },
    {
      name: 'cli-method',
      mermaidPath: cliMethodPath,
      aspectRatio: 1.5,
      direction: 'RIGHT'
    },
    {
      name: 'cli-method',
      mermaidPath: cliMethodPath,
      aspectRatio: 1.0,
      direction: 'DOWN'
    }
  ];

  for (const test of tests) {
    await testRealFile(test);
  }

  console.log(`\n所有测试完成！结果保存在: experiments/elk-layout-experiment/results/real-file-test/\n`);
}

main().catch(console.error);
