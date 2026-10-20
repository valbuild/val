/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder for @valbuild/shared
import React from "react";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { initVal } from "@valbuild/core";
import { stegaDecodeStrings } from "@valbuild/react/stega";
import { initValClient } from "./initValClient";
import { ValOverlayProvider } from "../ValOverlayContext";

const { s, c } = initVal();

const pageVal = c.define(
  "/content/page.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);

const { useValStega } = initValClient({});

function Title() {
  const page = useValStega(pageVal);
  return React.createElement("h1", { "data-testid": "title" }, page.title);
}

function tree(context: { analytics?: boolean; draftMode: boolean | null }) {
  return React.createElement(ValOverlayProvider, {
    suspend: false,
    draftMode: context.draftMode,
    analytics: context.analytics,
    children: React.createElement(Title),
  });
}

/** The content paths the edit tags in `text` name, or none. */
const tagsIn = (text: string | null | undefined) =>
  stegaDecodeStrings(text ?? "") ?? [];

const TITLE = '/content/page.val.ts?p="title"';

/**
 * What the hooks hand a component: a string carrying its edit tag, or not.
 * Turning that tag into a `data-val-path` attribute is `autoTagJSX`'s job, in
 * the app's own JSX runtime, so these tests read the tag off the text.
 *
 * Server-render `element`, then hydrate the same element over that HTML, the
 * way a visitor's browser does. Returns the server's HTML, the element after
 * hydration, and what React reported while hydrating.
 */
async function serverThenHydrate(element: React.ReactElement) {
  const html = renderToString(element);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: unknown[][] = [];
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
  const recoverableErrors: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, element, {
      onRecoverableError: (error) => {
        recoverableErrors.push(error);
      },
    });
  });
  consoleError.mockRestore();
  const title = container.querySelector("[data-testid=title]");
  container.remove();
  return { html, title, errors, recoverableErrors };
}

describe("analytics mode", () => {
  it("sends the same HTML with analytics on as with it off", () => {
    const on = renderToString(tree({ analytics: true, draftMode: null }));
    const off = renderToString(tree({ analytics: false, draftMode: null }));
    expect(on).toBe(off);
    expect(tagsIn(on)).toEqual([]);
  });

  it("tags content for a visitor after hydration, without a mismatch", async () => {
    const { title, errors, recoverableErrors } = await serverThenHydrate(
      tree({ analytics: true, draftMode: null }),
    );
    expect(recoverableErrors).toEqual([]);
    expect(errors).toEqual([]);
    expect(tagsIn(title?.textContent)).toEqual([TITLE]);
  });

  it("leaves content untagged for a visitor with analytics off", async () => {
    const { title, errors } = await serverThenHydrate(
      tree({ analytics: false, draftMode: null }),
    );
    expect(errors).toEqual([]);
    expect(tagsIn(title?.textContent)).toEqual([]);
    expect(title?.textContent).toBe("Hello");
  });

  it("leaves content untagged when draft mode is known to be off and analytics is off", async () => {
    const { title } = await serverThenHydrate(
      tree({ analytics: false, draftMode: false }),
    );
    expect(tagsIn(title?.textContent)).toEqual([]);
  });

  it("still tags in draft mode when analytics is off", async () => {
    const { title } = await serverThenHydrate(
      tree({ analytics: false, draftMode: true }),
    );
    expect(tagsIn(title?.textContent)).toEqual([TITLE]);
  });
});
