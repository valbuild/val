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
    Reflect.deleteProperty(window, "fetch");
    Reflect.deleteProperty(window.navigator, "sendBeacon");
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
    extra: { timeoutMs?: number } = {},
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

  /**
   * The request gate (`pageRequestGate.ts`): what the page SENDS is held for
   * the person, whatever was clicked to make it. Each case below submitted
   * with no card when the gate guessed from the clicked element instead.
   */
  describe("holding what the page sends", () => {
    /** The page's own `fetch`, answering every request. */
    let sent: Array<{ url: string; method: string }>;
    /** What `form.submit()` was really called on. */
    let submitted: HTMLFormElement[];
    const submit = HTMLFormElement.prototype.submit;

    beforeEach(() => {
      sent = [];
      submitted = [];
      Reflect.set(
        window,
        "fetch",
        jest.fn((input: unknown, init?: { method?: string }) => {
          sent.push({ url: String(input), method: init?.method ?? "GET" });
          return Promise.resolve({ status: 200, statusText: "" });
        }),
      );
      // jsdom navigates nowhere: what submitting a form natively comes to.
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        submitted.push(this);
      };
    });
    afterEach(() => {
      HTMLFormElement.prototype.submit = submit;
    });

    /** The approval an outcome asks for. */
    function approvalOf(outcome: unknown): {
      hold: string;
      requests: unknown[];
    } {
      expect(outcome).toMatchObject({ status: "needs-approval" });
      const approval: unknown = Reflect.get(Object(outcome), "approval");
      const hold: unknown = Reflect.get(Object(approval), "hold");
      const requests: unknown = Reflect.get(Object(approval), "requests");
      if (typeof hold !== "string" || !Array.isArray(requests)) {
        throw new Error("no hold");
      }
      return { hold, requests };
    }

    const POST_TO_SUBSCRIBE = {
      via: "form",
      method: "POST",
      url: "http://localhost/subscribe",
    };

    it("holds a form POST, and sends exactly it once the person allows", async () => {
      render(
        <main>
          <form action="/subscribe" method="post">
            <input name="email" />
            <button id="send" name="list" value="weekly">
              Subscribe
            </button>
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      const { hold, requests } = approvalOf(
        await interact({ kind: "click", selector: "#send" }),
      );
      expect(requests).toEqual([POST_TO_SUBSCRIBE]);
      expect(submitted).toEqual([]);
      // Restored once the action ended: the page is as it was.
      expect(HTMLFormElement.prototype.submit).not.toBe(submit);
      expect(
        await interact({ kind: "release", hold, allow: true }),
      ).toMatchObject({
        status: "done",
        interaction: { did: "sent the 1 request the person allowed" },
      });
      expect(submitted).toHaveLength(1);
      // Released once: a second answer finds nothing waiting.
      expect(
        await interact({ kind: "release", hold, allow: true }),
      ).toMatchObject({ status: "refused" });
      expect(submitted).toHaveLength(1);
    });

    it("holds Enter in a form's field", async () => {
      render(
        <main>
          <form action="/subscribe" method="post">
            <input name="email" />
            <button>Subscribe</button>
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      const { requests } = approvalOf(
        await interact({
          kind: "press",
          key: "Enter",
          selector: 'input[name="email"]',
        }),
      );
      expect(requests).toEqual([POST_TO_SUBSCRIBE]);
      expect(submitted).toEqual([]);
    });

    it('holds a submit by <button type="foo">, which the browser reads as submit', async () => {
      render(
        <main>
          <form action="/subscribe" method="post">
            <button id="odd">Odd</button>
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      // Not a type React lets be written: set as a page's markup would.
      document.getElementById("odd")?.setAttribute("type", "foo");
      expect(
        approvalOf(await interact({ kind: "click", selector: "#odd" }))
          .requests,
      ).toEqual([POST_TO_SUBSCRIBE]);
      expect(submitted).toEqual([]);
    });

    it("holds a submit by a label that clicks the button", async () => {
      render(
        <main>
          <form action="/subscribe" method="post">
            <button id="submitBtn">Subscribe</button>
          </form>
          <label id="for" htmlFor="submitBtn">
            Go
          </label>
          <form action="/subscribe" method="post">
            <label id="around">
              <button>Wrapped</button>
            </label>
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      for (const selector of ["#for", "#around"]) {
        expect(
          approvalOf(await interact({ kind: "click", selector })).requests,
        ).toEqual([POST_TO_SUBSCRIBE]);
      }
      expect(submitted).toEqual([]);
    });

    it("holds a submit a script makes: requestSubmit from a div, form.submit() from a link", async () => {
      render(
        <main>
          <form id="f" action="/subscribe" method="post" />
          <div
            id="div"
            onClick={() =>
              document.querySelector<HTMLFormElement>("#f")?.requestSubmit()
            }
          >
            Send
          </div>
          <a
            id="link"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              document.querySelector<HTMLFormElement>("#f")?.submit();
            }}
          >
            Send
          </a>
          <ValCanvasBridge draftMode />
        </main>,
      );
      for (const selector of ["#div", "#link"]) {
        expect(
          approvalOf(await interact({ kind: "click", selector })).requests,
        ).toEqual([POST_TO_SUBSCRIBE]);
      }
      expect(submitted).toEqual([]);
    });

    it("holds onchange=this.form.submit(), fired by typing", async () => {
      render(
        <main>
          <form id="f" action="/subscribe" method="post">
            <input
              name="email"
              onChange={(event) => event.currentTarget.form?.submit()}
            />
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      expect(
        approvalOf(
          await interact({
            kind: "type",
            selector: 'input[name="email"]',
            text: "a@b.example",
          }),
        ).requests,
      ).toEqual([POST_TO_SUBSCRIBE]);
      expect(submitted).toEqual([]);
    });

    it("holds a fetch POST from onClick, and the page gets an abort when the person says no", async () => {
      function Save() {
        const [state, setState] = React.useState("idle");
        return (
          <main>
            <button
              id="save"
              onClick={() => {
                fetch("/api/save", { method: "POST", body: "{}" }).then(
                  () => setState("saved"),
                  (error: unknown) =>
                    setState(Reflect.get(Object(error), "name")),
                );
              }}
            >
              Save
            </button>
            <p>State: {state}</p>
          </main>
        );
      }
      render(
        <>
          <Save />
          <ValCanvasBridge draftMode />
        </>,
      );
      const first = approvalOf(
        await interact({ kind: "click", selector: "#save" }),
      );
      expect(first.requests).toEqual([
        { via: "fetch", method: "POST", url: "http://localhost/api/save" },
      ]);
      expect(sent).toEqual([]);
      expect(
        await interact({ kind: "release", hold: first.hold, allow: false }),
      ).toMatchObject({
        status: "done",
        interaction: {
          snapshot: {
            outline: expect.arrayContaining([
              expect.objectContaining({ text: "State: AbortError" }),
            ]),
          },
        },
      });
      expect(sent).toEqual([]);

      const second = approvalOf(
        await interact({ kind: "click", selector: "#save" }),
      );
      expect(
        await interact({ kind: "release", hold: second.hold, allow: true }),
      ).toMatchObject({
        status: "done",
        interaction: {
          snapshot: {
            outline: expect.arrayContaining([
              expect.objectContaining({ text: "State: saved" }),
            ]),
          },
        },
      });
      expect(sent).toEqual([{ url: "/api/save", method: "POST" }]);
    });

    it("holds an XHR POST and a beacon", async () => {
      const beacons: unknown[] = [];
      Reflect.set(window.navigator, "sendBeacon", (url: unknown) => {
        beacons.push(url);
        return true;
      });
      let failed = false;
      render(
        <main>
          <button
            id="send"
            onClick={() => {
              const request = new XMLHttpRequest();
              request.open("PUT", "/api/item/1");
              request.onerror = () => {
                failed = true;
              };
              request.send("{}");
              navigator.sendBeacon("/api/track", "clicked");
            }}
          >
            Send
          </button>
          <ValCanvasBridge draftMode />
        </main>,
      );
      const { hold, requests } = approvalOf(
        await interact({ kind: "click", selector: "#send" }),
      );
      expect(requests).toEqual([
        { via: "xhr", method: "PUT", url: "http://localhost/api/item/1" },
        { via: "beacon", method: "POST", url: "http://localhost/api/track" },
      ]);
      expect(beacons).toEqual([]);
      await interact({ kind: "release", hold, allow: false });
      // Refused: the XHR fails, as one that could not be sent.
      expect(failed).toBe(true);
      expect(beacons).toEqual([]);
    });

    it("refuses data sent to another site, without asking", async () => {
      render(
        <main>
          <button
            id="send"
            onClick={() => {
              void fetch("https://tracker.example/collect", {
                method: "POST",
              }).catch(() => {});
            }}
          >
            Send
          </button>
          <ValCanvasBridge draftMode />
        </main>,
      );
      expect(
        await interact({ kind: "click", selector: "#send" }),
      ).toMatchObject({
        status: "done",
        interaction: {
          blocked: [
            {
              via: "fetch",
              method: "POST",
              url: "https://tracker.example/collect",
            },
          ],
        },
      });
      expect(sent).toEqual([]);
    });

    it("lets reading through: a GET fetch and a GET form need no one", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      render(
        <main>
          <button
            id="load"
            onClick={() => {
              void fetch("/api/products");
            }}
          >
            Load
          </button>
          <form action="/search">
            <input name="q" />
            <button id="search">Search</button>
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      expect(
        await interact({ kind: "click", selector: "#load" }),
      ).toMatchObject({ status: "done" });
      expect(sent).toEqual([{ url: "/api/products", method: "GET" }]);
      expect(
        await interact({ kind: "click", selector: "#search" }),
      ).toMatchObject({ status: "done" });
    });

    it("refuses what an earlier action held when the assistant moves on", async () => {
      let outcome = "waiting";
      render(
        <main>
          <button
            id="save"
            onClick={() => {
              fetch("/api/save", { method: "POST" }).then(
                () => {
                  outcome = "sent";
                },
                () => {
                  outcome = "refused";
                },
              );
            }}
          >
            Save
          </button>
          <p id="other">Other</p>
          <ValCanvasBridge draftMode />
        </main>,
      );
      approvalOf(await interact({ kind: "click", selector: "#save" }));
      await interact({ kind: "click", selector: "#other" });
      expect(outcome).toBe("refused");
      expect(sent).toEqual([]);
    });

    it("puts the page's own functions back when the action ends", async () => {
      const pageFetch = window.fetch;
      const open = XMLHttpRequest.prototype.open;
      render(
        <main>
          <p id="text">Text</p>
          <ValCanvasBridge draftMode />
        </main>,
      );
      // The page log wraps `fetch` once, when the bridge mounts.
      const logged = window.fetch;
      expect(logged).not.toBe(pageFetch);
      await interact({ kind: "click", selector: "#text" });
      expect(window.fetch).toBe(logged);
      expect(XMLHttpRequest.prototype.open).toBe(open);
      expect(HTMLFormElement.prototype.submit).not.toBe(submit);
    });
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

  it("reads where a link goes as the browser does: base href, base target, SVG links", async () => {
    const base = document.createElement("base");
    base.href = "https://elsewhere.example/";
    document.head.append(base);
    try {
      render(
        <main>
          <a id="relative" href="about">
            About
          </a>
          <svg>
            <a id="svg" href="https://elsewhere.example/x">
              <text>Away</text>
            </a>
          </svg>
          <ValCanvasBridge draftMode />
        </main>,
      );
      // Relative to the base: another site.
      expect(
        await interact({ kind: "click", selector: "#relative" }),
      ).toMatchObject({
        status: "refused",
        error: expect.stringContaining("https://elsewhere.example"),
      });
      expect(await interact({ kind: "click", selector: "#svg" })).toMatchObject(
        { status: "refused", error: expect.stringContaining("another site") },
      );
      base.removeAttribute("href");
      base.target = "_blank";
      expect(
        await interact({ kind: "click", selector: "#relative" }),
      ).toMatchObject({
        status: "refused",
        error: expect.stringContaining("another window"),
      });
    } finally {
      base.remove();
    }
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
