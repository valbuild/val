/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { initVal, Internal, ModuleFilePath } from "@valbuild/core";
import { raw } from "@valbuild/react/stega";
import { initValClient } from "./initValClient";
import { ValExternalStore, ValOverlayProvider } from "../ValOverlayContext";

// React 18 in tests; production requires 19. See useValStega.suspense.test.ts.
if (!("use" in React)) {
  type Entry = {
    status: "pending" | "resolved" | "rejected";
    result?: unknown;
  };
  const cache = new WeakMap<Promise<unknown>, Entry>();
  Reflect.set(React, "use", function use<T>(promise: Promise<T>): T {
    let entry = cache.get(promise);
    if (!entry) {
      const newEntry: Entry = { status: "pending" };
      entry = newEntry;
      cache.set(promise, newEntry);
      promise.then(
        (v) => {
          newEntry.status = "resolved";
          newEntry.result = v;
        },
        (e) => {
          newEntry.status = "rejected";
          newEntry.result = e;
        },
      );
    }
    if (entry.status === "resolved") return entry.result as T;
    if (entry.status === "rejected") throw entry.result;
    throw promise;
  });
}

/**
 * `useValRoute` on a route that exists only in an uncommitted patch.
 *
 * Pinned here rather than only in `e2e/uncommitted-routes.spec.ts`, because the
 * e2e can only see the outcome — a 404, or a loading fallback that eventually
 * clears — and every one of the states below produces one of those two. A route
 * that 404s because draft mode was still unknown and a route that 404s because
 * the gate was never consulted are the same screenshot and different bugs.
 *
 * What a route adds to `useValStega` is that "no answer yet" and "no such route"
 * are the same value: `null`. The page turns `null` into `notFound()`, which is
 * terminal — so getting this wrong is not a flash of stale content, it is a 404
 * no later answer can undo.
 */

const { s, c } = initVal();
/**
 * `Internal.nextAppRouter`, not `initVal().nextAppRouter`.
 *
 * A bare `initVal()` does not expose the routers — an app gets them from its own
 * `val.config`, which passes config in. Destructured from `initVal()` it is
 * `undefined`, `s.router(undefined, ...)` leaves the record with no router, and
 * `useValRoute` then correctly refuses to map params to a key. Which looks
 * exactly like the bug under test.
 */
const nextAppRouter = Internal.nextAppRouter;

/**
 * A real router, because the mapping is the thing `useValRoute` adds.
 *
 * The module file path is what gives a `nextAppRouter` record its pattern, so it
 * has to look like a Next route — `[note]` is the param the test passes, and the
 * keys are the URLs it produces.
 */
const path = "/app/notes/[note]/page.val.ts" as ModuleFilePath;
const routesVal = c.define(
  path,
  s.router(nextAppRouter, s.string(), s.object({ title: s.string() })),
  { "/notes/committed": { title: "committed page" } },
);

/** The same module, plus a route that exists only in a patch. */
const draftSource = {
  "/notes/committed": { title: "committed page" },
  "/notes/uncommitted": { title: "uncommitted page" },
};

const { useValRouteStega } = initValClient({});

function Show({ route }: { route: string }) {
  const entry = useValRouteStega(routesVal, { note: route });
  return React.createElement(
    "span",
    { "data-testid": "val" },
    // What the page does with `null` is `notFound()`, so that is the case worth
    // naming in the output.
    entry === null ? "notFound" : raw(entry.title),
  );
}

function tree(
  store: ValExternalStore,
  opts: {
    route: string;
    suspend: boolean;
    draftMode: boolean | null;
    draftModeReady?: Promise<void>;
    draftSourcesSynced?: boolean;
  },
) {
  return React.createElement(ValOverlayProvider, {
    store,
    suspend: opts.suspend,
    draftMode: opts.draftMode,
    draftModeReady: opts.draftModeReady,
    draftSourcesSynced: opts.draftSourcesSynced,
    children: React.createElement(React.Suspense, {
      fallback: React.createElement(
        "span",
        { "data-testid": "fallback" },
        "loading",
      ),
      children: React.createElement(Show, { route: opts.route }),
    }),
  });
}

const shown = () => screen.queryByTestId("val")?.textContent;
const suspended = () => screen.queryByTestId("fallback") !== null;

