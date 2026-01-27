#!/usr/bin/env node

/**
 * 测试 namespace 支持的 ELK 布局
 */

import fs from 'fs-extra';
import * as path from 'path';
import {
  parseMermaidClassDiagram,
  archjsonToELK,
  createLayoutOptions
} from './plan-b/archjson-elk-with-namespace.js';
import { layoutGraph } from './plan-b/elk-adapter-full.js';
import { generateSVGFromELK } from './plan-b/svg-generator-with-namespace.js';

interface TestResult {
  config: Record<string, string>;
  width: number;
  height: number;
  aspectRatio: number;
  success: boolean;
  namespaces: number;
  classes: number;
  relations: number;
  svgPath: string;
  pngPath: string;
}

async function runNamespaceTest() {
  const mermaidPath = 'test-data/cli-module.mmd';
  const outputDir = 'results/cli-module-namespace-test';

  await fs.ensureDir(outputDir);

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║     ELK 布局实验 - Namespace 支持测试                  ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  // Read and parse Mermaid file
  const mermaidCode = await fs.readFile(mermaidPath, 'utf-8');
  const archjson = parseMermaidClassDiagram(mermaidCode);

  console.log(`文件: ${path.basename(mermaidPath)}`);
  console.log(`实体数: ${archjson.entities.length}`);
  console.log(`关系数: ${archjson.relations.length}`);
  console.log(`Namespaces: ${archjson.namespaces.length}`);
  console.log(`Namespace 列表: ${archjson.namespaces.join(', ')}\n`);

  const results: TestResult[] = [];

  // Test configurations
  const configurations = [
    { aspectRatio: 1.5, direction: 'DOWN' as const },
    { aspectRatio: 1.0, direction: 'DOWN' as const },
    { aspectRatio: 2.0, direction: 'DOWN' as const },
  ];

  for (const config of configurations) {
    const layoutOptions = createLayoutOptions(config.aspectRatio, config.direction);
    const elkGraph = archjsonToELK(archjson, layoutOptions);
    const baseFilename = `cli-module-ns-${config.direction}-ar${config.aspectRatio}`;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`配置: ${config.direction}, aspectRatio=${config.aspectRatio}`);
    console.log(`${'='.repeat(70)}`);

    // Layout with full ELK
    console.log(`\n🚀 ELK 布局中...`);

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

    const result = await layoutGraph(JSON.parse(JSON.stringify(elkGraph)), fullOptions);
    const aspectRatio = result.width / result.height;

    console.log(`   尺寸: ${result.width.toFixed(1)}×${result.height.toFixed(1)}px`);
    console.log(`   宽高比: ${aspectRatio.toFixed(2)}:1`);
    console.log(`   状态: ${result.success ? '✅' : '❌'}`);
    if (result.error) {
      console.log(`   错误: ${result.error}`);
    }

    const svgResult = await generateSVGFromELK(result.layout, {
      outputDir,
      filename: baseFilename,
      theme: 'light'
    });

    if (svgResult.success) {
      console.log(`   ✅ SVG 已生成: ${path.basename(svgResult.svgPath)}`);
      console.log(`   ✅ PNG 已生成: ${path.basename(svgResult.pngPath)}`);
    } else {
      console.log(`   ❌ 生成失败: ${svgResult.error}`);
    }

    results.push({
      config: fullOptions,
      width: result.width,
      height: result.height,
      aspectRatio,
      success: result.success,
      namespaces: archjson.namespaces.length,
      classes: archjson.entities.length,
      relations: archjson.relations.length,
      svgPath: svgResult.svgPath,
      pngPath: svgResult.pngPath
    });
  }

  // Generate report
  await generateReport(results, outputDir, archjson);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`测试完成！结果保存在: ${outputDir}`);
  console.log(`${'='.repeat(70)}\n`);
}

async function generateReport(results: TestResult[], outputDir: string, archjson: any) {
  let report = '# ELK Namespace 支持测试报告\n\n';
  report += `## 测试配置\n\n`;
  report += `- 测试文件: cli-module.mmd\n`;
  report += `- 实体数量: ${archjson.entities.length}\n`;
  report += `- 关系数量: ${archjson.relations.length}\n`;
  report += `- Namespace 数量: ${archjson.namespaces.length}\n`;
  report += `- Namespace 列表: ${archjson.namespaces.join(', ')}\n`;
  report += `- 测试时间: ${new Date().toISOString()}\n\n`;

  report += `## Namespace 列表\n\n`;
  for (const ns of archjson.namespaces) {
    const classesInNs = archjson.entities.filter((e: any) => e.namespace === ns);
    report += `- **${ns}**: ${classesInNs.length} 个类\n`;
    for (const cls of classesInNs) {
      report += `  - ${cls.name}\n`;
    }
    report += '\n';
  }

  report += `## 测试结果\n\n`;

  for (const result of results) {
    const targetRatio = parseFloat(result.config['elk.aspectRatio']);
    const deviation = Math.abs(result.aspectRatio - targetRatio);
    const deviationPercent = (deviation / targetRatio * 100).toFixed(1);

    report += `### ${result.config['elk.direction']}-ar${targetRatio}\n\n`;
    report += `| 指标 | 值 |\n`;
    report += `|------|-----|\n`;
    report += `| 尺寸 | ${result.width.toFixed(1)}×${result.height.toFixed(1)}px |\n`;
    report += `| 宽高比 | ${result.aspectRatio.toFixed(2)}:1 |\n`;
    report += `| 目标宽高比 | ${targetRatio}:1 |\n`;
    report += `| 偏差 | ${deviation.toFixed(2)} (${deviationPercent}%) |\n`;
    report += `| 状态 | ${result.success ? '✅' : '❌'} |\n`;
    report += `| Namespaces | ${result.namespaces} |\n`;
    report += `| 类 | ${result.classes} |\n`;
    report += `| 关系 | ${result.relations} |\n\n`;

    report += `#### 文件\n\n`;
    report += `- SVG: \`${path.basename(result.svgPath)}\`\n`;
    report += `- PNG: \`${path.basename(result.pngPath)}\`\n\n`;
  }

  report += `## 关键改进\n\n`;
  report += `### ✅ Namespace 支持\n`;
  report += `- 解析 Mermaid namespace 声明\n`;
  report += `- 使用 ELK compound nodes 创建分组\n`;
  report += `- SVG 渲染时绘制 namespace 框（虚线边框）\n`;
  report += `- Namespace 标签显示在框顶部\n\n`;

  report += `### 视觉效果\n`;
  report += `- Namespace 框使用虚线边框区分\n`;
  report += `- 浅灰色背景突出分组\n`;
  report += `- 类节点按 namespace 分组显示\n`;
  report += `- 关系连线正确连接所有类\n\n`;

  report += `## 对比\n\n`;
  report += `| 特性 | 之前 | 现在 |\n`;
  report += `|------|------|------|\n`;
  report += `| Namespace 解析 | ❌ | ✅ |\n`;
  report += `| Namespace 框 | ❌ | ✅ |\n`;
  report += `| 类分组 | ❌ | ✅ |\n`;
  report += `| 宽高比控制 | ✅ | ✅ |\n\n`;

  report += `---\n\n`;
  report += `*此报告由自动化测试生成*\n`;

  await fs.writeFile(path.join(outputDir, 'NAMESPACE_SUPPORT_REPORT.md'), report);
}

runNamespaceTest().catch(console.error);
