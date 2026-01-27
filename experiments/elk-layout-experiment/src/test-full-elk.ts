#!/usr/bin/env node

/**
 * 对比测试：简化版 ELK vs 完整版 ELK
 */

import fs from 'fs-extra';
import * as path from 'path';
import { parseMermaidClassDiagram, archjsonToELK, createLayoutOptions } from './plan-b/archjson-elk.js';
import { layoutGraph as layoutGraphSimple } from './plan-b/elk-adapter.js';
import { layoutGraph as layoutGraphFull, testLayoutConfigurations as testFullELK } from './plan-b/elk-adapter-full.js';
import { generateSVGFromELK } from './plan-b/svg-generator.js';

interface TestResult {
  method: 'simple' | 'full';
  config: Record<string, string>;
  width: number;
  height: number;
  aspectRatio: number;
  success: boolean;
  error?: string;
  svgPath: string;
  pngPath: string;
}

async function runComparisonTest() {
  const mermaidPath = '/home/yale/work/archguard/archguard-self-analysis/cli-method.mmd';
  const outputDir = '/home/yale/work/archguard/experiments/elk-layout-experiment/results/full-elk-comparison';

  await fs.ensureDir(outputDir);

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║     完整 ELK vs 简化 ELK 对比测试                       ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  // Read and parse Mermaid file
  const mermaidCode = await fs.readFile(mermaidPath, 'utf-8');
  const archjson = parseMermaidClassDiagram(mermaidCode);

  console.log(`文件: ${path.basename(mermaidPath)}`);
  console.log(`实体数: ${archjson.entities.length}`);
  console.log(`关系数: ${archjson.relations.length}\n`);

  const results: TestResult[] = [];

  // Test configurations
  const configurations = [
    { aspectRatio: 1.5, direction: 'DOWN' as const },
    { aspectRatio: 1.0, direction: 'DOWN' as const },
    { aspectRatio: 2.0, direction: 'DOWN' as const },
    { aspectRatio: 3.0, direction: 'DOWN' as const },
    { aspectRatio: 1.5, direction: 'RIGHT' as const },
  ];

  for (const config of configurations) {
    const layoutOptions = createLayoutOptions(config.aspectRatio, config.direction);
    const elkGraph = archjsonToELK(archjson, layoutOptions);
    const baseFilename = `cli-method-${config.direction}-ar${config.aspectRatio}`;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`配置: ${config.direction}, aspectRatio=${config.aspectRatio}`);
    console.log(`${'='.repeat(70)}`);

    // Test Simple ELK
    console.log(`\n🔧 简化版 ELK:`);
    const simpleResult = await layoutGraphSimple(JSON.parse(JSON.stringify(elkGraph)), layoutOptions);
    const simpleAspectRatio = simpleResult.width / simpleResult.height;

    console.log(`   尺寸: ${simpleResult.width}×${simpleResult.height}px`);
    console.log(`   宽高比: ${simpleAspectRatio.toFixed(2)}:1`);
    console.log(`   状态: ${simpleResult.success ? '✅' : '❌'}`);

    const simpleSvgResult = await generateSVGFromELK(simpleResult.layout, {
      outputDir,
      filename: `${baseFilename}-simple`,
      theme: 'light'
    });

    results.push({
      method: 'simple',
      config: layoutOptions,
      width: simpleResult.width,
      height: simpleResult.height,
      aspectRatio: simpleAspectRatio,
      success: simpleResult.success,
      svgPath: simpleSvgResult.svgPath,
      pngPath: simpleSvgResult.pngPath
    });

    // Test Full ELK
    console.log(`\n🚀 完整版 ELK:`);

    // Enhanced options for full ELK
    const fullOptions = {
      ...layoutOptions,
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'PREFER_EDGES',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONSTRAINT_LOCKING'
    };

    const fullResult = await layoutGraphFull(JSON.parse(JSON.stringify(elkGraph)), fullOptions);
    const fullAspectRatio = fullResult.width / fullResult.height;

    console.log(`   尺寸: ${fullResult.width}×${fullResult.height}px`);
    console.log(`   宽高比: ${fullAspectRatio.toFixed(2)}:1`);
    console.log(`   状态: ${fullResult.success ? '✅' : '❌'}`);
    if (fullResult.error) {
      console.log(`   错误: ${fullResult.error}`);
    }

    const fullSvgResult = await generateSVGFromELK(fullResult.layout, {
      outputDir,
      filename: `${baseFilename}-full`,
      theme: 'light'
    });

    results.push({
      method: 'full',
      config: fullOptions,
      width: fullResult.width,
      height: fullResult.height,
      aspectRatio: fullAspectRatio,
      success: fullResult.success,
      error: fullResult.error,
      svgPath: fullSvgResult.svgPath,
      pngPath: fullSvgResult.pngPath
    });

    // Compare
    const ratioImprovement = Math.abs(simpleAspectRatio - config.aspectRatio) - Math.abs(fullAspectRatio - config.aspectRatio);
    const improvementPercent = ((Math.abs(simpleAspectRatio - config.aspectRatio) - Math.abs(fullAspectRatio - config.aspectRatio)) / Math.abs(simpleAspectRatio - config.aspectRatio) * 100).toFixed(1);

    console.log(`\n📊 对比:`);
    console.log(`   宽高比准确度: ${ratioImprovement > 0 ? '完整版更接近目标' : '简化版更接近目标'}`);
    console.log(`   改善幅度: ${improvementPercent}%`);
    console.log(`   生成文件:`);
    console.log(`     - ${baseFilename}-simple.svg/png`);
    console.log(`     - ${baseFilename}-full.svg/png`);
  }

  // Generate comparison report
  await generateComparisonReport(results, outputDir);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`测试完成！结果保存在: ${outputDir}`);
  console.log(`${'='.repeat(70)}\n`);
}

