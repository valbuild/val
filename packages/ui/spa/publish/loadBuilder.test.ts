import {
  RUNTIME_GLOBAL,
  StudioBuilder,
  builderLoadStarted,
  builderRefusal,
  loadBuilder,
  preloadBuilder,
  routeTreeGenerator,
  setBuilderLoader,
  setRouteTreeGenerator,
} from "./loadBuilder";

/**
 * How the Studio gets hold of the bundler.
 *
 * Every test here injects a loader, and that is the whole reason
 * {@link setBuilderLoader} exists: the real one is
 * `import("@valbuild/tanstack-build")`, which reaches `@rolldown/browser` --
 * ESM-only, WASI-backed, and not `require`-able from this repository's
 * CommonJS jest until Node 24.9. The real import is exercised by the end-to-end
 * suites, which run a browser.
 *
 * What is worth testing without a builder turns out to be most of it: the
 * download happens once, a failure does not poison the next attempt, and a
 * preload never reports anything.
 */

const builder = {} as StudioBuilder;

beforeEach(() => {
  setBuilderLoader(async () => builder);
  // Every test below is about what happens once the page CAN run the builder.
  // jsdom is not cross-origin isolated, and `loadBuilder` refuses first — see
  // the suite at the bottom, which is where that refusal is tested.
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
});

afterEach(() => {
  delete (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
});

describe("loading once", () => {
  test("a second caller joins the first load rather than starting another", async () => {
    // 10.9 MB. A preload at mount and a publish that could not wait are the
    // same load; two would be two downloads.
    let calls = 0;
    setBuilderLoader(async () => {
      calls++;
      return builder;
    });
    const [first, second] = await Promise.all([loadBuilder(), loadBuilder()]);
    expect(first).toBe(builder);
    expect(second).toBe(builder);
    expect(calls).toBe(1);
  });

  test("and a caller after it has finished gets it without loading again", async () => {
    let calls = 0;
    setBuilderLoader(async () => {
      calls++;
      return builder;
    });
    await loadBuilder();
    await loadBuilder();
    expect(calls).toBe(1);
  });
});

describe("after a failure", () => {
  test("the next attempt really tries again", async () => {
    // A memoised rejection would make every publish after one dropped
    // connection fail forever, without another request being made -- and the
    // editor has no way to tell that from the host being down.
    let calls = 0;
    setBuilderLoader(async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return builder;
    });
    await expect(loadBuilder()).rejects.toThrow("offline");
    expect(builderLoadStarted()).toBe(false);
    await expect(loadBuilder()).resolves.toBe(builder);
    expect(calls).toBe(2);
  });
});

describe("preloading", () => {
  test("never reports a failure", async () => {
    /*
     * Deliberately silent. A preload that could not reach the static host has
     * not broken anything yet: publish is where that becomes something the
     * editor can act on, and saying it at mount would be answering a question
     * nobody asked. An unhandled rejection here would surface in the console of
     * every Studio that is merely offline.
     */
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    setBuilderLoader(async () => {
      throw new Error("offline");
    });
    preloadBuilder();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("starts the load even where there is no requestIdleCallback", async () => {
    // Safari had none for years. Doing nothing there would turn every first
    // publish into the slow path, silently.
    const idle = (globalThis as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    delete (globalThis as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    let calls = 0;
    setBuilderLoader(async () => {
      calls++;
      return builder;
    });
    preloadBuilder();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (idle !== undefined) {
      (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback =
        idle;
    }
    expect(calls).toBe(1);
  });
});

/**
 * A page that is not cross-origin isolated cannot run the bundler at all.
 *
 * `@rolldown/browser` posts a `SharedArrayBuffer` to a worker per core, and a
 * browser refuses that transfer outside an isolated page. Measured in Chromium
 * both ways; see the module docblock. The failure without this guard is a
 * `DataCloneError` thrown from inside `loadWasmModuleToAllWorkers`, which says
 * nothing about what to do.
 */
describe("a page that is not cross-origin isolated", () => {
  test("is refused before anything is fetched", async () => {
    // The point of refusing FIRST: 10.9 MB is not downloaded to discover this.
    delete (globalThis as { crossOriginIsolated?: boolean })
      .crossOriginIsolated;
    let calls = 0;
    setBuilderLoader(async () => {
      calls++;
      return builder;
    });
    await expect(loadBuilder()).rejects.toThrow(/cross-origin isolated/);
    expect(calls).toBe(0);
    expect(builderLoadStarted()).toBe(false);
  });

  test("the refusal names the two headers that fix it", () => {
    // It is the app's document that has to send them, not anything in this
    // package, so the message has to be actionable on its own.
    const refusal = builderRefusal({});
    expect(refusal).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(refusal).toContain("Cross-Origin-Embedder-Policy: require-corp");
  });

  test("and an isolated one is not refused", () => {
    expect(builderRefusal({ crossOriginIsolated: true })).toBeNull();
  });
});

describe("the route tree generator a deployment supplies", () => {
  afterEach(() => {
    setRouteTreeGenerator(null);
  });

  test("absent, by default", () => {
    expect(routeTreeGenerator({})).toBeNull();
  });

  test("read from the global, because there is no other seam", async () => {
    // The Studio is its own bundle booted by a script tag; the app that mounts
    // it never gets a module reference in, so it cannot pass a function.
    const scope = {
      [RUNTIME_GLOBAL]: (files: Record<string, string>) => ({
        ...files,
        "src/routeTree.gen.ts": "generated",
      }),
    };
    const generator = routeTreeGenerator(scope);
    expect(generator).not.toBeNull();
    await expect(generator?.({ "a.ts": "x" })).resolves.toEqual({
      "a.ts": "x",
      "src/routeTree.gen.ts": "generated",
    });
  });

  test("read on every call, not captured at module load", () => {
    // Whether the deployment's script runs before or after this module is
    // evaluated is not this module's to decide.
    const scope: Record<string, unknown> = {};
    expect(routeTreeGenerator(scope)).toBeNull();
    scope[RUNTIME_GLOBAL] = (files: Record<string, string>) => files;
    expect(routeTreeGenerator(scope)).not.toBeNull();
  });

  test("something that is not a function is absent, not a crash", () => {
    // A deployment with a broken injection. `runStudioDeploy` then refuses by
    // name; calling it would be a TypeError from inside the build.
    expect(routeTreeGenerator({ [RUNTIME_GLOBAL]: "yes please" })).toBeNull();
  });

  test("an answer that is not a file tree is refused by name", async () => {
    const generator = routeTreeGenerator({
      [RUNTIME_GLOBAL]: () => ({ "a.ts": 42 }),
    });
    await expect(generator?.({})).rejects.toThrow(/did not answer/i);
  });

  test("one set directly wins, so a test can replace it", () => {
    const scope = {
      [RUNTIME_GLOBAL]: (files: Record<string, string>) => files,
    };
    const mine = async (files: Record<string, string>) => files;
    setRouteTreeGenerator(mine);
    expect(routeTreeGenerator(scope)).toBe(mine);
  });
});
