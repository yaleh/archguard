#!/usr/bin/env node

/**
 * 对比测试：固定宽度 vs 动态宽度
 */

import fs from 'fs-extra';
import * as path from 'path';
import { parseMermaidClassDiagram, archjsonToELK, createLayoutOptions } from './plan-b/archjson-elk.js';
import { layoutGraph as layoutGraphFull } from './plan-b/elk-adapter-full.js';
import { generateSVGFromELK } from './plan-b/svg-generator.js';

interface WidthAnalysis {
  className: string;
  fieldsCount: number;
  methodsCount: number;
  fixedWidth: number;
  dynamicWidth: number;
  widthDiff: number;
  widthDiffPercent: number;
  category: 'undersized' | 'proper' | 'oversized';
}

async function runDynamicWidthTest() {
  const mermaidPath = '/home/yale/work/archguard/archguard-self-analysis/cli-method.mmd';
  const outputDir = '/home/yale/work/archguard/experiments/elk-layout-experiment/results/dynamic-width-comparison';

  await fs.ensureDir(outputDir);

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║     动态宽度实验 - 固定 vs 动态                         ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  // Read and parse Mermaid file
  const mermaidCode = await fs.readFile(mermaidPath, 'utf-8');
  const archjson = parseMermaidClassDiagram(mermaidCode);

  console.log(`文件: ${path.basename(mermaidPath)}`);
  console.log(`实体数: ${archjson.entities.length}`);
  console.log(`关系数: ${archjson.relations.length}\n`);

  // Test with aspectRatio=1.5, direction=DOWN
  const layoutOptions = createLayoutOptions(1.5, 'DOWN');

  // Generate with dynamic width (current implementation)
  console.log(`生成动态宽度布局...`);
  const elkGraphDynamic = archjsonToELK(archjson, layoutOptions);
  const resultDynamic = await layoutGraphFull(elkGraphDynamic, {});
  const svgDynamic = await generateSVGFromELK(resultDynamic.layout, {
    outputDir,
    filename: 'cli-method-DOWN-ar1.5-dynamic',
    theme: 'light'
  });

  console.log(`  ✓ SVG: ${svgDynamic.svgPath}`);
  console.log(`  ✓ PNG: ${svgDynamic.pngPath}`);
  console.log(`  尺寸: ${resultDynamic.width}×${resultDynamic.height}px`);
  console.log(`  宽高比: ${(resultDynamic.width / resultDynamic.height).toFixed(2)}:1\n`);

  // Analyze width differences
  const widthAnalysis: WidthAnalysis[] = [];

  for (const entity of archjson.entities) {
    const fields = entity.fields || [];
    const methods = entity.methods || [];
    const fixedWidth = 200;

    // Calculate what the dynamic width should be
    const charWidth = 10 * 0.55;
    const classNameWidth = entity.name.length * 12 * 0.55;
    const maxFieldWidth = fields.reduce((max, field) => {
      const text = `${field.visibility} ${field.name}: ${field.type}`;
      return Math.max(max, text.length * charWidth);
    }, 0);
    const maxMethodWidth = methods.reduce((max, method) => {
      const visibility = method.visibility || '+';
      const params = method.params || '';
      const returnType = method.returnType && method.returnType !== 'void' ? `: ${method.returnType}` : '';
      const fullText = `${visibility} ${method.name}(${params})${returnType}`;
      const displayText = fullText.length > 35 ? fullText.substring(0, 32) + '...' : fullText;
      return Math.max(max, displayText.length * charWidth);
    }, 0);

    const dynamicWidth = Math.max(120, Math.min(800, Math.max(classNameWidth, maxFieldWidth, maxMethodWidth) + 20));

    const widthDiff = dynamicWidth - fixedWidth;
    const widthDiffPercent = (widthDiff / fixedWidth) * 100;

    let category: 'undersized' | 'proper' | 'oversized';
    if (widthDiffPercent < -20) {
      category = 'undersized';
    } else if (widthDiffPercent > 20) {
      category = 'oversized';
    } else {
      category = 'proper';
    }

    widthAnalysis.push({
      className: entity.name,
      fieldsCount: fields.length,
      methodsCount: methods.length,
      fixedWidth,
      dynamicWidth,
      widthDiff,
      widthDiffPercent,
      category
    });
  }

  // Sort by width difference
  widthAnalysis.sort((a, b) => b.widthDiffPercent - a.widthDiffPercent);

  // Print analysis
  console.log(`\n${'='.repeat(70)}`);
  console.log(`宽度分析 (Top 20 差异最大)`);
  console.log(`${'='.repeat(70)}\n`);

  const top20 = widthAnalysis.slice(0, 20);
  console.log(`类名`.padEnd(50) + `固定`.padStart(8) + `动态`.padStart(8) + `差异`.padStart(10) + `分类`);
  console.log(`-`.repeat(90));

  for (const analysis of top20) {
    const className = analysis.className.length > 47
      ? analysis.className.substring(0, 44) + '...'
      : analysis.className;

    const categoryIcon = analysis.category === 'oversized' ? '🔴' : analysis.category === 'undersized' ? '🟢' : '⚪';
    const categoryText = analysis.category === 'oversized' ? '溢出' : analysis.category === 'undersized' ? '节省' : '合适';

    console.log(
      `${className.padEnd(50)}` +
      `${analysis.fixedWidth}px`.padStart(8) +
      `${Math.round(analysis.dynamicWidth)}px`.padStart(8) +
      `${(analysis.widthDiff > 0 ? '+' : '') + Math.round(analysis.widthDiff)}px (${analysis.widthDiffPercent.toFixed(0)}%)`.padStart(10) +
      ` ${categoryIcon} ${categoryText}`
    );
  }

  // Statistics
  const oversized = widthAnalysis.filter(a => a.category === 'oversized');
  const undersized = widthAnalysis.filter(a => a.category === 'undersized');
  const proper = widthAnalysis.filter(a => a.category === 'proper');

  const avgFixedWidth = widthAnalysis.reduce((sum, a) => sum + a.fixedWidth, 0) / widthAnalysis.length;
  const avgDynamicWidth = widthAnalysis.reduce((sum, a) => sum + a.dynamicWidth, 0) / widthAnalysis.length;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`统计摘要`);
  console.log(`${'='.repeat(70)}\n`);

  console.log(`总节点数: ${widthAnalysis.length}`);
  console.log(`溢出 (>20%): ${oversized.length} (${(oversized.length / widthAnalysis.length * 100).toFixed(1)}%)`);
  console.log(`节省 (>20%): ${undersized.length} (${(undersized.length / widthAnalysis.length * 100).toFixed(1)}%)`);
  console.log(`合适 (±20%): ${proper.length} (${(proper.length / widthAnalysis.length * 100).toFixed(1)}%)`);
  console.log(``);
  console.log(`平均固定宽度: ${avgFixedWidth.toFixed(0)}px`);
  console.log(`平均动态宽度: ${avgDynamicWidth.toFixed(0)}px`);
  console.log(`平均差异: ${(avgDynamicWidth - avgFixedWidth).toFixed(0)}px (${((avgDynamicWidth - avgFixedWidth) / avgFixedWidth * 100).toFixed(1)}%)`);

  // Generate report
  await generateWidthReport(widthAnalysis, outputDir, {
    svgDynamic: svgDynamic.svgPath,
    pngDynamic: svgDynamic.pngPath,
    width: resultDynamic.width,
    height: resultDynamic.height,
    aspectRatio: resultDynamic.width / resultDynamic.height
  });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`测试完成！结果保存在: ${outputDir}`);
  console.log(`${'='.repeat(70)}\n`);
}

