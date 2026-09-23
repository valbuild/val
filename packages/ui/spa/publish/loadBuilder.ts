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
 * ## The page has to be cross-origin isolated
 *
 * `@rolldown/browser` builds on a THREADED WASI runtime: its loader constructs
 * `new WebAssembly.Memory({ shared: true })` at module scope and `postMessage`s
 * it to a worker per core. A browser refuses to transfer a `SharedArrayBuffer`
 * unless the page is cross-origin isolated, so on an ordinary page the import
 * rejects with
 *
 *     DataCloneError: Failed to execute 'postMessage' on 'Worker':
 *     SharedArrayBuffer transfer requires self.crossOriginIsolated
 *
 * from inside `loadWasmModuleToAllWorkers`, which names nothing an editor or a
 * developer could act on. Measured in Chromium both ways: with
 * `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp` on the document, the same import
 * gets past it.
 *
 * Note which part is NOT the problem, because it looks like it should be:
 * constructing the shared memory succeeds on an ordinary page and its buffer
 * really is a `SharedArrayBuffer`, even though the `SharedArrayBuffer` global
 * is not exposed there. The refusal is at the transfer, one step later.
 *
 * So {@link loadBuilder} refuses first, with a message that says what to do.
 * That is not a policy this package can set — the headers belong to the
 * document the Studio is mounted in, which is the app's, and
 * `require-corp` additionally blocks every cross-origin subresource that does
 * not send `Cross-Origin-Resource-Policy`. A CMS whose editors put images from
 * anywhere on a page cannot turn that on without deciding what happens to them.
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

/**
 * Why the builder cannot be loaded here, or `null` when it can.
 *
 * Asked before anything is fetched, so a page that could never run it pays
 * nothing — which is most pages: `crossOriginIsolated` is false unless the
 * document opted in. See the module docblock for what was measured.
 */
export function builderRefusal(
  scope: { crossOriginIsolated?: boolean } = globalThis,
): string | null {
  if (scope.crossOriginIsolated === true) {
    return null;
  }
  return (
    "The bundler needs a cross-origin isolated page: it runs WebAssembly on " +
    "worker threads that share memory, and a browser will not hand a " +
    "SharedArrayBuffer to a worker without it. Serve the page Val is mounted " +
    "in with 'Cross-Origin-Opener-Policy: same-origin' and " +
    "'Cross-Origin-Embedder-Policy: require-corp'."
  );
}

export function loadBuilder(): Promise<StudioBuilder> {
  if (pending === null) {
    const refusal = builderRefusal();
    if (refusal !== null) {
      // Not memoised, and not a rejected `pending`: the page's isolation does
      // not change under us, but a caller that asks again should get the
      // sentence again rather than a stale promise.
      return Promise.reject(new Error(refusal));
    }
    pending = loader().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

/**
 * Whether a load has been STARTED, without starting one.
 *
 * Not "is it in hand" and not "is it still going": the promise is kept after it
 * resolves, so this stays true once anything has asked. What it is for is the
 * one distinction the retry rule needs — a failed load clears it, so a caller
 * can tell "nobody has tried" and "the last try failed" from "a load exists".
 */
export function builderLoadStarted(): boolean {
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
