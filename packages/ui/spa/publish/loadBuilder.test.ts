import {
  StudioBuilder,
  builderIsLoading,
  loadBuilder,
  preloadBuilder,
  setBuilderLoader,
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
    expect(builderIsLoading()).toBe(false);
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
