import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import fs from 'fs-extra';
import { DartPlugin } from '@/plugins/dart/index.js';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';
import type { Entity, Relation } from '@/types/index.js';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/dart/sample.dart');
const TEST_FIXTURE = path.resolve(__dirname, '../../../fixtures/dart/sample_test.dart');

describe('DartPlugin', () => {
  let plugin: DartPlugin;

  beforeEach(async () => {
    plugin = new DartPlugin(wasmParserBackend);
    await plugin.initialize({ workspaceRoot: path.dirname(FIXTURE) });
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('metadata', () => {
    it('has all required metadata fields', () => {
      const m = plugin.metadata;
      expect(m.name).toBe('dart');
      expect(m.displayName).toBe('Dart');
      expect(m.fileExtensions).toContain('.dart');
      expect(m.author).toBeDefined();
      expect(m.minCoreVersion).toBeDefined();
      expect(m.capabilities.singleFileParsing).toBe(true);
    });
  });

  describe('supportedLevels', () => {
    it('supports package and class levels', () => {
      expect(plugin.supportedLevels).toContain('package');
      expect(plugin.supportedLevels).toContain('class');
      expect(plugin.supportedLevels).not.toContain('method');
    });
  });

  describe('canHandle', () => {
    it('returns true for .dart files', () => {
      expect(plugin.canHandle('lib/main.dart')).toBe(true);
    });

    it('returns false for other extensions', () => {
      expect(plugin.canHandle('main.kt')).toBe(false);
      expect(plugin.canHandle('index.ts')).toBe(false);
      expect(plugin.canHandle('pubspec.yaml')).toBe(false);
    });
  });

  describe('parseCode', () => {
    it('extracts classes, enums, extensions and mixins as entities', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      expect(archJson.language).toBe('dart');

      const byName = new Map(archJson.entities.map((e) => [e.name, e]));
      expect(byName.has('Animal')).toBe(true);
      expect(byName.get('Animal')?.type).toBe('abstract_class');
      expect(byName.get('Animal')?.isAbstract).toBe(true);
      expect(byName.get('Logger')?.type).toBe('class');
      expect(byName.get('Dog')?.type).toBe('class');
      expect(byName.get('Color')?.type).toBe('enum');
      expect(byName.get('StringX')?.type).toBe('class');
      expect(byName.get('StringX')?.decorators?.map((d) => d.name)).toContain('extension');
      expect(byName.get('Walker')?.type).toBe('class');
      expect(byName.get('Walker')?.decorators?.map((d) => d.name)).toContain('mixin');
    });

    it('extracts enhanced enum fields, constructor, getter, and method', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      const httpStatus = archJson.entities.find((e) => e.name === 'HttpStatus');
      expect(httpStatus).toBeDefined();
      expect(httpStatus?.type).toBe('enum');

      const members = httpStatus?.members ?? [];
      const byName = new Map(members.map((m) => [m.name, m]));
      // Enum constants are static-final fields.
      expect(byName.has('ok')).toBe(true);
      expect(byName.has('notFound')).toBe(true);
      // Enhanced-enum members after the `;`.
      expect(byName.has('code')).toBe(true); // final field
      expect(byName.has('isSuccess')).toBe(true); // getter
      expect(byName.has('describe')).toBe(true); // method
      expect([...(httpStatus?.members ?? [])].some((m) => m.type === 'constructor')).toBe(true);
    });

    it('extracts methods and fields as members', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      const animal = archJson.entities.find((e) => e.name === 'Animal');
      expect(animal).toBeDefined();
      const memberNames = animal?.members.map((m) => m.name) ?? [];
      expect(memberNames).toContain('name');
      expect(memberNames).toContain('age');
      expect(memberNames).toContain('speak');
      expect(memberNames).toContain('nameLength');
    });

    it('emits inheritance, implementation and composition relations', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      const idByName = (name: string): string | undefined =>
        archJson.entities.find((e) => e.name === name)?.id;

      const dogId = idByName('Dog');
      const animalId = idByName('Animal');
      const loggerId = idByName('Logger');
      const walkerId = idByName('Walker');
      expect(dogId).toBeDefined();
      expect(animalId).toBeDefined();
      expect(loggerId).toBeDefined();
      expect(walkerId).toBeDefined();

      const relations: Relation[] = archJson.relations;
      expect(relations).toContainEqual(
        expect.objectContaining({ type: 'inheritance', source: dogId, target: animalId })
      );
      expect(relations).toContainEqual(
        expect.objectContaining({ type: 'implementation', source: dogId, target: loggerId })
      );
      expect(relations).toContainEqual(
        expect.objectContaining({ type: 'composition', source: dogId, target: loggerId })
      );
      // `with Walker` mixin application → composition
      expect(relations).toContainEqual(
        expect.objectContaining({ type: 'composition', source: dogId, target: walkerId })
      );
    });

    it('extracts named constructors and factories by their constructor name', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      const animal = archJson.entities.find((e) => e.name === 'Animal');
      const dog = archJson.entities.find((e) => e.name === 'Dog');
      const animalCtorNames = (animal?.members ?? [])
        .filter((m) => m.type === 'constructor')
        .map((m) => m.name);
      const dogCtorNames = (dog?.members ?? [])
        .filter((m) => m.type === 'constructor')
        .map((m) => m.name);

      expect(animalCtorNames).toContain('named');
      expect(dogCtorNames).toContain('fromJson');
    });

    it('extracts named/optional parameters nested in optional_formal_parameters', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      const animal = archJson.entities.find((e) => e.name === 'Animal');
      const optionalCtor = animal?.members.find((m) => m.name === 'optional');
      expect(optionalCtor).toBeDefined();
      expect(optionalCtor?.parameters?.map((p) => p.name)).toEqual(
        expect.arrayContaining(['name', 'age'])
      );
      // `required this.name` marks isRequired; `this.age = 1` carries a default.
      const nameParam = optionalCtor?.parameters?.find((p) => p.name === 'name');
      const ageParam = optionalCtor?.parameters?.find((p) => p.name === 'age');
      expect(nameParam?.isOptional).toBe(false); // required
      expect(ageParam?.defaultValue).toBe('1');

      // Method with named parameters.
      const dog = archJson.entities.find((e) => e.name === 'Dog');
      const greet = dog?.members.find((m) => m.name === 'greet');
      expect(greet?.parameters?.map((p) => p.name)).toEqual(
        expect.arrayContaining(['name', 'count'])
      );
    });

    it('assigns anonymous extensions a stable synthetic identity', () => {
      const archJson = plugin.parseCode(readFileSync(FIXTURE, 'utf8'), FIXTURE);

      // Anonymous `extension on int` has no name; it must still produce an
      // entity with a non-empty name/ID (not collapse during dedup).
      const anonymous = archJson.entities.filter(
        (e) => e.name.startsWith('on_int') && e.decorators?.some((d) => d.name === 'extension')
      );
      expect(anonymous.length).toBeGreaterThan(0);
      expect(anonymous.every((e) => e.id.length > 0)).toBe(true);
    });
  });

  describe('parseProject', () => {
    it('parses a Dart project directory', async () => {
      const archJson = await plugin.parseProject(path.dirname(FIXTURE), {
        workspaceRoot: path.dirname(FIXTURE),
        excludePatterns: [],
      });

      expect(archJson.language).toBe('dart');
      expect(archJson.entities.length).toBeGreaterThanOrEqual(6);
      const names = archJson.entities.map((e: Entity) => e.name);
      expect(names).toContain('Animal');
      expect(names).toContain('Dog');
      expect(names).toContain('Color');
    });

    it('resolves cross-file relations via the shared directory package', async () => {
      // sample.dart's Dog has a field of type AdjacentHelper, defined in
      // sample_adjacent.dart. Both live in the same directory, so the mapper
      // must bind the composition relation to AdjacentHelper's entity.
      const archJson = await plugin.parseProject(path.dirname(FIXTURE), {
        workspaceRoot: path.dirname(FIXTURE),
        excludePatterns: [],
      });

      const dog = archJson.entities.find((e) => e.name === 'Dog');
      const adjacent = archJson.entities.find((e) => e.name === 'AdjacentHelper');
      expect(dog).toBeDefined();
      expect(adjacent).toBeDefined();

      const compositionToAdjacent = archJson.relations.some(
        (r) => r.type === 'composition' && r.source === dog?.id && r.target === adjacent?.id
      );
      expect(compositionToAdjacent).toBe(true);
    });

    it('resolves imported types via import paths when names are globally ambiguous', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-import-'));
      const importPlugin = new DartPlugin(wasmParserBackend);
      await importPlugin.initialize({ workspaceRoot: root });
      try {
        await fs.ensureDir(path.join(root, 'lib/a'));
        await fs.ensureDir(path.join(root, 'lib/b'));
        // Two directories each define `Widget` — globally ambiguous.
        await fs.writeFile(path.join(root, 'lib/a/service.dart'), 'class Widget {}\n');
        await fs.writeFile(path.join(root, 'lib/b/service.dart'), 'class Widget {}\n');
        // main.dart imports ONLY a/service.dart, so bare `Widget` must resolve
        // to lib.a.Widget (not the ambiguous global match, which would fail).
        await fs.writeFile(
          path.join(root, 'lib/main.dart'),
          "import 'a/service.dart';\nclass Main { Widget w; }\n"
        );

        const archJson = await importPlugin.parseProject(root, {
          workspaceRoot: root,
          excludePatterns: [],
        });

        const main = archJson.entities.find((e) => e.name === 'Main');
        const aWidget = archJson.entities.find((e) => e.id === 'lib.a.Widget');
        const bWidget = archJson.entities.find((e) => e.id === 'lib.b.Widget');
        expect(main).toBeDefined();
        expect(aWidget).toBeDefined();
        expect(bWidget).toBeDefined();

        expect(
          archJson.relations.some(
            (r) => r.type === 'composition' && r.source === main?.id && r.target === aWidget?.id
          )
        ).toBe(true);
        expect(
          archJson.relations.some((r) => r.source === main?.id && r.target === bWidget?.id)
        ).toBe(false);
      } finally {
        await importPlugin.dispose();
        await fs.remove(root);
      }
    });

    it('resolves alias-qualified types via their import alias', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-alias-'));
      const aliasPlugin = new DartPlugin(wasmParserBackend);
      await aliasPlugin.initialize({ workspaceRoot: root });
      try {
        await fs.ensureDir(path.join(root, 'lib/a'));
        await fs.ensureDir(path.join(root, 'lib/b'));
        await fs.writeFile(path.join(root, 'lib/a/service.dart'), 'class Widget {}\n');
        await fs.writeFile(path.join(root, 'lib/b/service.dart'), 'class Widget {}\n');
        await fs.writeFile(
          path.join(root, 'lib/main.dart'),
          [
            "import 'a/service.dart' as a;",
            "import 'b/service.dart' as b;",
            'class Main {',
            '  a.Widget aw;',
            '  b.Widget bw;',
            '}',
          ].join('\n')
        );

        const archJson = await aliasPlugin.parseProject(root, {
          workspaceRoot: root,
          excludePatterns: [],
        });

        const main = archJson.entities.find((e) => e.name === 'Main');
        const aWidget = archJson.entities.find((e) => e.id === 'lib.a.Widget');
        const bWidget = archJson.entities.find((e) => e.id === 'lib.b.Widget');
        expect(main).toBeDefined();

        expect(
          archJson.relations.some(
            (r) => r.type === 'composition' && r.source === main?.id && r.target === aWidget?.id
          )
        ).toBe(true);
        expect(
          archJson.relations.some(
            (r) => r.type === 'composition' && r.source === main?.id && r.target === bWidget?.id
          )
        ).toBe(true);
      } finally {
        await aliasPlugin.dispose();
        await fs.remove(root);
      }
    });

    it('excludes generated assets/l10n code from the architecture graph', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-gen-'));
      try {
        // Hand-written source that must be kept.
        await fs.ensureDir(path.join(root, 'lib'));
        await fs.writeFile(
          path.join(root, 'lib/service.dart'),
          'class RealService { void run() {} }\n'
        );

        // Generated code that must be excluded.
        await fs.ensureDir(path.join(root, 'lib/generated'));
        await fs.writeFile(
          path.join(root, 'lib/generated/l10n.dart'),
          'class L10n { String get title => "x"; }\n'
        );
        await fs.writeFile(
          path.join(root, 'lib/generated/l10n_zh.dart'),
          'class L10nZh extends L10n {}\n'
        );
        await fs.ensureDir(path.join(root, 'lib/gen'));
        await fs.writeFile(
          path.join(root, 'lib/gen/assets.gen.dart'),
          'class Assets { static const logo = "logo.png"; }\n'
        );
        // Top-level l10n entry points outside generated/.
        await fs.writeFile(path.join(root, 'lib/l10n.dart'), 'class TopL10n {}\n');
        await fs.writeFile(path.join(root, 'lib/l10n_base.dart'), 'abstract class L10nBase {}\n');

        const archJson = await plugin.parseProject(root, {
          workspaceRoot: root,
          excludePatterns: [],
        });

        const names = archJson.entities.map((e: Entity) => e.name);
        expect(names).toContain('RealService');
        expect(names).not.toContain('L10n');
        expect(names).not.toContain('L10nZh');
        expect(names).not.toContain('Assets');
        expect(names).not.toContain('TopL10n');
        expect(names).not.toContain('L10nBase');
      } finally {
        await fs.remove(root);
      }
    });

    it('excludes vendored third-party libraries from the architecture graph', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-vendored-'));
      try {
        // Business code that must be kept.
        await fs.ensureDir(path.join(root, 'lib'));
        await fs.writeFile(
          path.join(root, 'lib/service.dart'),
          'class RealService { void run() {} }\n'
        );

        // Vendored third-party library (fluttercandies/pull_to_refresh).
        await fs.ensureDir(path.join(root, 'lib/src/pull_to_refresh_flutter'));
        await fs.writeFile(
          path.join(root, 'lib/src/pull_to_refresh_flutter/smart_refresher.dart'),
          'class SmartRefresherState {}\nclass RefreshPhysics {}\n'
        );
        // Barrel entry point of the vendored library.
        await fs.writeFile(
          path.join(root, 'lib/pull_to_refresh_flutter3.dart'),
          "export 'src/pull_to_refresh_flutter/smart_refresher.dart';\n"
        );

        const archJson = await plugin.parseProject(root, {
          workspaceRoot: root,
          excludePatterns: [],
        });

        const names = archJson.entities.map((e: Entity) => e.name);
        expect(names).toContain('RealService');
        expect(names).not.toContain('SmartRefresherState');
        expect(names).not.toContain('RefreshPhysics');
      } finally {
        await fs.remove(root);
      }
    });

    it('resolves a qualified generic nullable field type (a.Widget<T>?)', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-qn-'));
      const qnPlugin = new DartPlugin(wasmParserBackend);
      await qnPlugin.initialize({ workspaceRoot: root });
      try {
        await fs.ensureDir(path.join(root, 'lib/a'));
        await fs.writeFile(path.join(root, 'lib/a/service.dart'), 'class Widget<T> {}\n');
        await fs.writeFile(
          path.join(root, 'lib/main.dart'),
          ["import 'a/service.dart' as a;", 'class Main {', '  a.Widget<String>? w;', '}'].join(
            '\n'
          )
        );

        const archJson = await qnPlugin.parseProject(root, {
          workspaceRoot: root,
          excludePatterns: [],
        });

        const main = archJson.entities.find((e) => e.name === 'Main');
        const widget = archJson.entities.find((e) => e.id === 'lib.a.Widget');
        expect(main).toBeDefined();
        expect(widget).toBeDefined();
        expect(
          archJson.relations.some(
            (r) => r.type === 'composition' && r.source === main?.id && r.target === widget?.id
          )
        ).toBe(true);
      } finally {
        await qnPlugin.dispose();
        await fs.remove(root);
      }
    });
  });

  describe('tree-sitter-bridge extraction regressions', () => {
    it('does not mistake a show-combinator for an import alias', () => {
      const bridge = (
        plugin as unknown as {
          bridge: {
            parseCode(
              code: string,
              path: string
            ): { imports: Array<{ path: string; alias?: string }> };
          };
        }
      ).bridge;
      const raw = bridge.parseCode(
        "import 'a.dart' show Foo, Bar;\nimport 'b.dart' as b;\n",
        'main.dart'
      );
      const aliasByPath = new Map(raw.imports.map((i) => [i.path, i.alias]));
      expect(aliasByPath.get('a.dart')).toBeUndefined(); // show Foo, Bar → no alias
      expect(aliasByPath.get('b.dart')).toBe('b'); // as b → alias b
    });

    it('skips a comment between `as` and the alias, and ignores hide combinators', () => {
      const bridge = (
        plugin as unknown as {
          bridge: {
            parseCode(
              code: string,
              path: string
            ): { imports: Array<{ path: string; alias?: string }> };
          };
        }
      ).bridge;
      const raw = bridge.parseCode(
        "import 'a.dart' as /* c */ a;\nimport 'b.dart' hide Foo, Bar;\nimport 'c.dart' as x show Foo;\n",
        'main.dart'
      );
      const aliasByPath = new Map(raw.imports.map((i) => [i.path, i.alias]));
      expect(aliasByPath.get('a.dart')).toBe('a'); // comment between as and alias
      expect(aliasByPath.get('b.dart')).toBeUndefined(); // hide → no alias
      expect(aliasByPath.get('c.dart')).toBe('x'); // as + show → alias x
    });

    it('detects abstract on a metadata-annotated class', () => {
      const archJson = plugin.parseCode('@immutable\nabstract class Foo {}\n', 'meta.dart');
      const foo = archJson.entities.find((e) => e.name === 'Foo');
      expect(foo?.type).toBe('abstract_class');
      expect(foo?.isAbstract).toBe(true);
    });

    it('does not mark a plain class with an abstract member as abstract', () => {
      const archJson = plugin.parseCode('class Bar {\n  void baz() {}\n}\n', 'bar.dart');
      const bar = archJson.entities.find((e) => e.name === 'Bar');
      expect(bar?.type).toBe('class');
      expect(bar?.isAbstract).toBeUndefined();
    });

    it('enhanced enum followed by extensions yields no root ERROR pollution', async () => {
      // Regression for the grammar upgrade: tree-sitter-dart@1.0.0 could not
      // parse `ok(200)` / `notFound(404)` enhanced-enum constants, and that
      // parse error cascaded — the trailing `}` plus the following `extension`
      // declarations were swallowed into a single ERROR node. The rebuilt
      // grammar must keep them as clean top-level nodes.
      const session = await wasmParserBackend.createSession('dart');
      const code = [
        'enum E { a(1), b(2); final int x; }',
        'extension Foo on int { int get y => this; }',
        'extension on String { String get z => this; }',
      ].join('\n');
      const tree = session.parse(code);
      const rootTypes = tree.rootNode.namedChildren.map((c) => c.type);
      expect(rootTypes).not.toContain('ERROR');
      expect(rootTypes).toContain('enum_declaration');
      expect(rootTypes.filter((t) => t === 'extension_declaration')).toHaveLength(2);
      tree.dispose();
      session.dispose();
    });
  });

  describe('returnType: modifiers and nullable types', () => {
    const memberByName = (entity: Entity | undefined, name: string) =>
      entity?.members.find((m) => m.name === name);

    it('preserves qualified generic nullable field types across modifiers', () => {
      const code = [
        'class M {',
        '  a.Widget<String>? plain;',
        '  final a.Widget<String>? fin;',
        '  static late final b.Widget svc;',
        '  static const int ci = 1;',
        '  final untyped = 1;',
        '}',
      ].join('\n');
      const archJson = plugin.parseCode(code, 'types.dart');
      const m = archJson.entities.find((e) => e.name === 'M');
      expect(memberByName(m, 'plain')?.fieldType).toBe('a.Widget<String>?');
      expect(memberByName(m, 'fin')?.fieldType).toBe('a.Widget<String>?');
      expect(memberByName(m, 'svc')?.fieldType).toBe('b.Widget');
      expect(memberByName(m, 'ci')?.fieldType).toBe('int');
      expect(memberByName(m, 'untyped')?.fieldType).toBe('dynamic');
    });

    it('preserves nullable qualified generic method return types', () => {
      const archJson = plugin.parseCode(
        'class M {\n  a.Widget<T>? make() => null;\n}\n',
        'types.dart'
      );
      const m = archJson.entities.find((e) => e.name === 'M');
      expect(memberByName(m, 'make')?.returnType).toBe('a.Widget<T>?');
    });
  });

  describe('isTestFile', () => {
    it('detects *_test.dart files regardless of directory', () => {
      expect(plugin.isTestFile?.('test/foo_test.dart')).toBe(true);
      expect(plugin.isTestFile?.('lib/foo_test.dart')).toBe(true);
    });

    it('does not treat helpers/fixtures in a test/ directory as test files', () => {
      expect(plugin.isTestFile?.('lib/foo.dart')).toBe(false);
      expect(plugin.isTestFile?.('test/foo_helper.dart')).toBe(false);
      expect(plugin.isTestFile?.('lib/test/defense/boundary_condition_base.dart')).toBe(false);
    });

    it('honors custom testFileGlobs', () => {
      expect(plugin.isTestFile?.('spec/foo_spec.dart', { testFileGlobs: ['**/*_spec.dart'] })).toBe(
        true
      );
      expect(plugin.isTestFile?.('lib/foo.dart', { testFileGlobs: ['**/*_spec.dart'] })).toBe(
        false
      );
    });
  });

  describe('extractTestStructure', () => {
    it('extracts test/testWidgets cases with skip flags and assertions', () => {
      const code = readFileSync(TEST_FIXTURE, 'utf8');
      const result = plugin.extractTestStructure(TEST_FIXTURE, code);
      if (!result) throw new Error('expected test structure');

      const names = result.testCases.map((c) => c.name);
      expect(names).toContain('bark returns woof');
      expect(names).toContain('renders a widget');
      expect(names).toContain('skipped test');

      const skipped = result.testCases.find((c) => c.name === 'skipped test');
      expect(skipped?.isSkipped).toBe(true);

      expect(result.frameworks).toContain('flutter_test');
      expect(result.frameworks).toContain('test');
      expect(result.totalAssertions).toBeGreaterThanOrEqual(4);
      // `import 'sample.dart'` resolves to an absolute project-internal path.
      expect(result.importedSourceFiles).toContain(FIXTURE);
    });

    it('returns null for non-test files', () => {
      expect(plugin.extractTestStructure(FIXTURE, readFileSync(FIXTURE, 'utf8'))).toBeNull();
    });

    it('resolves package: imports to workspace paths via pubspec (monorepo)', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-mono-'));
      try {
        await fs.ensureDir(path.join(root, 'packages/foo/lib/common'));
        await fs.ensureDir(path.join(root, 'packages/foo/test'));
        await fs.writeFile(path.join(root, 'packages/foo/pubspec.yaml'), 'name: foo\n');
        await fs.writeFile(
          path.join(root, 'packages/foo/lib/common/product.dart'),
          'class Product {}\n'
        );
        const testFile = path.join(root, 'packages/foo/test/product_test.dart');
        await fs.writeFile(
          testFile,
          [
            "import 'package:foo/common/product.dart';",
            "import 'package:flutter/widgets.dart';",
            "import 'dart:core';",
            '',
            'void main() {',
            "  test('works', () { expect(Product(), isNotNull); });",
            '}',
          ].join('\n')
        );

        const monoPlugin = new DartPlugin(wasmParserBackend);
        await monoPlugin.initialize({ workspaceRoot: root });
        try {
          const result = monoPlugin.extractTestStructure(
            testFile,
            await fs.readFile(testFile, 'utf8')
          );
          if (!result) throw new Error('expected test structure');
          expect(result.importedSourceFiles).toContain(
            path.join(root, 'packages/foo/lib/common/product.dart')
          );
          // External deps (flutter) and core libs are not project-internal.
          expect(result.importedSourceFiles).not.toContain(expect.stringContaining('flutter'));
        } finally {
          await monoPlugin.dispose();
        }
      } finally {
        await fs.remove(root);
      }
    });
  });
});
