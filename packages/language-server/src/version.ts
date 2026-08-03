/**
 * Version of this package, read from its own package.json.
 *
 * Mirrors how `@valbuild/core` reports `Internal.VERSION.core`
 * (see `packages/core/src/index.ts`): the built output lives one directory
 * below the package root, so `../package.json` resolves correctly. Returns
 * `null` rather than throwing if the file cannot be read — the version is only
 * ever used for display, never for behaviour.
 */
export function getLanguageServerVersion(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../package.json").version;
  } catch {
    return null;
  }
}
