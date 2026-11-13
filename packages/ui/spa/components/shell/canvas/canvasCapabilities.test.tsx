/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  BRIDGE_CAPABILITIES,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import {
  CanvasFrame,
  type PageLogReader,
  type PageReader,
} from "./CanvasFrame";
import { unansweredRequestError } from "./canvasCapabilities";
import type { ModuleFilePath } from "@valbuild/core";

const ABOUT = "/content/about.val.ts" as ModuleFilePath;

/**
 * The Studio asking only what the page's bridge answers. A site carries
 * whatever `@valbuild/next` or `@valbuild/tanstack` it installed, so a tool
 * newer than that bridge used to wait for its whole timeout and then say
 * "no answer" -- five seconds to learn nothing. Now the page says in `ready`
 * what it answers, and the Studio says at once what to update.
 */
describe("unansweredRequestError", () => {
  it("names the package and the version to move to", () => {
    expect(
      unansweredRequestError(
        "readPageLog",
        {
          capabilities: ["readPage"],
          bridge: { package: "@valbuild/tanstack", version: "0.150.0" },
        },
        "0.153.5",
      ),
    ).toBe(
      "The page in the preview cannot say what went wrong on it (its console errors and failed requests): it runs @valbuild/tanstack 0.150.0, which is older than the Studio. " +
        "Update @valbuild/tanstack to 0.153.5 or later (the Studio's version), then deploy the site (or restart its dev server).",
    );
  });

  it("names both bindings for a bridge that does not say which it is", () => {
    expect(unansweredRequestError("readPageLog", {}, "0.153.5")).toMatch(
      /Update @valbuild\/next or @valbuild\/tanstack, whichever the site uses, to 0\.153\.5 or later/,
    );
  });

  it("asks a bridge from before the list what bridges always answered", () => {
    expect(unansweredRequestError("readPage", {})).toBeNull();
    expect(unansweredRequestError("screenshotPage", {})).toBeNull();
  });

  it("leaves a page that has not said anything yet to the timeout", () => {
    expect(unansweredRequestError("readPageLog", null)).toBeNull();
  });
});

describe("the canvas asking the page", () => {
  let posted: ValCanvasStudioMessage[];
  let frame: HTMLIFrameElement;
  let reader: PageReader | null;
  let logReader: PageLogReader | null;

  beforeEach(() => {
    jest.useFakeTimers();
    reader = null;
    logReader = null;
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        onPageReader={(read) => {
          reader = read;
        }}
        onPageLogReader={(read) => {
          logReader = read;
        }}
      />,
    );
    const found = rendered.container.querySelector("iframe");
    if (found === null) throw new Error("the frame did not render");
    frame = found;
    const target = frame.contentWindow;
    if (target === null) throw new Error("the frame has no content window");
    posted = [];
    jest
      .spyOn(target, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

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
    extra: Partial<Extract<ValCanvasPageMessage, { type: "ready" }>>,
  ) =>
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "/",
      ...extra,
    });

  it("says at once that an older bridge cannot read the log, and asks it nothing", async () => {
    // A bridge of the release before: no list.
    ready({});
    if (logReader === null) throw new Error("no log reader");
    await expect(logReader({})).rejects.toThrow(
      /@valbuild\/next or @valbuild\/tanstack/,
    );
    expect(posted.some((message) => message.type === "readPageLog")).toBe(
      false,
    );
  });

  it("says at once when a bridge's list leaves the request out", async () => {
    ready({
      capabilities: ["readPageLog"],
      bridge: { package: "@valbuild/next", version: "0.160.0" },
    });
    if (reader === null) throw new Error("no reader");
    await expect(reader({})).rejects.toThrow(
      /it runs @valbuild\/next 0\.160\.0/,
    );
    expect(posted.some((message) => message.type === "readPage")).toBe(false);
  });

  it("reads a ready it does not fully understand as one from before the list", async () => {
    // A newer bridge's shapes: the page is still there, and asked as an
    // older bridge would be -- not dropped to "no answer".
    ready({ capabilities: "everything", bridge: { package: 7 } });
    if (reader === null) throw new Error("no reader");
    void reader({}).catch(() => undefined);
    expect(posted.some((message) => message.type === "readPage")).toBe(true);
    if (logReader === null) throw new Error("no log reader");
    await expect(logReader({})).rejects.toThrow(
      /@valbuild\/next or @valbuild\/tanstack/,
    );
  });

  it("asks a bridge that lists it, and hands back its answer", async () => {
    ready({ capabilities: [...BRIDGE_CAPABILITIES] });
    if (logReader === null) throw new Error("no log reader");
    const answered = logReader({ levels: ["error"] });
    const asked = posted.find((message) => message.type === "readPageLog");
    if (asked === undefined || asked.type !== "readPageLog") {
      throw new Error("the page was not asked");
    }
    expect(asked).toMatchObject({ levels: ["error"] });
    const log = {
      path: "/",
      entries: [],
      sinceNavigation: true,
      dropped: 0,
      startedAt: 12,
    };
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "pageLogRead",
      requestId: asked.requestId,
      log,
    });
    await expect(answered).resolves.toEqual(log);
  });

  it("adds the modules the page said it read to what read_page answers", async () => {
    ready({
      capabilities: [...BRIDGE_CAPABILITIES],
      holds: [ABOUT],
    });
    if (reader === null) throw new Error("no reader");
    const answered = reader({});
    const asked = posted.find((message) => message.type === "readPage");
    if (asked === undefined || asked.type !== "readPage") {
      throw new Error("the page was not asked");
    }
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "pageRead",
      requestId: asked.requestId,
      snapshot: {
        url: "http://localhost/",
        title: "About",
        viewport: { width: 800, height: 600, scrollY: 0, pageHeight: 600 },
        outline: [],
      },
    });
    await expect(answered).resolves.toMatchObject({
      modules: ["/content/about.val.ts"],
    });
  });
});
