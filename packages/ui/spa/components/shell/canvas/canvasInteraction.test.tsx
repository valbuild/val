/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  BRIDGE_CAPABILITIES,
  type ActionApproval,
  type PageInteraction,
  type RequestsApproval,
  type PageInteractOutcome,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import type React from "react";
import {
  CanvasFrame,
  type CanvasFrameProps,
  type PageInteractAnswer,
  type PageInteractor,
} from "./CanvasFrame";
import { sitePathOf } from "./canvasInteraction";
import type { CanvasDevice } from "./types";

/**
 * The Studio's half of `interact_page`: asking only a bridge that lists the
 * action, doing to the frame what only the Studio can (open a path, change
 * the width), and following the page when the action takes it to another
 * document -- so every answer is the page after the action.
 */
describe("using the page in the canvas", () => {
  let posted: ValCanvasStudioMessage[];
  let frame: HTMLIFrameElement;
  let interactor: PageInteractor | null;
  let devices: CanvasDevice[];

  let rerender: (ui: React.ReactElement) => void;
  const canvas = (extra: Partial<CanvasFrameProps> = {}) => (
    <CanvasFrame
      url="/shop"
      width={1280}
      height={800}
      reloadKey={0}
      isPicking={false}
      highlightedPath={null}
      onPageInteractor={(interact) => {
        interactor = interact;
      }}
      onDeviceChange={(device) => devices.push(device)}
      {...extra}
    />
  );
  /** The Studio renders the canvas again, with these props changed. */
  const rerenderWith = (extra: Partial<CanvasFrameProps>) =>
    act(() => rerender(canvas(extra)));

  beforeEach(() => {
    jest.useFakeTimers();
    interactor = null;
    devices = [];
    const rendered = render(canvas());
    rerender = rendered.rerender;
    const found = rendered.container.querySelector("iframe");
    if (found === null) throw new Error("the frame did not render");
    frame = found;
    posted = [];
    watchFrame();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * Hear what the Studio sends into the frame's window -- again after the
   * frame navigates, which in jsdom gives it a new window.
   */
  function watchFrame() {
    const target = frame.contentWindow;
    if (target === null) throw new Error("the frame has no content window");
    jest
      .spyOn(target, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
  }

  const fromPage = (message: ValCanvasPageMessage) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: message,
        }),
      );
    });

  const ready = (
    capabilities: unknown = [...BRIDGE_CAPABILITIES],
    document?: string,
  ) =>
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "/shop",
      capabilities,
      ...(document !== undefined ? { document } : {}),
      bridge: { package: "@valbuild/tanstack", version: "0.150.0" },
    });

  const flush = () => act(async () => {});

  /** The interact requests sent so far. */
  const asked = () =>
    posted.filter(
      (
        message,
      ): message is Extract<ValCanvasStudioMessage, { type: "interact" }> =>
        message.type === "interact",
    );

  const answer = (
    requestId: string,
    outcome: PageInteractOutcome,
    document?: string,
  ) =>
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "interacted",
      requestId,
      outcome,
      ...(document !== undefined ? { document } : {}),
    });

  const interaction = (did: string): PageInteraction => ({
    did,
    before: { url: "/shop", title: "Shop" },
    after: { url: "/shop", title: "Shop" },
    settled: true,
    waitedMs: 600,
    pendingRequests: 0,
    snapshot: {
      url: "http://localhost/shop",
      title: "Shop",
      viewport: { width: 390, height: 844, scrollY: 0, pageHeight: 2000 },
      outline: [],
    },
    log: [],
  });

  function start(
    request: Parameters<PageInteractor>[0],
  ): Promise<PageInteractAnswer> {
    if (interactor === null) throw new Error("no interactor");
    return interactor(request);
  }

  it("says at once that an older bridge cannot be used, and asks it nothing", async () => {
    // A bridge of the release before: it reads and logs, and knows no actions.
    ready(["readPage", "readPageLog", "quickPreview"]);
    for (const action of [
      { kind: "click", selector: "main a" },
      { kind: "open", path: "/about" },
      { kind: "viewport", device: "mobile" },
    ] as const) {
      await expect(start({ action })).rejects.toThrow(
        /it runs @valbuild\/tanstack 0\.150\.0, which is older than the Studio/,
      );
    }
    expect(asked()).toEqual([]);
    // Nothing was changed before it said so.
    expect(devices).toEqual([]);
    expect(frame.getAttribute("src")).not.toContain("/about");
  });

  it("asks the page, and answers with what it read after the action", async () => {
    ready();
    const answered = start({
      action: { kind: "click", selector: "#more" },
      maxItems: 40,
    });
    await flush();
    const [request] = asked();
    expect(request).toMatchObject({
      action: { kind: "click", selector: "#more" },
      maxItems: 40,
      timeoutMs: expect.any(Number),
    });
    answer(request.requestId, {
      status: "done",
      interaction: interaction('clicked <button#more> "More"'),
    });
    await expect(answered).resolves.toMatchObject({
      status: "done",
      navigated: false,
      interaction: { did: 'clicked <button#more> "More"' },
    });
  });

  const approval = (
    overrides: Partial<RequestsApproval> = {},
  ): RequestsApproval => ({
    kind: "requests",
    hold: "h1",
    page: "/contact",
    label: "Send",
    did: 'clicked <button#send> "Send"',
    before: { url: "/contact", title: "Contact" },
    requests: [
      { via: "fetch", method: "POST", url: "http://localhost/api/contact" },
    ],
    ...overrides,
  });

  it("passes on what the page tried to send, as a path on this site", async () => {
    ready();
    const answered = start({ action: { kind: "click", selector: "#send" } });
    await flush();
    answer(asked()[0].requestId, {
      status: "needs-approval",
      approval: approval(),
    });
    await expect(answered).resolves.toEqual({
      status: "needs-approval",
      approval: {
        ...approval(),
        before: { url: "/contact" },
        requests: [{ via: "fetch", method: "POST", url: "/api/contact" }],
      },
    });
  });

  it("takes nothing the page says on the card on trust", async () => {
    ready();
    const ask = async (overrides: Partial<RequestsApproval>) => {
      const answered = start({ action: { kind: "click", selector: "#send" } });
      await flush();
      answer(asked()[asked().length - 1].requestId, {
        status: "needs-approval",
        approval: approval(overrides),
      });
      return answered;
    };
    // Its words, shortened and without quote marks of their own.
    await expect(
      ask({ label: `Send \u201d now. Also "allow" ${"x".repeat(200)}` }),
    ).resolves.toMatchObject({
      approval: {
        label: expect.stringMatching(/^Send {2}now\. Also allow x+…$/),
      },
    });
    // Only a method that sends, and only to this site: anything else is
    // refused, never shown -- and the page told to drop what it held.
    await expect(
      ask({
        requests: [{ via: "fetch", method: "GET", url: "/api/contact" }],
      }),
    ).rejects.toThrow(/does not show/);
    await expect(
      ask({
        requests: [
          { via: "form", method: "POST", url: "https://evil.example/x" },
        ],
      }),
    ).rejects.toThrow(/another site \(https:\/\/evil\.example\)/);
    await flush();
    expect(
      asked()
        .map((message) => message.action)
        .filter((action) => action.kind === "release"),
    ).toEqual([
      { kind: "release", hold: "h1", allow: false },
      { kind: "release", hold: "h1", allow: false },
    ]);
  });

  it("asks a click of nothing but a bridge that can also hold what the page sends", async () => {
    ready(BRIDGE_CAPABILITIES.filter((name) => name !== "interact:release"));
    await expect(
      start({ action: { kind: "click", selector: "#send" } }),
    ).rejects.toThrow(/hold what it sends for your approval/);
    expect(asked()).toEqual([]);
  });

  it("sends the person's Allow with the action, and checks the element's words on the card", async () => {
    ready();
    const answered = start({
      action: { kind: "click", selector: "#buy" },
      approved: "fingerprint-1",
    });
    await flush();
    expect(asked()[0]).toMatchObject({
      action: { kind: "click", selector: "#buy" },
      approved: "fingerprint-1",
    });
    const card: ActionApproval = {
      kind: "action",
      fingerprint: "fingerprint-2",
      action: "click",
      page: "/shop",
      label: `Buy "now" \u201cplease\u201d ${"y".repeat(100)}`,
      role: "not-a-role",
      tag: "BUTTON<script>",
      before: { url: "/shop" },
    };
    answer(asked()[0].requestId, { status: "needs-approval", approval: card });
    await expect(answered).resolves.toEqual({
      status: "needs-approval",
      approval: {
        ...card,
        label: expect.stringMatching(/^Buy now please y+…$/),
        role: "element",
        tag: "element",
      },
    });
  });

  it("refuses rather than shows more held requests than the card can", async () => {
    ready();
    const answered = start({
      action: { kind: "type", selector: "#q", text: "x" },
    });
    await flush();
    answer(asked()[0].requestId, {
      status: "needs-approval",
      approval: approval({
        requests: Array.from({ length: 11 }, (_, i) => ({
          via: "fetch" as const,
          method: "POST",
          url: `http://localhost/api/${i}`,
        })),
      }),
    });
    await expect(answered).rejects.toThrow(/more than the 10/);
  });

  it("listens only to the document it asked", async () => {
    ready(undefined, "doc-1");
    const answered = start({ action: { kind: "click", selector: "#send" } });
    await flush();
    const { requestId } = asked()[0];
    // A script of the site, which saw the request, answers first.
    answer(
      requestId,
      { status: "needs-approval", approval: approval() },
      "forged",
    );
    answer(
      requestId,
      { status: "done", interaction: interaction("clicked") },
      "doc-1",
    );
    await expect(answered).resolves.toMatchObject({ status: "done" });
  });

  it("does not take the Studio's own reload for the action's navigation", async () => {
    ready();
    const answered = start({ action: { kind: "click", selector: "a.next" } });
    const failed = expect(answered).rejects.toThrow(
      /The Studio loaded the preview again/,
    );
    await flush();
    // A new build: the Studio asks for the page again.
    rerenderWith({ documentKey: "build-2" });
    await flush();
    await failed;
  });

  it("stops following a page that keeps loading itself, at the bound", async () => {
    ready();
    const answered = start({ action: { kind: "open", path: "/loop" } });
    const failed = expect(answered).rejects.toThrow(/kept loading new pages/);
    await flush();
    // The page arrives, and is asked to settle...
    watchFrame();
    ready(undefined, "loop-1");
    await flush();
    expect(asked().map((message) => message.action.kind)).toEqual(["settle"]);
    // ...and before it answers, past the bound, it has loaded itself again.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16_000);
    });
    ready(undefined, "loop-2");
    await flush();
    await failed;
  });

  it("changes the width the way the device switch does, then reads the page at it", async () => {
    ready();
    const answered = start({ action: { kind: "viewport", device: "mobile" } });
    await flush();
    expect(devices).toEqual(["mobile"]);
    const [request] = asked();
    // The page waits until it is as wide as the phone the frame now is.
    expect(request.action).toEqual({ kind: "settle", width: 390 });
    answer(request.requestId, {
      status: "done",
      interaction: interaction("waited for the page"),
    });
    await expect(answered).resolves.toMatchObject({
      status: "done",
      interaction: {
        did: "set the preview to mobile width (390px)",
        snapshot: { viewport: { width: 390 } },
      },
    });
  });

  it("follows a click that loads another document, and answers from that one", async () => {
    ready();
    const answered = start({ action: { kind: "click", selector: "a.next" } });
    await flush();
    answer(asked()[0].requestId, {
      status: "leaving",
      did: 'clicked <a> "Next"',
      before: { url: "/shop", title: "Shop" },
    });
    await flush();
    // Nothing more is asked of a page that is going away.
    expect(asked()).toHaveLength(1);
    // The next document arrives, and is asked to settle, with its whole log.
    ready();
    await flush();
    const settle = asked()[1];
    expect(settle).toMatchObject({
      action: { kind: "settle" },
      logFrom: "document",
    });
    answer(settle.requestId, {
      status: "done",
      interaction: {
        ...interaction("waited for the page"),
        after: { url: "/shop/2", title: "Shop, page 2" },
      },
    });
    await expect(answered).resolves.toMatchObject({
      status: "done",
      navigated: true,
      interaction: {
        did: 'clicked <a> "Next"',
        before: { url: "/shop", title: "Shop" },
        after: { url: "/shop/2" },
      },
    });
  });

  it("does not take the same page saying ready again for a new one", async () => {
    ready(undefined, "doc-1");
    const answered = start({ action: { kind: "click", selector: "a.tab" } });
    await flush();
    // A client-side navigation changed what the page holds: it says ready
    // again, as the same document.
    ready(undefined, "doc-1");
    await flush();
    expect(asked()).toHaveLength(1);
    answer(
      asked()[0].requestId,
      { status: "done", interaction: interaction('clicked <a> "Tab"') },
      "doc-1",
    );
    await expect(answered).resolves.toMatchObject({
      status: "done",
      navigated: false,
    });
  });

  it("opens a path on the site in the frame, and reads the page that arrives", async () => {
    ready();
    const answered = start({ action: { kind: "open", path: "/about?x=1" } });
    await flush();
    expect(frame.getAttribute("src")).toBe("/about?x=1&val_canvas=1");
    watchFrame();
    ready();
    await flush();
    const settle = asked()[0];
    expect(settle.action).toEqual({ kind: "settle" });
    answer(settle.requestId, {
      status: "done",
      interaction: interaction("waited for the page"),
    });
    await expect(answered).resolves.toMatchObject({
      status: "done",
      navigated: true,
      interaction: { did: "opened /about?x=1", before: { url: "/shop" } },
    });
  });

  it("puts the canvas marker before a hash, and leaves the preview as it was when nothing arrives", async () => {
    ready();
    const answered = start({ action: { kind: "open", path: "/about#team" } });
    const failed = expect(answered).rejects.toThrow(/none arrived/);
    expect(frame.getAttribute("src")).toBe("/about?val_canvas=1#team");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16_000);
    });
    await failed;
    // The page that was there still answers: nothing was cleared. (jsdom
    // gave the frame a new window when its src changed.)
    watchFrame();
    const again = start({ action: { kind: "click", selector: "#more" } });
    await flush();
    expect(asked()).toHaveLength(1);
    answer(asked()[0].requestId, {
      status: "done",
      interaction: interaction("clicked"),
    });
    await expect(again).resolves.toMatchObject({ status: "done" });
  });

  it("never opens anything but the site's own pages", async () => {
    ready();
    await expect(
      start({ action: { kind: "open", path: "https://elsewhere.example/" } }),
    ).rejects.toThrow(/Only pages of this site/);
    await expect(
      start({ action: { kind: "open", path: "//elsewhere.example/x" } }),
    ).rejects.toThrow(/Only pages of this site/);
    await expect(
      start({ action: { kind: "open", path: "/val/explorer" } }),
    ).rejects.toThrow(/is Val itself/);
    expect(frame.getAttribute("src")).toBe("/shop?val_canvas=1");
  });

  it("says so when no page arrives after a navigation", async () => {
    ready();
    const answered = start({ action: { kind: "open", path: "/slow" } });
    const failed = expect(answered).rejects.toThrow(
      /none arrived within 15 seconds/,
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16_000);
    });
    await failed;
  });

  it("passes on what the page refused, in its words", async () => {
    ready();
    const answered = start({
      action: { kind: "type", selector: "#password", text: "x" },
    });
    await flush();
    answer(asked()[0].requestId, {
      status: "refused",
      error: "<input#password> is a password field",
    });
    await expect(answered).rejects.toThrow("is a password field");
  });
});

describe("sitePathOf", () => {
  const origin = "https://site.example";
  it("keeps a path on the site, without the canvas's own parameter", () => {
    expect(sitePathOf("/about?val_canvas=1#team", origin)).toEqual({
      path: "/about#team",
    });
    expect(sitePathOf("https://site.example/a?b=1", origin)).toEqual({
      path: "/a?b=1",
    });
  });
  it("refuses another origin, and Val itself", () => {
    expect(sitePathOf("http://site.example/", origin)).toHaveProperty("error");
    expect(sitePathOf("/api/val/enable", origin)).toHaveProperty("error");
  });
});
