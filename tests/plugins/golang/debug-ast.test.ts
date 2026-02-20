/**
 * Debug test to understand tree-sitter-go AST structure
 */

import { describe, it } from 'vitest';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

describe('Debug AST', () => {
  it('should show AST structure', () => {
    const parser = new Parser();
    // @ts-ignore
    parser.setLanguage(Go);

    const code = `
package main

type User struct {
  Name string
  Age int
}
`;

    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    console.log('\n===== ROOT NODE =====');
    console.log('Type:', rootNode.type);
    console.log('Children count:', rootNode.childCount);
    console.log('Named children count:', rootNode.namedChildCount);

    console.log('\n===== CHILDREN =====');
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (child) {
        console.log(`Child ${i}:`, {
          type: child.type,
          text: code.substring(child.startIndex, child.endIndex).substring(0, 50),
        });
      }
    }

    console.log('\n===== TYPE DECLARATIONS =====');
    const typeDecls = rootNode.descendantsOfType('type_declaration');
    console.log('Found type declarations:', typeDecls.length);

    for (let i = 0; i < typeDecls.length; i++) {
      const decl = typeDecls[i];
      console.log(`\nType decl ${i}:`);
      console.log('  Type:', decl.type);
      console.log('  Text:', code.substring(decl.startIndex, decl.endIndex));
      console.log('  Children:');
      for (let j = 0; j < decl.namedChildCount; j++) {
        const child = decl.namedChild(j);
        if (child) {
          console.log(`    ${j}: ${child.type} = "${code.substring(child.startIndex, child.endIndex).substring(0, 30)}"`);
        }
      }
    }

    console.log('\n===== TYPE SPECS =====');
    const typeSpecs = rootNode.descendantsOfType('type_spec');
    console.log('Found type specs:', typeSpecs.length);

    for (let i = 0; i < typeSpecs.length; i++) {
      const spec = typeSpecs[i];
      console.log(`\nType spec ${i}:`);
      const nameNode = spec.childForFieldName('name');
      const typeNode = spec.childForFieldName('type');
      console.log('  Name field:', nameNode ? code.substring(nameNode.startIndex, nameNode.endIndex) : 'null');
      console.log('  Type field type:', typeNode?.type);

      if (typeNode) {
        console.log('  Type node children:');
        for (let j = 0; j < typeNode.namedChildCount; j++) {
          const child = typeNode.namedChild(j);
          if (child) {
            console.log(`    ${j}: ${child.type}`);
          }
        }
      }
    }
  });
});
