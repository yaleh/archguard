import { describe, it, expect } from 'vitest';
import type {
  KotlinClassKind,
  KotlinVisibility,
  RawKotlinMember,
  RawKotlinClass,
  RawKotlinFunction,
  RawKotlinFile,
} from '@/plugins/kotlin/types.js';

describe('KotlinClassKind', () => {
  it('covers all class kinds', () => {
    const kinds: KotlinClassKind[] = [
      'class',
      'abstract_class',
      'interface',
      'data_class',
      'sealed_class',
      'sealed_interface',
      'object',
      'companion_object',
      'enum_class',
    ];
    expect(kinds).toHaveLength(9);
  });
});

describe('KotlinVisibility', () => {
  it('covers all visibility modifiers', () => {
    const vis: KotlinVisibility[] = ['public', 'private', 'protected', 'internal'];
    expect(vis).toHaveLength(4);
  });
});

describe('RawKotlinMember', () => {
  it('has required fields', () => {
    const member: RawKotlinMember = {
      name: 'name',
      kind: 'field',
      visibility: 'public',
      isStatic: false,
      decorators: [],
      startLine: 1,
      endLine: 1,
    };
    expect(member.name).toBe('name');
    expect(member.kind).toBe('field');
    expect(member.isStatic).toBe(false);
    expect(member.decorators).toEqual([]);
  });

  it('supports optional type field', () => {
    const member: RawKotlinMember = {
      name: 'repo',
      kind: 'field',
      visibility: 'public',
      type: 'UserRepository',
      isStatic: false,
      decorators: ['Inject'],
      startLine: 5,
      endLine: 5,
    };
    expect(member.type).toBe('UserRepository');
    expect(member.decorators).toContain('Inject');
  });
});

describe('RawKotlinClass', () => {
  it('has required fields', () => {
    const cls: RawKotlinClass = {
      name: 'MainViewModel',
      kind: 'class',
      visibility: 'public',
      packageName: 'com.example.app',
      superTypes: ['ViewModel', 'IObserver'],
      members: [],
      decorators: [],
      filePath: 'src/MainViewModel.kt',
      startLine: 1,
      endLine: 20,
    };
    expect(cls.name).toBe('MainViewModel');
    expect(cls.superTypes).toHaveLength(2);
    expect(cls.kind).toBe('class');
  });

  it('supports data_class kind', () => {
    const dataClass: RawKotlinClass = {
      name: 'UserProfile',
      kind: 'data_class',
      visibility: 'public',
      packageName: 'com.example.app.data',
      superTypes: [],
      members: [
        {
          name: 'name',
          kind: 'field',
          visibility: 'public',
          type: 'String',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
        {
          name: 'id',
          kind: 'field',
          visibility: 'public',
          type: 'Int',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
      decorators: [],
      filePath: 'src/UserProfile.kt',
      startLine: 1,
      endLine: 1,
    };
    expect(dataClass.kind).toBe('data_class');
    expect(dataClass.members).toHaveLength(2);
  });

  it('supports sealed_interface kind', () => {
    const sealed: RawKotlinClass = {
      name: 'Result',
      kind: 'sealed_interface',
      visibility: 'public',
      packageName: 'com.example.app',
      superTypes: [],
      members: [],
      decorators: ['sealed'],
      filePath: 'src/Result.kt',
      startLine: 1,
      endLine: 10,
    };
    expect(sealed.kind).toBe('sealed_interface');
  });
});

describe('RawKotlinFunction', () => {
  it('has required fields', () => {
    const fn: RawKotlinFunction = {
      name: 'ProfileScreen',
      visibility: 'public',
      packageName: 'com.example.app.ui',
      isComposable: true,
      paramTypes: ['MainViewModel'],
      decorators: ['Composable'],
      filePath: 'src/ProfileScreen.kt',
      startLine: 10,
      endLine: 20,
    };
    expect(fn.isComposable).toBe(true);
    expect(fn.paramTypes).toContain('MainViewModel');
  });
});

describe('RawKotlinFile', () => {
  it('has required fields with defaults', () => {
    const file: RawKotlinFile = {
      filePath: 'src/Main.kt',
      packageName: 'com.example.app',
      imports: [],
      classes: [],
      functions: [],
    };
    expect(file.packageName).toBe('com.example.app');
    expect(file.imports).toEqual([]);
  });

  it('supports empty package name for default package', () => {
    const file: RawKotlinFile = {
      filePath: 'Main.kt',
      packageName: '',
      imports: [],
      classes: [],
      functions: [],
    };
    expect(file.packageName).toBe('');
  });
});
