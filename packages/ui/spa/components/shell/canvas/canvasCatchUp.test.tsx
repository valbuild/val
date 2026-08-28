/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "./CanvasFrame";

/**
 * Catching a new document up with what the editor holds.
 *
 * The relay into the canvas only carries a *change*, so a freshly loaded
 * document is caught up once with a snapshot and then told that was all of it.
 * Which document that runs for is the whole question, and it used to be keyed on
 * `reloadKey` — the reloads the STUDIO asked for.
 *
 * A page also reloads itself: `next dev` does it when a `.val.ts` changes, and
 * publishing rewrites those files. That new document announces itself with
 * another `ready` carrying the same `draftMode`, so nothing the effect depended
 * on changed and it never re-ran. The document kept whatever the server had
 * rendered — which right after a publish can be the content from before it —
 * until a keystroke happened to relay something. With auto-save on, a publish
 * per pause in typing, that was the canvas going stale and coming back as you
 * typed.
 */
describe("catching the canvas up", () => {
  /** Every message the studio posted into the frame. */
  let posted: ValCanvasStudioMessage[];
  let frame: HTMLIFrameElement;

  const renderFrame = () => {
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        onRequestReload={() => {}}
      />,
    );
    const found = rendered.container.querySelector("iframe");
    if (found === null) {
      throw new Error("the frame did not render");
    }
    frame = found;
    posted = [];
    const target = frame.contentWindow;
    if (target === null) {
      throw new Error("the frame has no content window");
    }
    jest
      .spyOn(target, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
    return rendered;
  };

  /** The page announcing itself, as a new document does on mount. */
  const announce = () => {
    const message: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "http://localhost/",
    };
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: message,
        }),
      );
    });
  };

  const catchUps = () =>
    posted.filter((message) => message.type === "sourcesSynced").length;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("catches the first document up", () => {
    renderFrame();
    announce();
    expect(catchUps()).toBe(1);
  });

  /**
   * The regression. Two `ready` messages with the same `draftMode` are two
   * documents, and the second one needs the snapshot as much as the first.
   */
  it("catches a document that reloaded itself up too", () => {
    renderFrame();
    announce();
    announce();
    expect(catchUps()).toBe(2);
  });
});
