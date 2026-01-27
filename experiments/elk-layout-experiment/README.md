# ELK Layout Engine Experiment

验证 ELK (Eclipse Layout Kernel) 布局引擎能否解决 Mermaid 图表宽高比问题。

## Problem

当前 `cli-class.mmd` 生成 SVG 尺寸为 16981×1266px，宽高比约 13.4:1，目标是将宽高比控制在 0.5:1 到 2:1 范围内。

## Solutions

### Plan A: YAML Frontmatter Configuration
在 Mermaid 代码前添加 YAML 配置头，测试 Mermaid 是否能传递 ELK 选项。

### Plan B: Direct ELK JS Invocation
直接使用 `@mermaid-js/layout-elk` 库，实现完整的 ELK 布局控制。

## Setup

```bash
cd experiments/elk-layout-experiment
npm install
npm run build
```

## Run Tests

```bash
# Test both plans
npm test

# Test specific plan
npm run test:plan-a
npm run test:plan-b
```

## Results

Test outputs are saved in `results/` directory with aspect ratio metrics.

## Reports

Analysis reports are generated in `reports/` directory.
