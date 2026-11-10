/**
 * @jest-environment jsdom
 */
import "./client/__suspense-test-setup__"; // must come first — polyfills TextEncoder
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Internal, initVal } from "@valbuild/core";
import { ValTanStackProvider } from "./ValTanStackProvider";

// Loading the Studio's bundle is not what this is about.
jest.mock("./ValScript", () => ({ ValScript: () => null }));
const mockInvalidate = jest.fn(async () => {});
jest.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mockInvalidate }),
  useRouterState: () => "/",
}));

const { config } = initVal();

/**
 * Draft mode switching re-runs the loaders, once: what they read moved with
 * it. The refresh used to be sent from inside a `setDraftMode` updater, which
 * React may call twice (StrictMode: two refreshes) or during a render (where
 * `startTransition` warns). `ValNextProvider.draft.test.tsx` pins Next's.
 */
describe("draft mode switching", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  const fetchBefore = globalThis.fetch;
  beforeEach(() => {
    mockInvalidate.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    document.cookie = `${Internal.VAL_ENABLE_COOKIE_NAME}=; max-age=0`;
    Reflect.set(globalThis, "fetch", fetchBefore);
  });

  test("turned on, it refreshes once, under StrictMode too", async () => {
    const asked: string[] = [];
    Reflect.set(globalThis, "fetch", async (input: string) => {
      asked.push(input);
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ draftMode: true }),
      };
    });
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      document.cookie = `${Internal.VAL_ENABLE_COOKIE_NAME}=true`;
      await act(async () => {
        root = createRoot(container);
        root.render(
          <React.StrictMode>
            <ValTanStackProvider config={config}>
              <span />
            </ValTanStackProvider>
          </React.StrictMode>,
        );
      });
      // Until `/draft/stat` has answered, draft mode is unknown.
      for (let i = 0; i < 10 && asked.length === 0; i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      expect(asked).toContain("/api/val/draft/stat");
      expect(mockInvalidate).toHaveBeenCalledTimes(1);
      expect(
        errors.mock.calls.filter((call) =>
          String(call[0]).includes("startTransition"),
        ),
      ).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

/**
 * What re-runs the loaders: a Studio's `confirmed`, never the edit it relays
 * (the server may not have it yet). A bare `source`, the shape a Studio from
 * before the one content model relayed with no `confirmed` after it, is no
 * longer read: the page's fallback for it went in the release after.
 */
describe("which Studio's messages refresh the page", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  const fetchBefore = globalThis.fetch;
  const MODULE = "/content/home.val.ts";
  beforeEach(() => {
    mockInvalidate.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    Reflect.set(globalThis, "fetch", async () => ({
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ draftMode: true }),
    }));
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    document.cookie = `${Internal.VAL_ENABLE_COOKIE_NAME}=; max-age=0`;
    Reflect.set(globalThis, "fetch", fetchBefore);
  });

  const mounted = async () => {
    document.cookie = `${Internal.VAL_ENABLE_COOKIE_NAME}=true`;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ValTanStackProvider config={config}>
          <span />
        </ValTanStackProvider>,
      );
    });
    // Draft mode turning on is a refresh of its own.
    for (let i = 0; i < 10 && mockInvalidate.mock.calls.length === 0; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    mockInvalidate.mockClear();
  };
  const send = (detail: unknown) =>
    act(async () => {
      window.dispatchEvent(new CustomEvent("val-event", { detail }));
    });

  /**
   * The release after the one content model stopped reading a bare
   * `source` (a Studio from before it): that Studio never says `confirmed`,
   * and the page's fallback for it re-ran the loaders on every change it
   * relayed. Two releases on, nothing sends it.
   */
  test("an edit as a bare source, from a Studio two releases old, is not read", async () => {
    await mounted();
    await send({
      type: "source-update",
      moduleFilePath: MODULE,
      source: { title: "edited by an old Studio" },
    });
    expect(mockInvalidate).toHaveBeenCalledTimes(0);
  });

  test("this release's Studio is refreshed by its confirmed, not by the edit", async () => {
    await mounted();
    await send({ type: "sources-synced" });
    await send({ type: "confirmed", seq: 3 });
    await send({
      type: "source-update",
      moduleFilePath: MODULE,
      read: {
        status: "ready",
        source: { title: "edited" },
        version: null,
      },
    });
    expect(mockInvalidate).toHaveBeenCalledTimes(0);
    await send({ type: "confirmed", seq: 4 });
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});
