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
    extra: { timeoutMs?: number; approved?: string } = {},
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

  /**
   * A click or Enter/Space, as the Studio runs it: asked first -- nothing
   * dispatched -- and then sent again with what the person allowed.
   */
  async function approvedly(action: PageAction): Promise<unknown> {
    const asked = await interact(action);
    expect(asked).toMatchObject({
      status: "needs-approval",
      approval: { kind: "action" },
    });
    const fingerprint: unknown = Reflect.get(
      Object(Reflect.get(Object(asked), "approval")),
      "fingerprint",
    );
    if (typeof fingerprint !== "string") throw new Error("no fingerprint");
    return interact(action, { approved: fingerprint });
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
    const outcome = await approvedly({ kind: "click", selector: "#more" });
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

  /** The page's own `fetch`, answering every request, and what it sent. */
  let sent: Array<{ url: string; method: string }>;
  /** What `form.submit()` was really called on, with its fields then. */
  let submitted: Array<{ action: string; fields: string }>;
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
      submitted.push({
        action: this.action,
        fields: new URLSearchParams(
          Array.from(new FormData(this).entries()).map(
            ([name, value]): [string, string] => [name, String(value)],
          ),
        ).toString(),
      });
    };
  });
  afterEach(() => {
    HTMLFormElement.prototype.submit = submit;
  });

  /**
   * Every click, and every Enter or Space, asks the person BEFORE anything
   * reaches the page: so nothing a click could set off -- a submit by any
   * route, a fetch from a handler -- happens until they allow it.
   */
  describe("asking before a click or Enter/Space", () => {
    it("asks first, dispatching nothing, and names the element", async () => {
      const clicked = jest.fn();
      render(
        <main>
          <button id="buy" onPointerDown={clicked} onClick={clicked}>
            Buy &ldquo;now&rdquo;
          </button>
          <ValCanvasBridge draftMode />
        </main>,
      );
      expect(await interact({ kind: "click", selector: "#buy" })).toEqual({
        status: "needs-approval",
        approval: {
          kind: "action",
          fingerprint: expect.any(String),
          action: "click",
          page: "/form",
          label: "Buy “now”",
          role: "button",
          tag: "button",
          before: { url: "/form", title: "" },
        },
      });
      expect(clicked).not.toHaveBeenCalled();
    });

    it("dispatches nothing before the person allows, whatever the click would set off", async () => {
      const fetched = jest.fn();
      render(
        <main>
          <form id="f" action="/subscribe" method="post">
            <button id="odd">Odd</button>
            <button id="submitBtn">Subscribe</button>
          </form>
          <label id="for" htmlFor="submitBtn">
            Go
          </label>
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
            onClick={() =>
              document.querySelector<HTMLFormElement>("#f")?.submit()
            }
          >
            Send
          </a>
          <button id="save" onClick={fetched}>
            Save
          </button>
          <ValCanvasBridge draftMode />
        </main>,
      );
      document.getElementById("odd")?.setAttribute("type", "foo");
      for (const selector of ["#odd", "#for", "#div", "#link", "#save"]) {
        expect(await interact({ kind: "click", selector })).toMatchObject({
          status: "needs-approval",
          approval: { kind: "action" },
        });
      }
      expect(submitted).toEqual([]);
      expect(fetched).not.toHaveBeenCalled();
    });

    it("asks before Enter and Space, and not before other keys", async () => {
      render(
        <main>
          <form action="/subscribe" method="post">
            <input name="email" />
            <button>Subscribe</button>
          </form>
          <ValCanvasBridge draftMode />
        </main>,
      );
      for (const key of ["Enter", "Space"] as const) {
        expect(
          await interact({
            kind: "press",
            key,
            selector: 'input[name="email"]',
          }),
        ).toMatchObject({
          status: "needs-approval",
          approval: { kind: "action", action: "press", key },
        });
      }
      for (const key of ["Escape", "Tab", "ArrowDown"] as const) {
        expect(await interact({ kind: "press", key })).toMatchObject({
          status: "done",
        });
      }
      expect(submitted).toEqual([]);
    });

    it("asks again when the element is not the one the person was shown", async () => {
      function Changing() {
        const [label, setLabel] = React.useState("Save draft");
        return (
          <main>
            <button id="b" onClick={() => setLabel("Clicked")}>
              {label}
            </button>
            <button id="other" onClick={() => setLabel("Delete all")}>
              Other
            </button>
          </main>
        );
      }
      render(
        <>
          <Changing />
          <ValCanvasBridge draftMode />
        </>,
      );
      const asked = await interact({ kind: "click", selector: "#b" });
      const fingerprint = String(
        Reflect.get(
          Object(Reflect.get(Object(asked), "approval")),
          "fingerprint",
        ),
      );
      // While the card waited, the button became something else.
      act(() => document.getElementById("other")?.click());
      expect(
        await interact(
          { kind: "click", selector: "#b" },
          { approved: fingerprint },
        ),
      ).toMatchObject({
        status: "needs-approval",
        approval: { label: "Delete all" },
      });
      expect(document.getElementById("b")?.textContent).toBe("Delete all");
      // A fingerprint for another element, or made up, is not an Allow.
      expect(
        await interact({ kind: "click", selector: "#b" }, { approved: "[]" }),
      ).toMatchObject({ status: "needs-approval" });
      expect(document.getElementById("b")?.textContent).toBe("Delete all");
    });

    it("runs an approved click as the person's own: nothing same-site is held or cancelled", async () => {
      let defaultPrevented: boolean | null = null;
      render(
        <main>
          <form
            action="/subscribe"
            method="post"
            onSubmit={(event) => {
              defaultPrevented = event.defaultPrevented;
            }}
          >
            <input name="email" defaultValue="a@b.example" />
            <button id="send">Subscribe</button>
          </form>
          <button
            id="save"
            onClick={() => {
              void fetch("/api/save", { method: "POST" });
            }}
          >
            Save
          </button>
          <ValCanvasBridge draftMode />
        </main>,
      );
      jest.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await approvedly({ kind: "click", selector: "#save" }),
      ).toMatchObject({ status: "done" });
      expect(sent).toEqual([{ url: "/api/save", method: "POST" }]);
      // jsdom does not navigate: the submit event is what can be seen.
      expect(
        await approvedly({ kind: "click", selector: "#send" }),
      ).toMatchObject({ status: "done" });
      expect(defaultPrevented).toBe(false);
    });

    it("runs a React 19 form action through an approved click", async () => {
      const actions: unknown[] = [];
      function Subscribe() {
        const [state, formAction] = React.useActionState(
          async (_previous: string, fields: FormData) => {
            actions.push(fields.get("email"));
            return `Subscribed ${String(fields.get("email"))}`;
          },
          "Not yet",
        );
        return (
          <main>
            <form action={formAction}>
              <input name="email" defaultValue="ada@example.com" />
              <button id="go">Subscribe</button>
            </form>
            <p>{state}</p>
          </main>
        );
      }
      render(
        <>
          <Subscribe />
          <ValCanvasBridge draftMode />
        </>,
      );
      expect(
        await approvedly({ kind: "click", selector: "#go" }),
      ).toMatchObject({
        status: "done",
        interaction: {
          snapshot: {
            outline: expect.arrayContaining([
              expect.objectContaining({ text: "Subscribed ada@example.com" }),
            ]),
          },
        },
      });
      expect(actions).toEqual(["ada@example.com"]);
    });

    it("still refuses what an approved click sends to another site", async () => {
      let defaultPrevented: boolean | null = null;
      render(
        <main>
          <form
            id="away"
            action="https://elsewhere.example/subscribe"
            method="post"
            onSubmit={(event) => {
              defaultPrevented = event.defaultPrevented;
            }}
          >
            <button id="send">Subscribe</button>
          </form>
          <button
            id="track"
            onClick={() => {
              void fetch("https://tracker.example/collect", {
                method: "POST",
              }).catch(() => {});
            }}
          >
            Track
          </button>
          <ValCanvasBridge draftMode />
        </main>,
      );
      expect(
        await approvedly({ kind: "click", selector: "#track" }),
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
      expect(
        await approvedly({ kind: "click", selector: "#send" }),
      ).toMatchObject({
        status: "done",
        interaction: {
          blocked: [
            {
              via: "form",
              method: "POST",
              url: "https://elsewhere.example/subscribe",
            },
          ],
        },
      });
      expect(defaultPrevented).toBe(true);
    });

    it("never acts on an element the page swapped in after the person allowed", async () => {
      const deleted = jest.fn();
      const send = jest
        .spyOn(XMLHttpRequest.prototype, "send")
        .mockImplementation(() => {});
      function Page() {
        return (
          <main>
            <input
              id="q"
              onChange={() => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", "/api/draft");
                // The page's own reaction to a failed save, at once: a new
                // button where the old one was.
                xhr.onerror = () => {
                  const danger = document.createElement("button");
                  danger.id = "go";
                  danger.textContent = "Delete account";
                  danger.addEventListener("click", deleted);
                  document.getElementById("go")?.replaceWith(danger);
                };
                xhr.send("{}");
              }}
            />
            <button id="go">Save draft</button>
          </main>
        );
      }
      try {
        render(
          <>
            <Page />
            <ValCanvasBridge draftMode />
          </>,
        );
        // The person is asked about "Save draft"...
        const asked = await interact({ kind: "click", selector: "#go" });
        expect(asked).toMatchObject({ approval: { label: "Save draft" } });
        const fingerprint = String(
          Reflect.get(
            Object(Reflect.get(Object(asked), "approval")),
            "fingerprint",
          ),
        );
        // ...meanwhile typing makes the page hold an XHR...
        expect(
          await interact({ kind: "type", selector: "#q", text: "x" }),
        ).toMatchObject({ approval: { kind: "requests" } });
        // ...and the Allow arrives: refusing that XHR swaps the button.
        expect(
          await interact(
            { kind: "click", selector: "#go" },
            { approved: fingerprint },
          ),
        ).toMatchObject({
          status: "needs-approval",
          approval: { label: "Delete account" },
        });
        expect(deleted).not.toHaveBeenCalled();
      } finally {
        send.mockRestore();
      }
    });

    it("names the element as its accessible name does", async () => {
      render(
        <main>
          <span id="caption">Newsletter address</span>
          <input id="by" aria-labelledby="caption" />
          <label htmlFor="for">Your name</label>
          <input id="for" />
          <label>
            Phone <input id="around" />
          </label>
          <input id="hint" placeholder="Search the shop" />
          <ValCanvasBridge draftMode />
        </main>,
      );
      for (const [selector, label] of [
        ["#by", "Newsletter address"],
        ["#for", "Your name"],
        ["#around", "Phone"],
        ["#hint", "Search the shop"],
      ]) {
        expect(await interact({ kind: "click", selector })).toMatchObject({
          approval: { label: expect.stringContaining(label) },
        });
      }
    });

    it("says when Enter would submit the form, and names its button", async () => {
      render(
        <main>
          <form action="/subscribe" method="post">
            <input name="email" />
            <button>Subscribe</button>
          </form>
          <form action="/search">
            <input name="q" />
          </form>
          <input name="loose" />
          <ValCanvasBridge draftMode />
        </main>,
      );
      expect(
        await interact({
          kind: "press",
          key: "Enter",
          selector: 'input[name="email"]',
        }),
      ).toMatchObject({ approval: { submits: "Subscribe" } });
      // One field and no button: it still submits, with nothing to name.
      expect(
        await interact({
          kind: "press",
          key: "Enter",
          selector: 'input[name="q"]',
        }),
      ).toMatchObject({ approval: { submits: "" } });
      const loose = await interact({
        kind: "press",
        key: "Enter",
        selector: 'input[name="loose"]',
      });
      expect(
        Reflect.get(Object(Reflect.get(Object(loose), "approval")), "submits"),
      ).toBeUndefined();
    });

    it("refuses an off-site link before asking, and nothing is clicked (no ping)", async () => {
      const clicks: unknown[] = [];
      render(
        <main>
          <a id="away" href="https://elsewhere.example/" ping="/ping">
            Elsewhere
          </a>
          <ValCanvasBridge draftMode />
        </main>,
      );
      document.addEventListener("click", (event) => clicks.push(event), true);
      expect(
        await interact({ kind: "click", selector: "#away" }),
      ).toMatchObject({
        status: "refused",
        error: expect.stringContaining("another site"),
      });
      expect(clicks).toEqual([]);
    });
  });

  /**
   * The actions that do not ask -- typing, other keys, the settle after
   * opening a page -- run with the request hold (`pageRequestGate.ts`):
   * what the page sends meanwhile is held until the person says.
   */
  describe("holding what the page sends while typing", () => {
    /** The approval an outcome asks for. */
    function heldOf(outcome: unknown): { hold: string; requests: unknown[] } {
      expect(outcome).toMatchObject({
        status: "needs-approval",
        approval: { kind: "requests" },
      });
      const approval: unknown = Reflect.get(Object(outcome), "approval");
      const hold: unknown = Reflect.get(Object(approval), "hold");
      const requests: unknown = Reflect.get(Object(approval), "requests");
      if (typeof hold !== "string" || !Array.isArray(requests)) {
        throw new Error("no hold");
      }
      return { hold, requests };
    }

    /** A field whose typing makes the page do `onType`. */
    function Field({ onType }: { onType: (value: string) => void }) {
      return (
        <main>
          <form id="f" action="/subscribe" method="post">
            <input
              name="email"
              onChange={(event) => onType(event.target.value)}
            />
          </form>
          <p id="note">Note</p>
        </main>
      );
    }
    const type = (text = "a@b.example") =>
      interact({ kind: "type", selector: 'input[name="email"]', text });

    it("holds onchange=this.form.submit(), and sends the fields as they were", async () => {
      render(
        <>
          <Field
            onType={() =>
              document.querySelector<HTMLFormElement>("#f")?.submit()
            }
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      const { hold, requests } = heldOf(await type());
      expect(requests).toEqual([
        {
          via: "form",
          method: "POST",
          url: "http://localhost/subscribe",
          body: "email=a%40b.example".replace("%40", "@"),
        },
      ]);
      expect(submitted).toEqual([]);
      // The page changes the field while the card waits: Allow sends what
      // the person was shown.
      const field = document.querySelector<HTMLInputElement>(
        'input[name="email"]',
      );
      if (field !== null) field.value = "changed@example.com";
      expect(
        await interact({ kind: "release", hold, allow: true }),
      ).toMatchObject({
        status: "done",
        interaction: { did: "sent the 1 request the person allowed" },
      });
      expect(submitted).toEqual([
        {
          action: "http://localhost/subscribe",
          fields: "email=a%40b.example",
        },
      ]);
      // Released once: a second answer finds nothing waiting.
      expect(
        await interact({ kind: "release", hold, allow: true }),
      ).toMatchObject({ status: "refused" });
    });

    it("holds a fetch POST, shows its body, and the page gets an abort when the person says no", async () => {
      let outcome = "waiting";
      render(
        <>
          <Field
            onType={(value) => {
              fetch("/api/draft", {
                method: "POST",
                body: JSON.stringify({ email: value }),
              }).then(
                () => {
                  outcome = "sent";
                },
                (error: unknown) => {
                  outcome = String(Reflect.get(Object(error), "name"));
                },
              );
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      const { hold, requests } = heldOf(await type("x"));
      expect(requests).toEqual([
        {
          via: "fetch",
          method: "POST",
          url: "http://localhost/api/draft",
          body: '{"email":"x"}',
        },
      ]);
      await interact({ kind: "release", hold, allow: false });
      expect(outcome).toBe("AbortError");
      expect(sent).toEqual([]);
    });

    it("holds an XHR and a beacon, and a refused XHR finishes as a failure", async () => {
      const beacons: unknown[] = [];
      Reflect.set(window.navigator, "sendBeacon", (url: unknown) => {
        beacons.push(url);
        return true;
      });
      const events: string[] = [];
      let request: XMLHttpRequest | null = null;
      render(
        <>
          <Field
            onType={() => {
              const xhr = new XMLHttpRequest();
              request = xhr;
              xhr.open("PUT", "/api/item/1");
              for (const name of ["readystatechange", "error", "loadend"]) {
                xhr.addEventListener(name, () => events.push(name));
              }
              xhr.send("{}");
              navigator.sendBeacon("/api/track", "typed");
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      const { hold, requests } = heldOf(await type());
      expect(requests).toEqual([
        {
          via: "xhr",
          method: "PUT",
          url: "http://localhost/api/item/1",
          body: "{}",
        },
        {
          via: "beacon",
          method: "POST",
          url: "http://localhost/api/track",
          body: "typed",
        },
      ]);
      await interact({ kind: "release", hold, allow: false });
      expect(events).toEqual(["readystatechange", "error", "loadend"]);
      expect(Reflect.get(Object(request), "readyState")).toBe(4);
      expect(beacons).toEqual([]);
    });

    it("holds what it cannot read, rather than letting it through", async () => {
      render(
        <>
          <Field
            onType={() => {
              const address = { toString: () => "/api/save" };
              Promise.resolve(
                Reflect.apply(window.fetch, window, [
                  address,
                  { method: "POST" },
                ]),
              ).catch(() => {});
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      expect(heldOf(await type()).requests).toEqual([
        { via: "fetch", method: "POST", url: "" },
      ]);
      expect(sent).toEqual([]);
    });

    it("refuses outright more requests than the person can be shown", async () => {
      render(
        <>
          <Field
            onType={() => {
              for (let i = 0; i < 11; i++) {
                void fetch(`/api/item/${i}`, { method: "DELETE" }).catch(
                  () => {},
                );
              }
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      expect(await type()).toMatchObject({
        status: "refused",
        error: expect.stringContaining("11 requests"),
      });
      expect(sent).toEqual([]);
    });

    it("lets reading through: a GET fetch needs no one", async () => {
      render(
        <>
          <Field
            onType={() => {
              void fetch("/api/suggest");
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      expect(await type()).toMatchObject({ status: "done" });
      expect(sent).toEqual([{ url: "/api/suggest", method: "GET" }]);
    });

    it("refuses what an earlier action held when the assistant moves on", async () => {
      let outcome = "waiting";
      render(
        <>
          <Field
            onType={() => {
              fetch("/api/save", { method: "POST" }).then(
                () => {
                  outcome = "sent";
                },
                () => {
                  outcome = "refused";
                },
              );
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      heldOf(await type());
      await interact({ kind: "press", key: "Escape", selector: "#note" });
      expect(outcome).toBe("refused");
      expect(sent).toEqual([]);
    });

    it("leaves nothing stuck when the page wraps fetch again during an action", async () => {
      let wrapped: typeof window.fetch | null = null;
      render(
        <>
          <Field
            onType={() => {
              // An SDK that instruments fetch, as the page loads it.
              const inner = window.fetch;
              wrapped = (input, init) => inner(input, init);
              window.fetch = wrapped;
            }}
          />
          <ValCanvasBridge draftMode />
        </>,
      );
      expect(await type()).toMatchObject({ status: "done" });
      expect(window.fetch).toBe(wrapped);
      // After the action, the page's POST goes straight out.
      await window.fetch("/api/later", { method: "POST" });
      expect(sent).toEqual([{ url: "/api/later", method: "POST" }]);
    });

    it("sends a held XHR's body as it was, and drops the hold if the page opens it again", async () => {
      const bodies: unknown[] = [];
      const send = jest
        .spyOn(XMLHttpRequest.prototype, "send")
        .mockImplementation((body?: unknown) => {
          bodies.push(body instanceof FormData ? body.get("email") : body);
        });
      // What the page made, kept where the test can reach it.
      const page: { xhr: XMLHttpRequest | null; fields: FormData | null } = {
        xhr: null,
        fields: null,
      };
      try {
        render(
          <>
            <Field
              onType={(value) => {
                const xhr = new XMLHttpRequest();
                page.xhr = xhr;
                xhr.open("POST", "/api/draft");
                const fields = new FormData();
                fields.append("email", value);
                page.fields = fields;
                xhr.send(fields);
              }}
            />
            <ValCanvasBridge draftMode />
          </>,
        );
        const first = heldOf(await type("ada@example.com"));
        // The page changes what it sent while the card waits.
        page.fields?.set("email", "changed@example.com");
        await interact({ kind: "release", hold: first.hold, allow: true });
        expect(bodies).toEqual(["ada@example.com"]);

        const second = heldOf(await type("x"));
        // Opened again before the person answered: no longer that request.
        page.xhr?.open("GET", "/api/other");
        expect(
          await interact({ kind: "release", hold: second.hold, allow: true }),
        ).toMatchObject({
          status: "done",
          interaction: {
            did: expect.stringContaining("the page opened it again"),
          },
        });
        expect(bodies).toEqual(["ada@example.com"]);
      } finally {
        send.mockRestore();
      }
    });

    it("refuses to hold a body it cannot copy", async () => {
      const send = jest
        .spyOn(XMLHttpRequest.prototype, "send")
        .mockImplementation(() => {});
      try {
        render(
          <>
            <Field
              onType={() => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", "/api/draft");
                // A document: nothing that can be copied as it is now.
                xhr.send(document);
              }}
            />
            <ValCanvasBridge draftMode />
          </>,
        );
        expect(await type()).toMatchObject({
          status: "done",
          interaction: {
            blocked: [{ via: "xhr", method: "POST" }],
          },
        });
        expect(send).not.toHaveBeenCalled();
      } finally {
        send.mockRestore();
      }
    });

    it("submits a held form with the submitter's own encoding", async () => {
      const encodings: string[] = [];
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        encodings.push(this.enctype);
      };
      render(
        <>
          <main>
            <form id="f" action="/upload" method="post">
              <input
                name="title"
                onChange={() =>
                  document
                    .querySelector<HTMLFormElement>("#f")
                    ?.requestSubmit(
                      document.querySelector<HTMLElement>("#send") ?? undefined,
                    )
                }
              />
              <button
                id="send"
                formEncType="multipart/form-data"
                formMethod="post"
              >
                Upload
              </button>
            </form>
          </main>
          <ValCanvasBridge draftMode />
        </>,
      );
      const { hold } = heldOf(
        await interact({
          kind: "type",
          selector: 'input[name="title"]',
          text: "x",
        }),
      );
      await interact({ kind: "release", hold, allow: true });
      expect(encodings).toEqual(["multipart/form-data"]);
    });

    it("does not send a form with a file where the browser cannot attach it", async () => {
      // jsdom has no DataTransfer: as a browser without one.
      expect(typeof Reflect.get(window, "DataTransfer")).toBe("undefined");
      render(
        <>
          <main>
            <form
              id="f"
              action="/upload"
              method="post"
              encType="multipart/form-data"
            >
              <input type="file" name="photo" />
              <input
                name="title"
                onChange={() =>
                  document.querySelector<HTMLFormElement>("#f")?.submit()
                }
              />
            </form>
          </main>
          <ValCanvasBridge draftMode />
        </>,
      );
      const file = document.querySelector<HTMLInputElement>(
        'input[name="photo"]',
      );
      if (file !== null) {
        Object.defineProperty(file, "files", {
          configurable: true,
          value: [new File(["x"], "photo.png", { type: "image/png" })],
        });
      }
      const fields = new FormData();
      fields.append("photo", new File(["x"], "photo.png"));
      jest.spyOn(window, "FormData").mockImplementation(() => fields);
      const { hold } = heldOf(
        await interact({
          kind: "type",
          selector: 'input[name="title"]',
          text: "x",
        }),
      );
      expect(
        await interact({ kind: "release", hold, allow: true }),
      ).toMatchObject({
        interaction: { did: expect.stringContaining("sends a file") },
      });
      expect(submitted).toEqual([]);
    });

    it("puts the page's own functions back when the action ends", async () => {
      const open = XMLHttpRequest.prototype.open;
      render(
        <>
          <Field onType={() => {}} />
          <ValCanvasBridge draftMode />
        </>,
      );
      // The page log wraps `fetch` once, when the bridge mounts.
      const logged = window.fetch;
      await type();
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
    const outcome = await approvedly({ kind: "click", selector: "#broken" });
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
    expect(await approvedly({ kind: "click", selector: "#go" })).toEqual({
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
