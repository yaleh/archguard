/**
 * Debug test for field extraction
 */

import { describe, it } from 'vitest';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

describe('Debug Fields', () => {
  it('should show field extraction details', () => {
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

    const typeDecls = rootNode.descendantsOfType('type_declaration');
    const typeSpec = typeDecls[0].namedChildren.find(child => child.type === 'type_spec');

    if (!typeSpec) {
      console.log('No type_spec found');
      return;
    }

    const typeNode = typeSpec.childForFieldName('type');
    if (!typeNode) {
      console.log('No type node found');
      return;
    }

    console.log('\n===== STRUCT TYPE NODE =====');
    console.log('Type:', typeNode.type);
    console.log('Text:', code.substring(typeNode.startIndex, typeNode.endIndex));

    console.log('\n===== FINDING FIELD_DECLARATION_LIST =====');
    const fieldDeclList = typeNode.childForFieldName('field_declaration_list');
    console.log('Field decl list:', fieldDeclList ? 'found' : 'not found');

    if (!fieldDeclList) {
      console.log('\nAll children of struct_type:');
      for (let i = 0; i < typeNode.childCount; i++) {
        const child = typeNode.child(i);
        if (child) {
          console.log(`  ${i}: type="${child.type}", text="${code.substring(child.startIndex, child.endIndex).substring(0, 30)}"`);
        }
      }

      console.log('\nNamed children of struct_type:');
      for (let i = 0; i < typeNode.namedChildCount; i++) {
        const child = typeNode.namedChild(i);
        if (child) {
          console.log(`  ${i}: type="${child.type}", text="${code.substring(child.startIndex, child.endIndex).substring(0, 30)}"`);

          if (child.type === 'field_declaration_list') {
            console.log('\n    Field declaration list children:');
            for (let j = 0; j < child.childCount; j++) {
              const fieldChild = child.child(j);
              if (fieldChild) {
                console.log(`      ${j}: type="${fieldChild.type}", text="${code.substring(fieldChild.startIndex, fieldChild.endIndex)}"`);
              }
            }
          }
        }
      }
    }
  });
});
