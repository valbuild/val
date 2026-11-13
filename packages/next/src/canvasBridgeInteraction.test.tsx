/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
  pageLogOf,
  type PageAction,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * The Studio using the page (`interact`, the assistant's `interact_page`):
 * each action done as the page would see it, and every answer the page as
 * it is AFTER the action took effect.
 *
 * jsdom lays nothing out, so every element is given a box: the bridge
 * refuses an element without one, as it should on a real page.
 */
describe("the canvas bridge, used from the Studio", () => {
  let posted: ValCanvasPageMessage[];
  const clientRects = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getClientRects",
  );

  beforeEach(() => {
    posted = [];
    window.history.replaceState(null, "", "/form?val_canvas=1");
    Reflect.set(
      globalThis,
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(Element.prototype, "getClientRects", {
      configurable: true,
      value: () => [{ x: 0, y: 0, width: 10, height: 10 }],
    });
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation((message: unknown) => {
        posted.push(message as ValCanvasPageMessage);
      });
  });

  afterEach(() => {
    pageLogOf(window)?.uninstall();
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    if (clientRects !== undefined) {
      Object.defineProperty(Element.prototype, "getClientRects", clientRects);
    }
  });

  const tell = (
    message: ValCanvasStudioMessage,
    from: { source: Window | null; origin: string } = {
      source: window.parent,
      origin: window.location.origin,
    },
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: message,
          source: from.source,
          origin: from.origin,
        }),
      );
    });

  let requests = 0;
  /** Ask the page to do `action`, and wait for what it answers. */
  async function interact(
    action: PageAction,
    extra: { allowSubmit?: boolean; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const requestId = `i${++requests}`;
    tell({
      val: VAL_CANVAS_MESSAGE,
      type: "interact",
      requestId,
      action,
      ...extra,
    });
    let outcome: unknown;
    await waitFor(
      () => {
        const answer = posted.find(
          (message) =>
            message.type === "interacted" && message.requestId === requestId,
        );
        if (answer === undefined || answer.type !== "interacted") {
          throw new Error("no answer yet");
        }
        outcome = answer.outcome;
      },
      { timeout: 5000 },
    );
    return outcome;
  }

  it("clicks, and answers with the page after the click", async () => {
    function Counter() {
      const [count, setCount] = React.useState(0);
      return (
        <main>
          <h1>Clicked {count} times</h1>
          <button id="more" onClick={() => setCount((value) => value + 1)}>
            More
          </button>
        </main>
      );
    }
    render(
      <>
        <Counter />
        <ValCanvasBridge draftMode />
      </>,
    );
    const outcome = await interact({ kind: "click", selector: "#more" });
    expect(outcome).toMatchObject({
      status: "done",
      interaction: {
        did: 'clicked <button#more> "More"',
        settled: true,
        before: { url: "/form" },
        after: { url: "/form" },
        snapshot: {
          outline: expect.arrayContaining([
            expect.objectContaining({ text: "Clicked 1 times" }),
          ]),
        },
      },
    });
  });

  it("types into a React-controlled input so React sees it", async () => {
    function Search() {
      const [query, setQuery] = React.useState("");
      return (
        <main>
          <input
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p>Searching for: {query}</p>
        </main>
      );
    }
    render(
      <>
        <Search />
        <ValCanvasBridge draftMode />
      </>,
    );
    const outcome = await interact({
      kind: "type",
      selector: 'input[name="q"]',
      text: "shoes",
    });
    expect(outcome).toMatchObject({
      status: "done",
      interaction: {
        did: 'typed 5 characters into <input name="q">',
        snapshot: {
          outline: expect.arrayContaining([
            expect.objectContaining({ text: "Searching for: shoes" }),
          ]),
        },
      },
    });
    // And appends when asked.
    await interact({
      kind: "type",
      selector: 'input[name="q"]',
      text: " red",
      append: true,
    });
    expect(document.querySelector("p")?.textContent).toBe(
      "Searching for: shoes red",
    );
  });

  it("never types into a password field", async () => {
    render(
      <main>
        <input type="password" name="secret" />
        <ValCanvasBridge draftMode />
      </main>,
    );
    const outcome = await interact({
      kind: "type",
      selector: 'input[name="secret"]',
      text: "hunter2",
    });
    expect(outcome).toMatchObject({
      status: "refused",
      error: expect.stringContaining("password"),
    });
    expect(
      document.querySelector<HTMLInputElement>('input[name="secret"]')?.value,
    ).toBe("");
  });

  it("presses Escape for the page's own listeners, and Tab moves the focus", async () => {
    function Dialog() {
      const [open, setOpen] = React.useState(true);
      return (
        <main>
          {open ? (
            <div
              id="dialog"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
              }}
            >
              A dialog
            </div>
          ) : (
            <p>Closed</p>
          )}
          <input id="first" />
          <input id="second" />
        </main>
      );
    }
    render(
      <>
        <Dialog />
        <ValCanvasBridge draftMode />
      </>,
    );
    const escaped = await interact({
      kind: "press",
      key: "Escape",
      selector: "#dialog",
    });
    expect(escaped).toMatchObject({
      status: "done",
      interaction: {
        snapshot: {
          outline: expect.arrayContaining([
            expect.objectContaining({ text: "Closed" }),
          ]),
        },
      },
    });
    document.getElementById("first")?.focus();
    await interact({ kind: "press", key: "Tab" });
    expect(document.activeElement?.id).toBe("second");
    await interact({ kind: "press", key: "Shift+Tab" });
    expect(document.activeElement?.id).toBe("first");
  });

  it("waits for the person before it submits a form, by click or by Enter", async () => {
    const submitted = jest.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    render(
      <main>
        <form action="/subscribe" method="post" onSubmit={submitted}>
          <input name="email" />
          <button id="send">Subscribe</button>
        </form>
        <ValCanvasBridge draftMode />
      </main>,
    );
    const asked = await interact({ kind: "click", selector: "#send" });
    expect(asked).toEqual({
      status: "needs-approval",
      approval: {
        via: "click",
        page: "/form",
        label: "Subscribe",
        method: "POST",
        action: "/subscribe",
      },
    });
    const pressed = await interact({
      kind: "press",
      key: "Enter",
      selector: 'input[name="email"]',
    });
    expect(pressed).toMatchObject({
      status: "needs-approval",
      approval: { via: "press", label: "Subscribe" },
    });
    expect(submitted).not.toHaveBeenCalled();

    // Allowed, it submits.
    const allowed = await interact(
      { kind: "click", selector: "#send" },
      { allowSubmit: true },
    );
    expect(allowed).toMatchObject({ status: "done" });
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("clicks a button outside a form without asking", async () => {
    const clicked = jest.fn();
    render(
      <main>
        <button id="menu" onClick={clicked}>
          Menu
        </button>
        <ValCanvasBridge draftMode />
      </main>,
    );
    expect(await interact({ kind: "click", selector: "#menu" })).toMatchObject({
      status: "done",
    });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("never takes the frame off the site", async () => {
    render(
      <main>
        <a id="away" href="https://elsewhere.example/">
          Elsewhere
        </a>
        <a id="window" href="/about" target="_blank">
          About
        </a>
        <ValCanvasBridge draftMode />
      </main>,
    );
    expect(await interact({ kind: "click", selector: "#away" })).toMatchObject({
      status: "refused",
      error: expect.stringContaining("another site"),
    });
    expect(
      await interact({ kind: "click", selector: "#window" }),
    ).toMatchObject({
      status: "refused",
      error: expect.stringContaining("another window"),
    });
  });

  it("answers with what the page logged since the action, and nothing before it", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    render(
      <main>
        <button
          id="broken"
          onClick={() => console.error("Checkout failed to load")}
        >
          Checkout
        </button>
        <ValCanvasBridge draftMode />
      </main>,
    );
    console.error("Logged before anything was clicked");
    const outcome = await interact({ kind: "click", selector: "#broken" });
    expect(outcome).toMatchObject({
      status: "done",
      interaction: {
        log: [
          expect.objectContaining({
            source: "console",
            text: "Checkout failed to load",
          }),
        ],
      },
    });
  });

  it("says plainly when the page did not settle in time", async () => {
    function Ticker() {
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        const timer = setInterval(() => setTick((value) => value + 1), 40);
        return () => clearInterval(timer);
      }, []);
      return <p>Tick {tick}</p>;
    }
    render(
      <>
        <Ticker />
        <ValCanvasBridge draftMode />
      </>,
    );
    const outcome = await interact({ kind: "settle" }, { timeoutMs: 600 });
    expect(outcome).toMatchObject({
      status: "done",
      interaction: { settled: false, busy: ["changing"] },
    });
  });

  it("says it is leaving when the action starts a navigation", async () => {
    render(
      <main>
        <button
          id="go"
          onClick={() => window.dispatchEvent(new Event("beforeunload"))}
        >
          Go
        </button>
        <ValCanvasBridge draftMode />
      </main>,
    );
    expect(await interact({ kind: "click", selector: "#go" })).toEqual({
      status: "leaving",
      did: 'clicked <button#go> "Go"',
      before: { url: "/form", title: "" },
    });
  });

  it("does nothing for anyone but its parent", async () => {
    const clicked = jest.fn();
    render(
      <main>
        <button id="menu" onClick={clicked}>
          Menu
        </button>
        <ValCanvasBridge draftMode />
      </main>,
    );
    tell(
      {
        val: VAL_CANVAS_MESSAGE,
        type: "interact",
        requestId: "elsewhere",
        action: { kind: "click", selector: "#menu" },
      },
      { source: null, origin: "https://elsewhere.example" },
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(clicked).not.toHaveBeenCalled();
    expect(posted.some((message) => message.type === "interacted")).toBe(false);
  });
});
