/**
 * Getting the bundler into the tab.
 *
 * A managed project has nobody to deploy it, so the Studio is the deployer: the
 * build that makes a publish live happens in the same browser that started it.
 * That means `@valbuild/tanstack-build` — and through it `@rolldown/browser`,
 * which is 10.9 MB of WebAssembly — has to be in the page.
 *
 * ## Why a module of its own
 *
 * This file holds the only `import("@valbuild/tanstack-build")` in the Studio,
 * and holds it behind a function that can be replaced. Both halves matter:
 *
 * - **The only one**, so the package's ROOT entry is the only thing reached.
 *   `@valbuild/tanstack-build/node` reads `node_modules` and shells out to the
 *   native bundler; importing it from here would not fail here, it would fail
 *   in whatever bundler the consuming app uses, with a message about a polyfill.
 *   `noNodeFromBrowser.test.ts` in that package enforces the split from the
 *   other side.
 * - **Replaceable**, because nothing that imports it can run under jest.
 *   `@rolldown/browser` is ESM-only and this repository's jest is CommonJS, so
 *   `require(esm)` fails until Node 24.9. Every test of what the Studio DOES
 *   with a builder injects one through {@link setBuilderLoader}; the real
 *   loader is exercised by the end-to-end suites, which run a browser.
 *
 * ## Preload, always, and silently
 *
 * {@link preloadBuilder} is called at mount, for a managed project. There is no
 * prompt and no connection gating: these are non-technical users, and the bytes
 * cost the same whether they are spent while someone reads the page or while
 * they stare at a button. It INSTANTIATES rather than merely prefetching,
 * because compiling the module is about half the wait and a prefetch would
 * leave that half for the click.
 *
 * Failure is silent. A preload that could not reach the static host has not
 * broken anything yet — publish is where that becomes a problem the editor can
 * act on, and saying it twice would mean saying it first at a moment nobody
 * asked a question.
 *
 * ## What publish will add, and why it is not here
 *
 * Publish awaits {@link loadBuilder}, and when it has to wait it is meant to
 * show a determinate `Getting ready…` — 10.9 MB behind a bare spinner is the
 * worst thing to show someone on a slow connection. The only way to get a real
 * number is for the Studio to fetch the binary itself with a byte counter and
 * let the import that follows read the browser's cache, and THAT rests on
 * `Cache-Control` from a host that does not exist yet. It lands with the
 * publish path, against a host whose headers can be checked, rather than as a
 * mechanism shipped on an assumption.
 */

import type * as TanstackBuild from "@valbuild/tanstack-build";

/** What the Studio uses out of the builder package. */
export type StudioBuilder = typeof TanstackBuild;

export type BuilderLoader = () => Promise<StudioBuilder>;

/**
 * The real loader.
 *
 * A bare dynamic import of the package root, and deliberately nothing else: the
 * specifier has to stay a literal so a bundler can see it, and so
 * `noNodeFromBrowser.test.ts`'s static walk can too.
 */
const importBuilder: BuilderLoader = () => import("@valbuild/tanstack-build");

let loader: BuilderLoader = importBuilder;

/**
 * Replace the loader, for a test.
 *
 * Returns the previous one so a test can put it back; a test that forgets would
 * otherwise leak a fake into every test after it in the same file.
 */
export function setBuilderLoader(next: BuilderLoader): BuilderLoader {
  const previous = loader;
  loader = next;
  pending = null;
  return previous;
}

/**
 * The one in-flight load.
 *
 * Shared rather than per-caller: the preload at mount and a publish that could
 * not wait are the same load, and starting a second would download the binary
 * twice. Cleared on failure so a retry is possible — a memoised REJECTION would
 * make a publish after a dropped connection fail forever without another
 * attempt.
 */
let pending: Promise<StudioBuilder> | null = null;

export function loadBuilder(): Promise<StudioBuilder> {
  if (pending === null) {
    pending = loader().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

/** Whether the builder is already in hand, without starting a load. */
export function builderIsLoading(): boolean {
  return pending !== null;
}

/**
 * Start loading, at idle, and never report a failure.
 *
 * `requestIdleCallback` where there is one — Safari had none until recently and
 * the fallback is a timeout rather than nothing, because a preload that never
 * starts turns every first publish into the slow path.
 */
export function preloadBuilder(): void {
  const start = () => {
    void loadBuilder().catch(() => {
      // Deliberately silent; see the module docblock.
    });
  };
  const idle = (
    globalThis as {
      requestIdleCallback?: (callback: () => void) => unknown;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") {
    idle(start);
  } else {
    setTimeout(start, 0);
  }
}
