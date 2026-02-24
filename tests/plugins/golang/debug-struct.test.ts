/**
 * Debug test for struct extraction
 */

import { describe, it } from 'vitest';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

describe('Debug Struct', () => {
  it('should show struct extraction details', () => {
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

    console.log('\n===== FINDING TYPE SPECS =====');
    const typeDecls = rootNode.descendantsOfType('type_declaration');
    console.log('Type declarations found:', typeDecls.length);

    for (const typeDecl of typeDecls) {
      console.log('\nType declaration:');
      console.log('  childForFieldName("type_spec"):', typeDecl.childForFieldName('type_spec'));

      console.log('\n  All children:');
      for (let i = 0; i < typeDecl.childCount; i++) {
        const child = typeDecl.child(i);
        if (child) {
          console.log(
            `    ${i}: type="${child.type}", text="${code.substring(child.startIndex, child.endIndex).substring(0, 30)}"`
          );
        }
      }

      console.log('\n  Named children:');
      for (let i = 0; i < typeDecl.namedChildCount; i++) {
        const child = typeDecl.namedChild(i);
        if (child) {
          console.log(
            `    ${i}: type="${child.type}", text="${code.substring(child.startIndex, child.endIndex).substring(0, 30)}"`
          );

          if (child.type === 'type_spec') {
            console.log('\n    Type spec details:');
            console.log('      childForFieldName("name"):', child.childForFieldName('name'));
            console.log('      childForFieldName("type"):', child.childForFieldName('type'));

            const nameNode = child.childForFieldName('name');
            const typeNode = child.childForFieldName('type');

            if (nameNode) {
              console.log('      Name:', code.substring(nameNode.startIndex, nameNode.endIndex));
            }
            if (typeNode) {
              console.log('      Type:', typeNode.type);
            }
          }
        }
      }
    }
  });
});
