/**
 * Debug test for interface extraction
 */

import { describe, it } from 'vitest';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

describe('Debug Interface', () => {
  it('should show interface extraction details', () => {
    const parser = new Parser();
    // @ts-ignore
    parser.setLanguage(Go);

    const code = `
package main

type Runner interface {
  Start()
  Stop()
}
`;

    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    const typeDecls = rootNode.descendantsOfType('type_declaration');
    const typeSpec = typeDecls[0].namedChildren.find((child) => child.type === 'type_spec');

    if (!typeSpec) {
      console.log('No type_spec found');
      return;
    }

    const typeNode = typeSpec.childForFieldName('type');
    if (!typeNode) {
      console.log('No type node found');
      return;
    }

    console.log('\n===== INTERFACE TYPE NODE =====');
    console.log('Type:', typeNode.type);
    console.log('Text:', code.substring(typeNode.startIndex, typeNode.endIndex));

    console.log('\nNamed children (method_elem):');
    for (let i = 0; i < typeNode.namedChildCount; i++) {
      const child = typeNode.namedChild(i);
      if (child && child.type === 'method_elem') {
        console.log(`\n  Method elem ${i}:`);
        console.log('    Text:', code.substring(child.startIndex, child.endIndex));

        console.log('    Children:');
        for (let j = 0; j < child.childCount; j++) {
          const methodChild = child.child(j);
          if (methodChild) {
            console.log(
              `      ${j}: type="${methodChild.type}", text="${code.substring(methodChild.startIndex, methodChild.endIndex)}"`
            );
          }
        }

        console.log('    Named children:');
        for (let j = 0; j < child.namedChildCount; j++) {
          const methodChild = child.namedChild(j);
          if (methodChild) {
            console.log(
              `      ${j}: type="${methodChild.type}", text="${code.substring(methodChild.startIndex, methodChild.endIndex)}"`
            );
          }
        }

        console.log(
          '    Field name:',
          child.childForFieldName('name')
            ? code.substring(
                child.childForFieldName('name').startIndex,
                child.childForFieldName('name').endIndex
              )
            : 'null'
        );
      }
    }
  });
});
