import { Project } from 'ts-morph';

const code = `
export interface CacheStats {
  hits: number;
  misses: number;
}

export class CacheManager {
  private stats: CacheStats;

  constructor() {
    this.stats = { hits: 0, misses: 0 };
  }
}
`;

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: {
    target: 99,
  },
});

const sourceFile = project.createSourceFile('test.ts', code);
const classDecl = sourceFile.getClass('CacheManager');
const property = classDecl.getProperty('stats');

console.log('Property type text:', property.getType().getText());
console.log('Type name:', property.getType().getTypeName());

const relations = [];
for (const prop of classDecl.getProperties()) {
  const typeText = prop.getType().getText();
  console.log(`Property: ${prop.getName()}, Type: ${typeText}`);
}
