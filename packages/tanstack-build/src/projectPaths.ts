/**
 * Paths the platform's contract fixes, in one place.
 *
 * These are not conventions this package chose -- `src/app.tsx` is the module
 * the builder resolves as its entry, and `src/routeTree.gen.ts` is what
 * TanStack's generator is configured to write. They are here so that a change
 * on either side is one edit rather than a search for string literals.
 */

/** The module the builder uses as the project's entry. */
export const ENTRY = "src/app.tsx";

/** Where TanStack's generator writes the route tree. */
export const TREE = "src/routeTree.gen.ts";

/** Where a file-based project keeps its route files. */
export const ROUTES_DIR = "src/routes";

/**
 * The one line the builder needs from a file-based project, as `src/app.tsx`.
 *
 * `src/app.tsx` is the entry the builder looks for, and a routes-as-data
 * project writes it. A file-based project has no such file -- its entry IS
 * the generated tree -- so every route generator adds this, and it is the
 * same line wherever that runs (the `/node` entrypoint's `withRouteTree`, and
 * the platform's browser generator, which reaches it through `/constants`).
 */
export const ENTRY_SHIM = `export { routeTree } from './routeTree.gen'\n`;
