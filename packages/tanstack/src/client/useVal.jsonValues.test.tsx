/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder for @valbuild/shared
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { initVal, type Json, ModuleFilePath } from "@valbuild/core";
import { raw } from "@valbuild/react/stega";
import { initValClient } from "./initValClient";
import { ValExternalStore, ValOverlayProvider } from "../ValOverlayContext";

const { s, c } = initVal();
const { useValStega, useValKeyStega } = initValClient({});

/**
 * A `.jsonValues()` record whose entries count their imports. A path per test:
 * the readers keep an entry's import once it has started, by module and key.
 */
function notes(path: string) {
  const imports = { a: jest.fn(), b: jest.fn() };
  const module = c.define(
    path as ModuleFilePath,
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      a: c.json(() => {
        imports.a();
        return Promise.resolve({ default: { title: "Note A" } });
      }),
      b: c.json(() => {
        imports.b();
        return Promise.resolve({ default: { title: "Note B" } });
      }),
    },
  );
  return { module, imports, path: path as ModuleFilePath };
}

function tree(
  child: React.ReactElement,
  options: {
    store?: ValExternalStore;
    draftMode?: boolean;
    snapshot?: Record<ModuleFilePath, Json>;
  } = {},
) {
  return React.createElement(ValOverlayProvider, {
    store: options.store ?? new ValExternalStore(),
    suspend: false,
    draftMode: options.draftMode ?? false,
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
    children: React.createElement(React.Suspense, {
      fallback: React.createElement("span", { "data-testid": "fallback" }),
      children: child,
    }),
  });
}

function All({ module }: { module: ReturnType<typeof notes>["module"] }) {
  const all = useValStega(module);
  return React.createElement(
    "ul",
    { "data-testid": "notes" },
    Object.entries(all).map(([key, note]) =>
      React.createElement("li", { key }, `${key}: ${raw(note.title)}`),
    ),
  );
}

const listed = () =>
  [...screen.getByTestId("notes").querySelectorAll("li")].map(
    (li) => li.textContent,
  );

/*
 * `useVal` on a whole `.jsonValues()` record reads EVERY entry's content. Its
 * own source holds only lazy markers, and encoding that rendered every entry
 * empty -- in production, server and browser alike, on Val's own showcase.
 * `useValKey` is the reader for one entry, and loads only that one.
 */
describe("useVal on a .jsonValues() record", () => {
  it("renders every entry's content, loaded from the bundle", async () => {
    const { module, imports } = notes("/notes-all.val.ts");
    await act(async () => {
      render(tree(React.createElement(All, { module })));
    });
    expect(listed()).toEqual(["a: Note A", "b: Note B"]);
    expect(imports.a).toHaveBeenCalledTimes(1);
    expect(imports.b).toHaveBeenCalledTimes(1);
  });

  it("takes an entry the draft view has from there, and the rest from the bundle", async () => {
    const { module, imports, path } = notes("/notes-draft.val.ts");
    const store = new ValExternalStore();
    await act(async () => {
      render(
        tree(React.createElement(All, { module }), { store, draftMode: true }),
      );
    });
    await act(async () => {
      // The Studio loaded and edited "a"; "b" is still a marker it never loaded.
      store.update(path, { a: { title: "Edited A" }, b: { _type: "json" } });
    });
    expect(listed()).toEqual(["a: Edited A", "b: Note B"]);
    expect(imports.b).toHaveBeenCalledTimes(1);
  });

  it("leaves out an entry the draft view deleted", async () => {
    const { module, path } = notes("/notes-deleted.val.ts");
    const store = new ValExternalStore();
    await act(async () => {
      render(
        tree(React.createElement(All, { module }), { store, draftMode: true }),
      );
    });
    await act(async () => {
      store.update(path, { a: { _type: "json" } });
    });
    expect(listed()).toEqual(["a: Note A"]);
  });

  it("at a proposal's address, reads the entries its snapshot has, and imports none of them", async () => {
    const { module, imports, path } = notes("/notes-snapshot.val.ts");
    await act(async () => {
      render(
        tree(React.createElement(All, { module }), {
          snapshot: {
            [path]: { a: { title: "Saved A" }, b: { title: "Saved B" } },
          },
        }),
      );
    });
    expect(listed()).toEqual(["a: Saved A", "b: Saved B"]);
    expect(imports.a).not.toHaveBeenCalled();
    expect(imports.b).not.toHaveBeenCalled();
  });
});

describe("useValKey on a .jsonValues() record", () => {
  it("loads only the entry it names", async () => {
    const { module, imports } = notes("/notes-key.val.ts");
    function One() {
      const note = useValKeyStega(module, "a");
      return React.createElement(
        "span",
        { "data-testid": "one" },
        note === undefined ? "nothing" : raw(note.title),
      );
    }
    await act(async () => {
      render(tree(React.createElement(One)));
    });
    expect(screen.getByTestId("one").textContent).toBe("Note A");
    expect(imports.a).toHaveBeenCalledTimes(1);
    expect(imports.b).not.toHaveBeenCalled();
  });
});
