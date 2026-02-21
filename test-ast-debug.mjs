import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

const parser = new Parser();
parser.setLanguage(Python);

const code1 = `
def __init__(self, name: str, age: int):
    pass
`;

const tree1 = parser.parse(code1);
console.log('=== Parameters AST ===');
console.log(tree1.rootNode.toString());

const params = tree1.rootNode.descendantsOfType('parameters')[0];
console.log('\nParameters node:');
console.log(params.toString());
console.log('\nNamed children:');
params.namedChildren.forEach(c => {
  console.log(`  ${c.type}: ${c.text}`);
});

const code2 = `
def greet(name: str = "World"):
    pass
`;

const tree2 = parser.parse(code2);
console.log('\n=== Default Parameters AST ===');
console.log(tree2.rootNode.toString());

const params2 = tree2.rootNode.descendantsOfType('parameters')[0];
console.log('\nDefault params node:');
params2.namedChildren.forEach(c => {
  console.log(`  ${c.type}: ${c.text}`);
  if (c.type === 'default_parameter') {
    console.log('    Children:');
    c.children.forEach(ch => console.log(`      ${ch.type}: ${ch.text}`));
  }
});
