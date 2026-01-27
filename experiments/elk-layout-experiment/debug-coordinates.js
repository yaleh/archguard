import fs from 'fs-extra';
import { parseMermaidClassDiagram, archjsonToELK } from './dist/plan-b/archjson-elk-with-namespace.js';
import { layoutGraph } from './dist/plan-b/elk-adapter-full.js';

async function debug() {
  const mermaidCode = await fs.readFile('test-data/cli-module.mmd', 'utf-8');
  const archjson = parseMermaidClassDiagram(mermaidCode);
  
  const layoutOptions = {
    'elk.aspectRatio': '1.5',
    'elk.direction': 'DOWN',
    'elk.algorithm': 'layered'
  };
  
  const elkGraph = archjsonToELK(archjson, layoutOptions);
  
  console.log('=== Before Layout ===');
  if (elkGraph.children) {
    for (const child of elkGraph.children) {
      if (child.properties && child.properties.isNamespace === 'true') {
        console.log('\nNamespace: ' + child.id);
        console.log('  Position: (' + child.x + ', ' + child.y + ')');
        const childCount = child.children ? child.children.length : 0;
        console.log('  Children: ' + childCount);
        if (child.children) {
          for (const gc of child.children.slice(0, 2)) {
            console.log('    - ' + gc.id + ': (' + gc.x + ', ' + gc.y + ')');
          }
        }
      }
    }
  }
  
  const result = await layoutGraph(elkGraph, layoutOptions);
  
  console.log('\n=== After Layout ===');
  if (result.layout.children) {
    for (const child of result.layout.children) {
      if (child.properties && child.properties.isNamespace === 'true') {
        console.log('\nNamespace: ' + child.id);
        console.log('  Position: (' + child.x + ', ' + child.y + ')');
        console.log('  Size: ' + child.width + ' × ' + child.height);
        const childCount = child.children ? child.children.length : 0;
        console.log('  Children: ' + childCount);
        if (child.children) {
          for (const gc of child.children.slice(0, 2)) {
            console.log('    - ' + gc.id + ': (' + gc.x + ', ' + gc.y + ')');
          }
        }
      } else {
        console.log('\nClass: ' + child.id);
        console.log('  Position: (' + child.x + ', ' + child.y + ')');
        console.log('  Size: ' + child.width + ' × ' + child.height);
      }
    }
  }
}

debug().catch(console.error);
