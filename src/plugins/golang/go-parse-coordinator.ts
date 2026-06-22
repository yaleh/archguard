import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import type { TreeSitterParseOptions } from './tree-sitter-bridge.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { GoplsInterfaceResolver } from './gopls-interface-resolver.js';
import { readModuleName } from './go-mod-reader.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import { type ArchJSON, type Relation, ARCHJSON_SCHEMA_VERSION } from '@/types/index.js';
import type { GoRawPackage, GoRawData } from './types.js';
import type { FlowGraph } from '@/types/extensions/go-atlas.js';

export type { GoRawData } from './types.js';
export type { TreeSitterParseOptions } from './tree-sitter-bridge.js';

export class GoParseCoordinator {
  private treeSitter: TreeSitterBridge;
  private mapper: ArchJsonMapper;
  private resolver: GoplsInterfaceResolver;

  constructor(resolver: GoplsInterfaceResolver) {
    this.treeSitter = new TreeSitterBridge();
    this.mapper = new ArchJsonMapper();
    this.resolver = resolver;
  }

  async parseToRawData(workspaceRoot: string, config: ParseConfig & TreeSitterParseOptions): Promise<GoRawData> {
    const ignore = ['**/vendor/**', '**/node_modules/**', ...(config.excludePatterns ?? [])];
    const files = config.includePatterns?.length
      ? Array.from(new Set((await Promise.all(config.includePatterns.map((p) => glob(p, { cwd: workspaceRoot, absolute: true, ignore })))).flat().sort()))
      : await glob(config.filePattern ?? '**/*.go', { cwd: workspaceRoot, absolute: true, ignore });

    const moduleName = await readModuleName(workspaceRoot);
    const packages = new Map<string, GoRawPackage>();

    for (const file of files) {
      const code = await fs.readFile(file, 'utf-8');
      const pkg = this.treeSitter.parseCode(code, file, {
        extractBodies: config.extractBodies,
        selectiveExtraction: config.selectiveExtraction,
        forceExtractFunctions: config.forceExtractFunctions,
      });
      const relDir = path.relative(workspaceRoot, path.dirname(file));
      pkg.fullName = relDir || pkg.name;
      pkg.dirPath = path.dirname(file);
      pkg.id = pkg.fullName;

      const key = pkg.fullName;
      if (packages.has(key)) {
        const existing = packages.get(key);
        existing.structs.push(...pkg.structs);
        existing.interfaces.push(...pkg.interfaces);
        existing.functions.push(...pkg.functions);
        existing.imports.push(...pkg.imports);
        existing.sourceFiles.push(...pkg.sourceFiles);
        if (pkg.orphanedMethods?.length) {
          if (!existing.orphanedMethods) existing.orphanedMethods = [];
          existing.orphanedMethods.push(...pkg.orphanedMethods);
        }
      } else {
        packages.set(key, pkg);
      }
    }

    for (const pkg of packages.values()) {
      if (!pkg.orphanedMethods?.length) continue;
      for (const method of pkg.orphanedMethods) {
        const struct = pkg.structs.find((s) => s.name === method.receiverType);
        if (struct) struct.methods.push(method);
      }
      pkg.orphanedMethods = [];
    }

    return { packages: Array.from(packages.values()), moduleRoot: workspaceRoot, moduleName };
  }

  async buildArchJson(rawData: GoRawData, workspaceRoot: string): Promise<Pick<ArchJSON, 'entities' | 'relations' | 'sourceFiles'> & { workspaceRoot: string }> {
    const allStructs = rawData.packages.flatMap((p) => p.structs.map((s) => ({ ...s, packageName: p.fullName || p.name })));
    const allInterfaces = rawData.packages.flatMap((p) => p.interfaces.map((i) => ({ ...i, packageName: p.fullName || p.name })));
    const implementations = await this.resolver.resolve(allStructs, allInterfaces);
    const entities = this.mapper.mapEntities(rawData.packages);
    const relations = this.mapper.mapRelations(rawData.packages, implementations, rawData.moduleName);
    const missingInterfaces = this.mapper.mapMissingInterfaceEntities(entities, relations, rawData.packages);
    entities.push(...missingInterfaces);
    return { entities, relations, sourceFiles: rawData.packages.flatMap((p) => p.sourceFiles), workspaceRoot };
  }

  parseCodeToArchJson(code: string, filePath: string, cachedModuleName: string): ArchJSON {
    const pkg = this.treeSitter.parseCode(code, filePath);
    const impls = this.resolver.resolveSync(
      pkg.structs.map((s) => ({ ...s, packageName: pkg.fullName || pkg.name })),
      pkg.interfaces.map((i) => ({ ...i, packageName: pkg.fullName || pkg.name }))
    );
    return {
      version: ARCHJSON_SCHEMA_VERSION, language: 'go', timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities: this.mapper.mapEntities([pkg]),
      relations: this.mapper.mapRelations([pkg], impls, cachedModuleName),
    };
  }

  async parseFileListToArchJson(filePaths: string[], cachedModuleName: string): Promise<ArchJSON> {
    const packages = new Map<string, GoRawPackage>();
    for (const file of filePaths) {
      const code = await fs.readFile(file, 'utf-8');
      const pkg = this.treeSitter.parseCode(code, file);
      const key = path.dirname(file);
      pkg.fullName = pkg.fullName || key;
      pkg.dirPath = pkg.dirPath || key;
      if (packages.has(key)) {
        const e = packages.get(key);
        e.structs.push(...pkg.structs); e.interfaces.push(...pkg.interfaces);
        e.functions.push(...pkg.functions); e.imports.push(...pkg.imports);
        e.sourceFiles.push(...pkg.sourceFiles);
      } else {
        packages.set(key, pkg);
      }
    }
    const packageList = Array.from(packages.values());
    const allStructs = packageList.flatMap((p) => p.structs.map((s) => ({ ...s, packageName: p.fullName || p.name })));
    const allInterfaces = packageList.flatMap((p) => p.interfaces.map((i) => ({ ...i, packageName: p.fullName || p.name })));
    const impls = await this.resolver.resolve(allStructs, allInterfaces);
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList, impls, cachedModuleName);
    entities.push(...this.mapper.mapMissingInterfaceEntities(entities, relations, packageList));
    return {
      version: ARCHJSON_SCHEMA_VERSION, language: 'go', timestamp: new Date().toISOString(),
      sourceFiles: filePaths, entities, relations,
    };
  }

  mapCallRelations(flowGraph: FlowGraph | undefined): Relation[] {
    return this.mapper.mapCallRelations(flowGraph);
  }

  async initModuleName(workspaceRoot: string): Promise<string> {
    return readModuleName(workspaceRoot);
  }
}
