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

type Builder = typeof TanstackBuild;

/**
 * What the Studio uses out of the builder package: four methods, each of which
 * may answer later.
 *
 * Later because the builder runs in a worker (see {@link importBuilder}), so
 * even `bakedGit` -- synchronous in the package -- is a round trip here. The
 * package module itself still satisfies this type, which is what lets a test
 * hand one in.
 */
export type StudioBuilder = {
  bakedGit: (
    ...args: Parameters<Builder["bakedGit"]>
  ) =>
    | ReturnType<Builder["bakedGit"]>
    | Promise<ReturnType<Builder["bakedGit"]>>;
  rebakeGit: (
    ...args: Parameters<Builder["rebakeGit"]>
  ) =>
    | ReturnType<Builder["rebakeGit"]>
    | Promise<ReturnType<Builder["rebakeGit"]>>;
  buildUserApp: Builder["buildUserApp"];
  publishArtifacts: Builder["publishArtifacts"];
};

export type BuilderLoader = () => Promise<StudioBuilder>;

/**
 * The package, loaded into whatever realm calls this.
 *
 * A bare dynamic import of the package root, and deliberately nothing else: the
 * specifier has to stay a literal so a bundler can see it, and so
 * `noNodeFromBrowser.test.ts`'s static walk can too. It is the ONLY import of
 * the package in the Studio (`onlyBuilderRoot.test.ts`); the worker reaches the
 * package through this function rather than importing it itself.
 */
export const importBuilderModule = () => import("@valbuild/tanstack-build");

/**
 * The real loader: the builder in a worker.
 *
 * ## Why not on the page
 *
 * Rolldown's browser build runs threaded wasm whose threads share memory, and
 * when the thread that called into it has to wait for one of them it BLOCKS
 * with an atomic wait. A page's main thread may not: Chromium throws
 * "Atomics.wait cannot be called in this context", WebKit reports an
 * out-of-bounds memory access, and in both the promise the publish is awaiting
 * never settles -- "Building" spinning forever, some of the time, depending on
 * timing. Measured with 400 modules and async plugin hooks: on the main thread
 * both engines hung on the first or second build; in a worker, 40 builds out of
 * 40 finished.
 *
 * A browser without `Worker` builds on the page, which is how it always did.
 */
const importBuilder: BuilderLoader = () =>
  typeof Worker === "undefined"
    ? importBuilderModule()
    : /*
       * Its own module, loaded here: it needs `import.meta.url` to find the
       * worker, and that is ES module syntax jest's CommonJS cannot load --
       * every test of this file injects a builder instead and never gets here.
       */
      import("./builderWorkerClient").then(({ workerBuilder }) =>
        workerBuilder({
          // A worker that died is a load to forget, so a retry starts anew.
          onBroken: () => {
            pending = null;
          },
        }),
      );

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

/**
 * Generates `src/routeTree.gen.ts`, where a deployment can supply one.
 *
 * A capability rather than something this package contains, for the same
 * reason `routeSplitter` and `loadCssModule` are on `BuildInput`: it is
 * TanStack's generator over babel, it needs a browser build of 2.6 MB, and it
 * is not published. Whoever mounts the Studio is the only party that can have
 * one.
 *
 * `null` is the normal state and is not an error until a FILE-BASED project is
 * published -- a project whose pages are data never needs one. See
 * `runStudioDeploy`, which refuses that case by name rather than letting
 * rolldown report a missing entry point.
 *
 * ## How a deployment supplies one: a global
 *
 * Not an import and not a prop, because there is no seam for either. The
 * Studio is its own bundle, served from `/api/val/static` and booted by a
 * script tag; the app that mounts it never gets a module reference into it, so
 * it cannot pass a function in. {@link RUNTIME_GLOBAL} is therefore the
 * contract, and it is the same shape the wasm URL already uses -- a deployment
 * writes one global on the Studio's document before the bundle runs.
 *
 * That is within reach of the party that needs it: a platform serving the
 * Studio is already rewriting that HTML, so a script tag that loads its own
 * generator and assigns this is one more append.
 */
export type RouteTreeGenerator = (
  files: Record<string, string>,
) => Promise<Record<string, string>>;

/** Where a deployment writes its generator. See the note above. */
export const RUNTIME_GLOBAL = "__VAL_ROUTE_TREE_GENERATOR__";

let routeTree: RouteTreeGenerator | null = null;

/**
 * Set one directly, for a test.
 *
 * Returns the previous one so a test can put it back; a test that forgets
 * would otherwise leak a fake into every test after it in the same file.
 */
export function setRouteTreeGenerator(
  next: RouteTreeGenerator | null,
): RouteTreeGenerator | null {
  const previous = routeTree;
  routeTree = next;
  return previous;
}

/**
 * The generator this page has, or `null`.
 *
 * Read on every call rather than captured at module load: the script that
 * assigns the global is the deployment's, and nothing here gets to say whether
 * it runs before or after this module is evaluated.
 *
 * A global that is present but not a function is treated as absent. That is a
 * deployment with a broken injection, and the refusal in `runStudioDeploy`
 * names what to do about it -- where calling it would throw a TypeError from
 * inside the build instead.
 *
 * What it ANSWERS is checked too, and for the same reason one layer down: this
 * value crosses into the build as the project's whole file tree, so a
 * generator that answers a promise of the wrong thing would otherwise surface
 * as rolldown failing to resolve a module.
 */
export function routeTreeGenerator(
  scope: Record<string, unknown> = globalThis,
): RouteTreeGenerator | null {
  if (routeTree !== null) {
    return routeTree;
  }
  const supplied: unknown = scope[RUNTIME_GLOBAL];
  if (!isCallable(supplied)) {
    return null;
  }
  return async (files) => {
    const answered: unknown = await supplied(files);
    if (!isFileRecord(answered)) {
      throw new Error(
        `The route generator this page was given (globalThis.${RUNTIME_GLOBAL}) ` +
          "did not answer with a file tree.",
      );
    }
    return answered;
  };
}

/**
 * Narrows the global to something that can be called with a file tree.
 *
 * A guard rather than a cast, because `typeof x === "function"` is all anyone
 * can know about a value another party wrote onto `globalThis` -- what it
 * ANSWERS is checked above, where checking it is worth something.
 */
const isCallable = (
  value: unknown,
): value is (files: Record<string, string>) => unknown =>
  typeof value === "function";

const isFileRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

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
