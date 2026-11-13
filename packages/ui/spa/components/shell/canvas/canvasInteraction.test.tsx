/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  BRIDGE_CAPABILITIES,
  type PageInteraction,
  type PageInteractOutcome,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import {
  CanvasFrame,
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

  beforeEach(() => {
    jest.useFakeTimers();
    interactor = null;
    devices = [];
    const rendered = render(
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
      />,
    );
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

  const answer = (requestId: string, outcome: PageInteractOutcome) =>
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "interacted",
      requestId,
      outcome,
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

  it("passes on a submit the page will not do without the person", async () => {
    ready();
    const answered = start({ action: { kind: "click", selector: "#send" } });
    await flush();
    const approval = {
      via: "click" as const,
      page: "/contact",
      label: "Send",
      method: "POST",
      action: "/contact",
    };
    answer(asked()[0].requestId, { status: "needs-approval", approval });
    await expect(answered).resolves.toEqual({
      status: "needs-approval",
      approval,
    });
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
    answer(asked()[0].requestId, {
      status: "done",
      interaction: interaction('clicked <a> "Tab"'),
    });
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
