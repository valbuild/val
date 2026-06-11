/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder for @valbuild/shared
import React from "react";
import { act, render, screen } from "@testing-library/react";

// Production requires React 19 (React.use). The test environment stays on React 18
// to avoid a large dependency upgrade across the monorepo. This polyfill makes
// React.use available so the integration test still exercises the real Suspense flow.
// When the monorepo eventually upgrades to React 19, delete this block.
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
    throw promise; // pending: React 18 Suspense catches the thrown promise
  });
}
import { initVal, ModuleFilePath } from "@valbuild/core";
import { initValClient } from "./initValClient";
import { ValExternalStore, ValOverlayProvider } from "../ValOverlayContext";

const { s, c } = initVal();
const valModule = c.define("/test.val.ts", s.string(), "published");
const path = "/test.val.ts" as ModuleFilePath;

const { useValStega } = initValClient({});

function Show() {
  const val = useValStega(valModule);
  return React.createElement("span", { "data-testid": "val" }, val);
}

function tree(
  store: ValExternalStore,
  suspend: boolean,
  draftMode: boolean | null = true,
) {
  return React.createElement(ValOverlayProvider, {
    store,
    suspend,
    draftMode,
    children: React.createElement(React.Suspense, {
      fallback: React.createElement(
        "span",
        { "data-testid": "fallback" },
        "loading",
      ),
      children: React.createElement(Show),
    }),
  });
}

describe("useValStega Suspense", () => {
  it("suspends while Val is enabled until the module loads, then renders the draft value", async () => {
    const store = new ValExternalStore();

    // Enabled with no data loaded yet -> the component suspends. Note we do NOT
    // pre-subscribe: a suspended first render never commits, so the source is
    // update()'d before useSyncExternalStore subscribes. The store must still
    // surface it on the retry render (otherwise useValRoute would 404).
    render(tree(store, true));
    expect(screen.getByTestId("fallback")).toBeTruthy();
    expect(screen.queryByTestId("val")).toBeNull();

    // The draft source arrives -> waitForLoad resolves -> Suspense renders the
    // draft value ("draft-value"), not the published "published".
    await act(async () => {
      store.update(path, "draft-value");
    });
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(screen.getByTestId("val").textContent).toContain("draft-value");
  });

  it("does not suspend when Val is not enabled", () => {
    const store = new ValExternalStore();
    render(tree(store, false));
    // No data loaded, but Val is disabled, so it renders immediately with the
    // published value instead of suspending.
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(screen.getByTestId("val").textContent).toContain("published");
  });

  it("does not suspend when draft mode is known to be off", () => {
    const store = new ValExternalStore();
    // Val is enabled (suspend) but draft mode is off: the store never receives
    // source updates in that state, so suspending could only ever resolve via
    // the waitForLoad timeout — and would then re-suspend on every render.
    // The draftMode !== false release valve renders the published value
    // immediately instead.
    render(tree(store, true, false));
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(screen.getByTestId("val").textContent).toContain("published");
  });
});
