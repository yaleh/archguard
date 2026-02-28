import { Project } from 'ts-morph';

/**
 * BaseExtractor - shared constructor logic for TypeScript extractors.
 *
 * Eliminates the duplicated Project initialization in ClassExtractor,
 * EnumExtractor, InterfaceExtractor, and RelationExtractor.
 */
export abstract class BaseExtractor {
  protected readonly project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
  }
}