describe("useValRoute with draft sources", () => {
  it("resolves a route that exists only in the draft source", () => {
    const store = new ValExternalStore();
    store.update(path, draftSource);
    render(
      tree(store, { route: "uncommitted", suspend: true, draftMode: true }),
    );
    expect(shown()).toContain("uncommitted page");
  });

  /**
   * The bug that produced the 404 on a page you had just created.
   *
   * `draftMode === null` means `/draft/stat` has not answered yet. It is NOT a
   * synonym for off — but the reader that turns a selector into content treats
   * it as off, so a render that gets through here resolves against COMMITTED
   * source, finds no such route, and the page calls `notFound()`. The gate has
   * to wait for the answer, and the store being fully loaded is not a reason to
   * stop waiting: that was exactly the case that slipped through, on a page
   * whose only module is the one that was patched.
   */
  it("waits for draft mode to be known before answering", () => {
    const store = new ValExternalStore();
    store.update(path, draftSource); // nothing left to load
    render(
      tree(store, {
        route: "uncommitted",
        suspend: true,
        draftMode: null,
        draftModeReady: new Promise<void>(() => undefined),
      }),
    );
    expect(
      suspended(),
      // A `notFound` here is the 404 an editor saw.
    ).toBe(true);
    expect(shown()).toBeUndefined();
  });

  it("answers once draft mode is known", async () => {
    const store = new ValExternalStore();
    store.update(path, draftSource);
    let ready = () => undefined as void;
    const draftModeReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const { rerender } = render(
      tree(store, {
        route: "uncommitted",
        suspend: true,
        draftMode: null,
        draftModeReady,
      }),
    );
    expect(suspended()).toBe(true);
    await act(async () => {
      ready();
    });
    rerender(
      tree(store, { route: "uncommitted", suspend: true, draftMode: true }),
    );
    expect(shown()).toContain("uncommitted page");
  });

  /**
   * The other half: stop waiting for sources that are never coming.
   *
   * The editor only sends modules it has PATCHES for — an unedited module has no
   * draft — so a page reading one could not tell "not sent yet" from "nothing to
   * send" and waited out `waitForLoad`'s ten second timeout, once per module.
   * `draftSourcesSynced` is the editor saying it has handed over everything it
   * holds; after it, committed source IS the draft.
   */
  it("does not wait for a module the editor has already finished sending", () => {
    const store = new ValExternalStore(); // never updated
    render(
      tree(store, {
        route: "committed",
        suspend: true,
        draftMode: true,
        draftSourcesSynced: true,
      }),
    );
    expect(suspended()).toBe(false);
    expect(shown()).toContain("committed page");
  });

  it("waits while the editor might still be sending", () => {
    const store = new ValExternalStore();
    render(
      tree(store, {
        route: "committed",
        suspend: true,
        draftMode: true,
        draftSourcesSynced: false,
      }),
    );
    expect(suspended()).toBe(true);
  });

  /**
   * KNOWN HOLE, asserted so it cannot change silently.
   *
   * `suspend` is false on the SSR and hydration renders — `ValNextProvider`
   * turns it on in an effect, which runs after them — so the first render always
   * resolves against committed source. For a field that is a flash of published
   * content; for a route it is `notFound()`, and the response an editor gets IS
   * the 404 document. No client-side gate can rescue that, which is why the
   * e2e for a single-module route is `test.fixme`.
   *
   * Closing it means the first render knowing that Val is enabled, i.e. the
   * server telling it — which is what `suspend={await isValEnabled()}` did
   * before a4c09b2e traded it away to keep layouts synchronous. See
   * architecture/quirks.md.
   */
  it("still 404s a draft-only route on the render before the gate is on", () => {
    // The hydration render: draft mode is on, the gate is not, and the draft
    // source has not arrived — the editor pushes it after hydration. With the
    // gate on this would wait; with it off the route resolves against committed
    // source and the page calls `notFound()`.
    const store = new ValExternalStore();
    render(
      tree(store, { route: "uncommitted", suspend: false, draftMode: true }),
    );
    expect(shown()).toBe("notFound");
  });

  /**
   * And the same render once the gate IS on: it waits instead of 404ing.
   *
   * The pair is the whole argument for the remaining fix. Nothing about the
   * route, the store or draft mode differs between these two tests — only
   * whether the gate was on when the deciding render happened, which today is
   * decided by an effect that runs after it.
   */
  it("waits instead, when the gate is on for that render", () => {
    const store = new ValExternalStore();
    render(
      tree(store, { route: "uncommitted", suspend: true, draftMode: true }),
    );
    expect(suspended()).toBe(true);
  });
});
