/**
 * @jest-environment ./jest-environment.mjs
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";

// Production requires React 19 (React.use). The test environment stays on React 18
// to avoid a large dependency upgrade across the monorepo. This polyfill makes
// React.use available so the integration test still exercises the real Suspense flow.
// When the monorepo eventually upgrades to React 19, delete this block.
if (!("use" in React)) {
  type Entry<T> = { status: "pending" | "resolved" | "rejected"; result?: T };
  const cache = new WeakMap<Promise<unknown>, Entry<unknown>>();
  (React as Record<string, unknown>).use = function use<T>(
    promise: Promise<T>,
  ): T {
    let entry = cache.get(promise as Promise<unknown>) as Entry<T> | undefined;
    if (!entry) {
      entry = { status: "pending" };
      cache.set(promise as Promise<unknown>, entry as Entry<unknown>);
      promise.then(
        (v) => {
          (entry as Entry<T>).status = "resolved";
          (entry as Entry<T>).result = v;
        },
        (e) => {
          (entry as Entry<T>).status = "rejected";
          (entry as Entry<T>).result = e;
        },
      );
    }
    if (entry.status === "resolved") return entry.result as T;
    if (entry.status === "rejected") throw entry.result;
    throw promise; // pending: React 18 Suspense catches the thrown promise
  };
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

function tree(store: ValExternalStore, enabled: boolean) {
  return React.createElement(ValOverlayProvider, {
    store,
    enabled,
    draftMode: true,
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
});
