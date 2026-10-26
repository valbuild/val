import type { build } from "@rolldown/browser";
import type { parseAstAsync } from "@rolldown/browser/parseAst";

/**
 * The bundler the build runs on, chosen by where it runs.
 *
 * The build is the same code in a browser tab and in Node, and rolldown comes
 * in two builds with one API: `@rolldown/browser`, compiled to WebAssembly,
 * and `rolldown`, the native one. A tab can only have the first. Node should
 * not load it: it reaches its WebAssembly through `@napi-rs/wasm-runtime`, a
 * dependency whose version the SITE'S lockfile picks, and rolldown's own
 * ranges have let a release in that does not load (2026-10-26, below). The
 * native one has no such glue. So nothing in this package imports either
 * statically: Node is handed the native one (`useRolldown`, with
 * `nativeRolldown` from `@valbuild/tanstack-build/node`), and anything not
 * handed one gets the browser build, imported on first use.
 *
 * Why not just the browser build in both, as it was until 2026-10-26:
 * `@rolldown/browser` 1.2.15 pins `@emnapi/core` 2.0.0-alpha.5 and asks for
 * `@napi-rs/wasm-runtime` `~1.2.5`, and wasm-runtime 1.2.6 (2026-10-25) only
 * works with `@emnapi/core` 1.x or 2.0.0-beta.2 -- loading it throws
 * "Cannot set properties of undefined (setting 'initWorker')". Any site whose
 * lockfile was resolved after that release (an upgrade, a `pnpm update`)
 * could no longer `val publish`. The Studio's tab and Val Build's upgrade page
 * are not exposed to it: they bundle the browser build from their own
 * lockfiles, where Val's own tests load it before a release.
 */
export interface Rolldown {
  build: typeof build;
  parseAstAsync: typeof parseAstAsync;
}

let chosen: Promise<Rolldown> | null = null;

/** Build on `rolldown` from now on. Node calls it with `nativeRolldown`. */
export function useRolldown(rolldown: Rolldown): void {
  chosen = Promise.resolve(rolldown);
}

/**
 * The bundler, loading the browser build if nobody chose one. Called early by
 * a tab that wants the WebAssembly compiled before the first build needs it.
 */
export function loadRolldown(): Promise<Rolldown> {
  if (chosen === null) {
    const loading = Promise.all([
      import("@rolldown/browser"),
      import("@rolldown/browser/parseAst"),
    ]).then(([bundler, parser]) => ({
      build: bundler.build,
      parseAstAsync: parser.parseAstAsync,
    }));
    // A load that failed is tried again by the next caller, not kept.
    loading.catch(() => {
      if (chosen === loading) chosen = null;
    });
    chosen = loading;
  }
  return chosen;
}