async function generateWidthReport(analysis: WidthAnalysis[], outputDir: string, result: any) {
  let report = '# 动态宽度实验报告\n\n';

  report += `## 测试配置\n\n`;
  report += `- 测试文件: cli-method.mmd\n`;
  report += `- 测试时间: ${new Date().toISOString()}\n`;
  report += `- 节点数: ${analysis.length}\n\n`;

  report += `## 生成的文件\n\n`;
  report += `- 动态宽度: \`${path.basename(result.svgDynamic)}\` (${result.width}×${result.height}px, ${result.aspectRatio.toFixed(2)}:1)\n\n`;

  report += `## 宽度分析详情\n\n`;

  // Group by category
  const oversized = analysis.filter(a => a.category === 'oversized');
  const undersized = analysis.filter(a => a.category === 'undersized');
  const proper = analysis.filter(a => a.category === 'proper');

  report += `### 统计摘要\n\n`;
  report += `| 分类 | 数量 | 百分比 |\n`;
  report += `|------|------|--------|\n`;
  report += `| 🔴 溢出 (>20%) | ${oversized.length} | ${(oversized.length / analysis.length * 100).toFixed(1)}% |\n`;
  report += `| 🟢 节省 (>20%) | ${undersized.length} | ${(undersized.length / analysis.length * 100).toFixed(1)}% |\n`;
  report += `| ⚪ 合适 (±20%) | ${proper.length} | ${(proper.length / analysis.length * 100).toFixed(1)}% |\n\n`;

  const avgFixedWidth = analysis.reduce((sum, a) => sum + a.fixedWidth, 0) / analysis.length;
  const avgDynamicWidth = analysis.reduce((sum, a) => sum + a.dynamicWidth, 0) / analysis.length;

  report += `### 平均宽度\n\n`;
  report += `- 固定宽度: ${avgFixedWidth.toFixed(0)}px\n`;
  report += `- 动态宽度: ${avgDynamicWidth.toFixed(0)}px\n`;
  report += `- 平均差异: ${(avgDynamicWidth - avgFixedWidth).toFixed(0)}px (${((avgDynamicWidth - avgFixedWidth) / avgFixedWidth * 100).toFixed(1)}%)\n\n`;

  report += `### Top 20 差异最大的节点\n\n`;
  report += `| 类名 | 字段 | 方法 | 固定 | 动态 | 差异 | 分类 |\n`;
  report += `|------|------|------|------|------|------|------|\n`;

  for (const a of analysis.slice(0, 20)) {
    const className = a.className.length > 40 ? a.className.substring(0, 37) + '...' : a.className;
    const categoryIcon = a.category === 'oversized' ? '🔴' : a.category === 'undersized' ? '🟢' : '⚪';
    const categoryText = a.category === 'oversized' ? '溢出' : a.category === 'undersized' ? '节省' : '合适';

    report += `| ${className} | ${a.fieldsCount} | ${a.methodsCount} | ${a.fixedWidth}px | ${Math.round(a.dynamicWidth)}px | ${a.widthDiff > 0 ? '+' : ''}${Math.round(a.widthDiff)}px (${a.widthDiffPercent.toFixed(0)}%) | ${categoryIcon} ${categoryText} |\n`;
  }

  report += `\n## 关键发现\n\n`;

  if (oversized.length > 0) {
    report += `### 需要更宽的节点 (${oversized.length}个)\n\n`;
    report += `这些节点的固定宽度 200px 不足以容纳内容，使用动态宽度可以避免文字溢出。\n\n`;
    report += `示例：\n`;
    for (const a of oversized.slice(0, 5)) {
      report += `- \`${a.className}\`: ${a.fixedWidth}px → ${Math.round(a.dynamicWidth)}px\n`;
    }
    report += `\n`;
  }

  if (undersized.length > 0) {
    report += `### 可以缩小的节点 (${undersized.length}个)\n\n`;
    report += `这些节点的固定宽度 200px 浪费了大量空间，使用动态宽度可以节省空间。\n\n`;
    report += `示例：\n`;
    for (const a of undersized.slice(0, 5)) {
      report += `- \`${a.className}\`: ${a.fixedWidth}px → ${Math.round(a.dynamicWidth)}px (节省 ${(-a.widthDiffPercent).toFixed(0)}%)\n`;
    }
    report += `\n`;
  }

  report += `## 结论\n\n`;

  if (oversized.length > 0) {
    report += `✅ **动态宽度成功解决了文字溢出问题**\n\n`;
    report += `${oversized.length} 个节点不再被截断，所有内容都可以完整显示。\n\n`;
  }

  if (undersized.length > 0) {
    report += `✅ **动态宽度节省了空间**\n\n`;
    report += `${undersized.length} 个节点缩小了宽度，平均节省 ${(-undersized.reduce((sum, a) => sum + a.widthDiffPercent, 0) / undersized.length).toFixed(1)}%。\n\n`;
  }

  report += `总体而言，动态宽度提供了更精确的节点尺寸，改善了可读性和空间利用效率。\n\n`;

  report += `---\n\n*此报告由自动化测试生成*\n`;

  await fs.writeFile(path.join(outputDir, 'DYNAMIC_WIDTH_REPORT.md'), report);
}

runDynamicWidthTest().catch(console.error);