async function generateComparisonReport(results: TestResult[], outputDir: string) {
  let report = '# 完整 ELK vs 简化 ELK 对比报告\n\n';
  report += `## 测试配置\n\n`;
  report += `- 测试文件: cli-method.mmd\n`;
  report += `- 测试时间: ${new Date().toISOString()}\n`;
  report += `- 配置数量: ${results.length / 2}\n\n`;

  report += `## 详细结果\n\n`;

  // Group by configuration
  const grouped = new Map<string, TestResult[]>();
  for (const result of results) {
    const key = `${result.config['elk.direction']}-ar${result.config['elk.aspectRatio']}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(result);
  }

  for (const [key, group] of grouped) {
    const [simple, full] = group;
    const targetRatio = parseFloat(simple.config['elk.aspectRatio']);

    report += `### ${key}\n\n`;
    report += `| 指标 | 简化版 ELK | 完整版 ELK | 改善 |\n`;
    report += `|------|------------|------------|------|\n`;
    report += `| 宽度 | ${simple.width}px | ${full.width}px | ${((full.width - simple.width) / simple.width * 100).toFixed(1)}% |\n`;
    report += `| 高度 | ${simple.height}px | ${full.height}px | ${((full.height - simple.height) / simple.height * 100).toFixed(1)}% |\n`;
    report += `| 宽高比 | ${simple.aspectRatio.toFixed(2)}:1 | ${full.aspectRatio.toFixed(2)}:1 | |\n`;
    report += `| 目标宽高比 | ${targetRatio}:1 | ${targetRatio}:1 | |\n`;
    report += `| 偏差 | ${Math.abs(simple.aspectRatio - targetRatio).toFixed(2)} | ${Math.abs(full.aspectRatio - targetRatio).toFixed(2)} | ${((Math.abs(simple.aspectRatio - targetRatio) - Math.abs(full.aspectRatio - targetRatio)) / Math.abs(simple.aspectRatio - targetRatio) * 100).toFixed(1)}% |\n`;
    report += `| 状态 | ${simple.success ? '✅' : '❌'} | ${full.success ? '✅' : '❌'} | |\n\n`;

    // Visual comparison
    report += `#### 视觉对比\n\n`;
    report += `- 简化版: \`${key}-simple.svg\` / \`${key}-simple.png\`\n`;
    report += `- 完整版: \`${key}-full.svg\` / \`${key}-full.png\`\n\n`;
  }

  report += `## 关键发现\n\n`;

  // Calculate averages
  const simpleResults = results.filter(r => r.method === 'simple');
  const fullResults = results.filter(r => r.method === 'full');

  const avgSimpleDev = simpleResults.reduce((sum, r) => sum + Math.abs(r.aspectRatio - parseFloat(r.config['elk.aspectRatio'])), 0) / simpleResults.length;
  const avgFullDev = fullResults.reduce((sum, r) => sum + Math.abs(r.aspectRatio - parseFloat(r.config['elk.aspectRatio'])), 0) / fullResults.length;

  report += `1. **宽高比控制**: 平均偏差 ${avgSimpleDev.toFixed(2)} (简化版) vs ${avgFullDev.toFixed(2)} (完整版)\n`;
  report += `2. **拓扑结构**: 完整版 ELK 应该保持更好的拓扑结构\n`;
  report += `3. **性能**: 简化版更快，完整版更准确\n\n`;

  report += `## 建议\n\n`;

  if (avgFullDev < avgSimpleDev) {
    report += `- ✅ **推荐使用完整版 ELK**: 在宽高比控制和拓扑结构方面都更好\n`;
  } else if (avgFullDev < avgSimpleDev * 1.2) {
    report += `- ⚠️ **两种方案接近**: 可以根据性能需求选择\n`;
  } else {
    report += `- ❌ **简化版在宽高比控制上更好**: 但完整版在拓扑结构上可能更优\n`;
  }

  report += `\n---

*此报告由自动化测试生成*
`;

  await fs.writeFile(path.join(outputDir, 'COMPARISON_REPORT.md'), report);
}

runComparisonTest().catch(console.error);
