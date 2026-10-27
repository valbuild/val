/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder for @valbuild/shared
import React from "react";
import { act, render, screen } from "@testing-library/react";
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
    //
    // The render is wrapped in an awaited `act`: React 19 errors out ("A
    // component suspended inside an `act` scope, but the `act` call was not
    // awaited") when a render suspends inside the synchronous `act` that
    // Testing Library wraps `render` in.
    await act(async () => {
      render(tree(store, true));
    });
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
