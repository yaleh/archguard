/**
 * Convert an unknown thrown value into a readable error message.
 *
 * - Error instances → their `.message`
 * - strings → as-is
 * - everything else → JSON.stringify (falls back to '' for undefined)
 *
 * Avoids `String(baseObject)` which yields the unhelpful `[object Object]`
 * (and triggers the `@typescript-eslint/no-base-to-string` rule).
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error) ?? '';
}
