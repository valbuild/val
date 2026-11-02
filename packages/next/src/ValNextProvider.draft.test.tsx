/**
 * @jest-environment jsdom
 */
import "./client/__suspense-test-setup__"; // must come first — polyfills TextEncoder
import React from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Internal, initVal, type ModuleFilePath } from "@valbuild/core";
import { raw, stegaClean, type ValDraft } from "@valbuild/react/stega";
import { initValClient } from "./client/initValClient";
import { ValNextProvider } from "./ValNextProvider";

// Injecting the Studio's script is not what this is about.
jest.mock("next/script", () => ({ __esModule: true, default: () => null }));
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
  usePathname: () => "/notes/uncommitted",
}));

/**
 * `<ValProvider draft>` on Next: the draft the server read for this request,
 * as `@valbuild/tanstack`'s provider takes it. The scenario world drives a
 * TanStack page (`scenarios/`, S24), so Next's is pinned here: the server
 * render and hydration -- the renders that decide, the ones a page turns
 * into `notFound()` -- find a route that exists only in an unpublished
 * patch (wait 3 of "`suspend` is three waits", `architecture/quirks.md`),
 * and a page without the prop is rendered exactly as before.
 */

const { s, c, config } = initVal();
const path = "/app/notes/[note]/page.val.ts" as ModuleFilePath;
const routesVal = c.define(
  path,
  s.router(Internal.nextAppRouter, s.object({ title: s.string() })),
  { "/notes/committed": { title: "committed page" } },
);

/** What the server's draft holds: the module, with a route only a patch added. */
const draft: ValDraft = {
  sources: {
    [path]: {
      "/notes/committed": { title: "committed page" },
      "/notes/uncommitted": { title: "uncommitted page" },
    },
  },
};

const { useValRouteStega } = initValClient(config);

/** What a page does with a route: `null` is `notFound()`. */
function Page() {
  const entry = useValRouteStega(routesVal, { note: "uncommitted" });
  return (
    <span data-testid="val">{entry === null ? "notFound" : entry.title}</span>
  );
}

function tree(props: { draft?: ValDraft | null; suspend?: boolean }) {
  return (
    <ValNextProvider config={config} {...props}>
      <React.Suspense fallback={<span data-testid="val">loading</span>}>
        <Page />
      </React.Suspense>
    </ValNextProvider>
  );
}

const shown = (container: HTMLElement) =>
  container.querySelector("[data-testid=val]")?.textContent ?? null;

describe("ValProvider's draft prop on Next", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  beforeEach(() => {
    mockRefresh.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    document.cookie = `${Internal.VAL_ENABLE_COOKIE_NAME}=; max-age=0`;
  });

  test.each([false, true])(
    "the server render finds a route only in the draft (suspend: %s)",
    (suspend) => {
      const html = renderToString(tree({ draft, suspend }));
      expect(html).toContain("uncommitted page");
      expect(html).not.toContain("notFound");
    },
  );

  test("the server render carries no edit tags, so hydration agrees with it", () => {
    const html = renderToString(tree({ draft }));
    const text = /data-testid="val">([^<]*)</.exec(html)?.[1];
    expect(text).toBe("uncommitted page");
    expect(stegaClean(text ?? "")).toBe(text);
  });

  test("hydration renders the same route, with no mismatch", async () => {
    container.innerHTML = renderToString(tree({ draft, suspend: true }));
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => {
        root = hydrateRoot(container, tree({ draft, suspend: true }));
      });
      expect(shown(container)).not.toBe("notFound");
      expect(raw(shown(container) ?? "")).toBe("uncommitted page");
      const mismatches = errors.mock.calls.filter((call) =>
        String(call[0]).includes("hydrat"),
      );
      expect(mismatches).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  test("without it, nothing changes: the server render is the published content", () => {
    // Additive: a page that passes no `draft` renders as it always did.
    expect(renderToString(tree({}))).toContain("notFound");
    expect(renderToString(tree({ draft: null }))).toContain("notFound");
  });

  test("a draft that is only a snapshot (draft mode off) is no draft", () => {
    expect(
      renderToString(tree({ draft: { ...draft, draftMode: false } })),
    ).toContain("notFound");
  });

  /**
   * The refresh: server components re-render when the Studio says the server
   * has the edit (`confirmed`), never when the edit merely arrives, and
   * never on a timer.
   */
  test("router.refresh() follows what the server confirmed, not what arrived", async () => {
    jest.useFakeTimers();
    try {
      document.cookie = `${Internal.VAL_ENABLE_COOKIE_NAME}=true`;
      await act(async () => {
        root = createRoot(container);
        root.render(tree({ draft }));
      });
      const send = (detail: unknown) =>
        act(() => {
          window.dispatchEvent(new CustomEvent("val-event", { detail }));
        });
      const edited = {
        "/notes/committed": { title: "committed page" },
        "/notes/uncommitted": { title: "edited" },
      };
      // The Studio connects: it holds what the page was rendered with.
      send({
        type: "source-update",
        moduleFilePath: path,
        source: draft.sources[path],
      });
      send({ type: "sources-synced" });
      send({ type: "confirmed", seq: 3 });
      expect(mockRefresh).not.toHaveBeenCalled();
      // An edit arrives: the hooks show it, the server does not have it yet.
      send({ type: "source-update", moduleFilePath: path, source: edited });
      expect(raw(shown(container) ?? "")).toBe("edited");
      expect(mockRefresh).not.toHaveBeenCalled();
      // The server confirms it: one refresh, and only one.
      send({ type: "confirmed", seq: 4 });
      send({ type: "confirmed", seq: 4 });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      // A minute later, nothing more.
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
