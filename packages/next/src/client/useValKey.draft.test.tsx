/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder for @valbuild/shared
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { initVal, ModuleFilePath } from "@valbuild/core";
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

const { s, c } = initVal();

const path = "/pages.val.ts" as ModuleFilePath;
const pagesVal = c.define(
  path,
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/a": c.json(() => Promise.resolve({ default: { title: "published A" } })),
  },
);

const { useValKeyStega } = initValClient({});

function Show({ entryKey }: { entryKey: string }) {
  const entry = useValKeyStega(pagesVal, entryKey);
  return React.createElement(
    "span",
    { "data-testid": "val" },
    entry === undefined ? "nothing" : raw(entry.title),
  );
}

function tree(store: ValExternalStore, entryKey = "/a", draftMode = true) {
  return React.createElement(ValOverlayProvider, {
    store,
    suspend: false,
    draftMode,
    children: React.createElement(React.Suspense, {
      fallback: React.createElement(
        "span",
        { "data-testid": "fallback" },
        "loading",
      ),
      children: React.createElement(Show, { entryKey }),
    }),
  });
}

const shown = () => screen.getByTestId("val").textContent;

/**
 * `useValKey` reads a `.jsonValues()` entry. Until Phase 7 it always resolved the
 * entry's bundled import thunk, so the Studio's unpublished edits were invisible
 * to any client component using it — while the same page's server components
 * showed them.
 */
describe("useValKey draft state", () => {
  it("renders the published entry when there is no draft view", async () => {
    const store = new ValExternalStore();
    await act(async () => {
      render(tree(store, "/a", false));
    });
    expect(shown()).toBe("published A");
  });

  it("renders the DRAFT entry once the overlay has the module", async () => {
    const store = new ValExternalStore();
    await act(async () => {
      render(tree(store));
    });
    await act(async () => {
      // What the sync engine now emits: the module's PATCHED source, with the
      // entry's content substituted in place of its lazy marker.
      store.update(path, { "/a": { title: "edited A" } });
    });
    expect(shown()).toBe("edited A");
  });

  it("renders an entry that exists ONLY in the draft state", async () => {
    const store = new ValExternalStore();
    await act(async () => {
      render(tree(store, "/added"));
    });
    await act(async () => {
      store.update(path, {
        "/a": { title: "published A" },
        "/added": { title: "brand new" },
      });
    });
    expect(shown()).toBe("brand new");
  });

  it("renders nothing for an entry DELETED in the draft state", async () => {
    const store = new ValExternalStore();
    await act(async () => {
      render(tree(store));
    });
    await act(async () => {
      // The module is in the draft view and "/a" is not in it: it was deleted.
      // Falling back to the bundled entry would render content the editor removed.
      store.update(path, { "/b": { title: "some other page" } });
    });
    expect(shown()).toBe("nothing");
  });

  it("falls back to the published entry while the draft view still has a marker", async () => {
    const store = new ValExternalStore();
    await act(async () => {
      render(tree(store));
    });
    await act(async () => {
      // The Studio has not loaded this entry's content yet, so the draft view
      // cannot answer — better the published content than a blank page.
      store.update(path, { "/a": { _type: "json" } });
    });
    expect(shown()).toBe("published A");
  });
});
