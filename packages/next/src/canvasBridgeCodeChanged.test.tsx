/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import type { ModuleFilePath } from "@valbuild/core";
import { dispatchCodeChanged } from "@valbuild/react/internal";
import { VAL_CANVAS_MESSAGE } from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * What the canvas bridge tells the Studio about content the page could not
 * read for its schema: the Studio says the code changed, with a reload
 * (`codeChanged` in the canvas protocol). What was refused before the bridge
 * mounted is said at once; every later announcement the page makes
 * (`dispatchCodeChanged`, which the provider's reporter calls) is passed on,
 * the empty one that takes it back included.
 */
describe("the canvas bridge passing on that the code changed", () => {
  const HOME = "/content/home.val.ts" as ModuleFilePath;
  const ABOUT = "/content/about.val.ts" as ModuleFilePath;
  const originals: { owner: object; key: string; value: unknown }[] = [];
  const replace = (owner: object, key: string, value: unknown) => {
    originals.push({
      owner,
      key,
      value: key in owner ? Reflect.get(owner, key) : undefined,
    });
    Reflect.set(owner, key, value);
  };
  let posted: unknown[];

  beforeEach(() => {
    posted = [];
    replace(
      globalThis,
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    replace(
      window,
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    );
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation((message: unknown) => {
        posted.push(message);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const { owner, key, value } of originals.reverse()) {
      if (value === undefined) Reflect.deleteProperty(owner, key);
      else Reflect.set(owner, key, value);
    }
    originals.length = 0;
  });

  const said = () =>
    posted.flatMap((message) =>
      typeof message === "object" &&
      message !== null &&
      "val" in message &&
      message.val === VAL_CANVAS_MESSAGE &&
      "type" in message &&
      message.type === "codeChanged" &&
      "modules" in message
        ? [message.modules]
        : [],
    );

  test("says what was refused before it mounted, then each change, and takes it back", () => {
    render(<ValCanvasBridge draftMode codeChanged={() => [HOME]} />);
    expect(said()).toEqual([[HOME]]);

    act(() => dispatchCodeChanged([ABOUT, HOME]));
    expect(said()).toEqual([[HOME], [ABOUT, HOME]]);

    act(() => dispatchCodeChanged([]));
    expect(said()).toEqual([[HOME], [ABOUT, HOME], []]);
  });

  test("says nothing when nothing was refused", () => {
    render(<ValCanvasBridge draftMode codeChanged={() => []} />);
    expect(said()).toEqual([]);
  });
});
