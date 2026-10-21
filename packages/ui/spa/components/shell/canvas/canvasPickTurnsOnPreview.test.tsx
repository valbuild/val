/**
 * @jest-environment jsdom
 */
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PageWorkspace } from "./PageWorkspace";
import { CanvasPreviewStatus } from "./CanvasPreviewNotice";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasView } from "./types";

/*
 * The fields column reads the Studio's stores, which reach an ESM-only module
 * jest cannot require — see `noOpSourcePaths.test.tsx`. Neither is what this
 * is about: the page here has reported no fields, which is the point.
 */
jest.mock("./CanvasFields", () => ({
  __esModule: true,
  CanvasFields: () => null,
}));
jest.mock("./useRetainedCanvasPaths", () => ({
  __esModule: true,
  useRetainedCanvasPaths: (paths: readonly string[]) => ({
    paths,
    offPage: [],
  }),
}));

/**
 * The pick button, where preview mode is off.
 *
 * With preview mode off the page tags nothing, so the button used to be
 * missing - the page had reported no fields - and the only way to start
 * selecting was to find the notice's button, wait for the page, and then find
 * the pick button that had appeared meanwhile. Now it is there, outlined, and
 * pressing it is the whole of that: preview mode on, then selecting.
 */
describe("picking with preview mode off", () => {
  // The split and the canvas window measure themselves; jsdom has no layout.
  const original = globalThis.ResizeObserver;
  beforeEach(() => {
    globalThis.ResizeObserver = class implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  /** What the workspace last handed the canvas. */
  let canvas: { isPicking: boolean; enableKey: number };
  let reportStatus: (status: CanvasPreviewStatus) => void;

  function FakeCanvas({
    isPicking,
    enableKey,
    onStatusChange,
    status,
  }: {
    isPicking: boolean;
    enableKey: number;
    onStatusChange: (status: CanvasPreviewStatus) => void;
    status: CanvasPreviewStatus;
  }) {
    canvas = { isPicking, enableKey };
    reportStatus = onStatusChange;
    useEffect(() => {
      onStatusChange(status);
    }, [onStatusChange, status]);
    return null;
  }

  const renderWorkspace = (view: CanvasView) =>
    render(
      <PageWorkspace
        breakpoint="desktop"
        isCanvasOpen
        onCloseCanvas={() => undefined}
        view={view}
        onViewChange={() => undefined}
        pane="canvas"
        onPaneChange={() => undefined}
        skipTransition
        renderCanvas={({ isPicking, enableKey, onStatusChange }) => (
          <FakeCanvas
            isPicking={isPicking}
            enableKey={enableKey}
            onStatusChange={onStatusChange}
            status="preview-off"
          />
        )}
      >
        <div />
      </PageWorkspace>,
    );

  test("the pick button is there, though the page has reported nothing", () => {
    renderWorkspace("normal");
    expect(
      screen.queryByRole("button", {
        name: "Turn preview on and pick from the page",
      }),
    ).not.toBeNull();
  });

  test("pressing it turns preview mode on, and asks for picking", () => {
    renderWorkspace("normal");
    expect(canvas).toEqual({ isPicking: false, enableKey: 0 });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn preview on and pick from the page",
      }),
    );
    expect(canvas).toEqual({ isPicking: true, enableKey: 1 });
  });

  test("in the fields view, where picking is already on, it does not turn it off", () => {
    // Picking is the fields view's default, and with preview mode off it has
    // nothing to select. A toggle would answer the press with the opposite of
    // what it was pressed for.
    renderWorkspace("fields");
    expect(canvas.isPicking).toBe(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn preview on and pick from the page",
      }),
    );
    expect(canvas).toEqual({ isPicking: true, enableKey: 1 });
  });

  test("it stays through the turn-on, as the button it will be", () => {
    renderWorkspace("normal");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn preview on and pick from the page",
      }),
    );
    act(() => reportStatus("enabling"));
    // Pressed, and no longer offering to turn anything on: that is happening.
    const button = screen.getByRole("button", {
      name: "Stop selecting on the page",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  test("the notice above it has no button of its own", () => {
    renderWorkspace("normal");
    expect(screen.queryByText("Preview mode is off")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).toBeNull();
  });
});

describe("the toolbar's pick button", () => {
  const toolbar = (props: {
    isPicking: boolean;
    pickNeedsPreview?: boolean;
    onPickingChange: (isPicking: boolean) => void;
  }) => (
    <CanvasToolbar
      device="desktop"
      onDeviceChange={() => undefined}
      scale={1}
      onZoomIn={() => undefined}
      onZoomOut={() => undefined}
      onFit={() => undefined}
      {...props}
    />
  );

  test("is outlined, not pressed, while preview mode is off", () => {
    render(
      toolbar({
        isPicking: true,
        pickNeedsPreview: true,
        onPickingChange: () => undefined,
      }),
    );
    const button = screen.getByRole("button", {
      name: "Turn preview on and pick from the page",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    // An outline, and not the fill that says picking is on.
    expect(button.classList.contains("ring-1")).toBe(true);
    expect(button.classList.contains("bg-bg-page-selection-fill")).toBe(false);
  });

  test("still toggles once preview mode is on", () => {
    const onPickingChange = jest.fn();
    render(toolbar({ isPicking: true, onPickingChange }));
    fireEvent.click(
      screen.getByRole("button", { name: "Stop selecting on the page" }),
    );
    expect(onPickingChange).toHaveBeenCalledWith(false);
  });
});
