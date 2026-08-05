/**
 * Errors raised by the knowledge pack registry (TASK-63).
 */

/** Thrown when a pack directory is missing a manifest.json. */
export class PackNotFoundError extends Error {
  constructor(
    readonly packPath: string,
    message?: string
  ) {
    super(message ?? `No knowledge pack found at '${packPath}' (missing manifest.json)`);
    this.name = 'PackNotFoundError';
  }
}
