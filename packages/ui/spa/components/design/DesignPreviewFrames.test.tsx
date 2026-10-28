/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import type { CanvasFrameProps } from "../shell/canvas/CanvasFrame";
import { DesignPreviewFrames } from "./DesignPreviewFrames";

/** Each frame rendered, by URL, with what it was handed. */
const mockFrames = new Map<string, CanvasFrameProps>();

// The frame itself is the browser's; what is under test is which frames
// there are, in front or behind, and where they open.
jest.mock("../shell/canvas/CanvasFrame", () => ({
  CanvasFrame: (props: CanvasFrameProps) => {
    mockFrames.set(props.url, props);
    return <div data-frame={props.url} />;
  },
}));

const ADDRESS = "https://p1--site.valstart.dev";

function setup() {
  const statuses: string[] = [];
  const props = (buildKey: string) => ({
    address: ADDRESS,
    src: `${ADDRESS}/`,
    buildKey,
    reloadKey: 0,
    origin: ADDRESS,
    elementPicking: null,
    onPickElement: () => {},
    onElementPickingStopped: () => {},
    enableKey: 0,
    onStatusChange: (status: string) => statuses.push(status),
  });
  const view = render(<DesignPreviewFrames {...props("b1")} />);
  const shown = () =>
    Array.from(view.container.querySelectorAll("[data-frame]")).map((frame) => {
      const holder = frame.parentElement;
      return {
        url: frame.getAttribute("data-frame"),
        front: holder?.style.opacity === "1" && holder.style.zIndex === "1",
      };
    });
  return {
    shown,
    build: (key: string) =>
      view.rerender(<DesignPreviewFrames {...props(key)} />),
  };
}

beforeEach(() => {
  mockFrames.clear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test("a new build loads behind the page, where the page is, and fades in once it is there", () => {
  const { shown, build } = setup();
  // The person scrolled down the blog.
  act(() =>
    mockFrames.get(`${ADDRESS}/`)?.onLocation?.({
      path: "/blog",
      scrollX: 0,
      scrollY: 900,
    }),
  );

  build("b2");
  expect(shown()).toEqual([
    { url: `${ADDRESS}/`, front: true },
    { url: `${ADDRESS}/blog`, front: false },
  ]);
  expect(mockFrames.get(`${ADDRESS}/blog`)?.scrollTo).toEqual({ x: 0, y: 900 });

  // Not yet: it has not said it is there.
  act(() => jest.advanceTimersByTime(1000));
  expect(shown()[0]).toEqual({ url: `${ADDRESS}/`, front: true });

  act(() => mockFrames.get(`${ADDRESS}/blog`)?.onStatusChange?.("live"));
  act(() => jest.advanceTimersByTime(200));
  expect(shown()).toContainEqual({ url: `${ADDRESS}/blog`, front: true });
  // The old one stays under it until the fade is done, then goes.
  act(() => jest.advanceTimersByTime(400));
  expect(shown()).toEqual([{ url: `${ADDRESS}/blog`, front: true }]);
});

test("only the page in front picks and reports its status", () => {
  const { build } = setup();
  act(() =>
    mockFrames.get(`${ADDRESS}/`)?.onLocation?.({
      path: "/about",
      scrollX: 0,
      scrollY: 0,
    }),
  );
  build("b2");
  expect(mockFrames.get(`${ADDRESS}/`)?.onPickElement).toBeDefined();
  const behind = mockFrames.get(`${ADDRESS}/about`);
  expect(behind).toBeDefined();
  expect(behind?.onPickElement).toBeUndefined();
  expect(behind?.onPageReader).toBeUndefined();
});

test("a quick preview stays one when the page menu goes to another page", () => {
  const statuses: string[] = [];
  const base = {
    address: ADDRESS,
    buildKey: "b1",
    reloadKey: 0,
    origin: ADDRESS,
    elementPicking: null,
    onPickElement: () => {},
    onElementPickingStopped: () => {},
    enableKey: 0,
    onStatusChange: (status: string) => statuses.push(status),
  };
  const view = render(
    <DesignPreviewFrames {...base} src={`${ADDRESS}/`} quickPreviewId={null} />,
  );
  view.rerender(
    <DesignPreviewFrames {...base} src={`${ADDRESS}/`} quickPreviewId="q1" />,
  );
  act(() =>
    mockFrames.get(`${ADDRESS}/?val_quick=q1`)?.onStatusChange?.("live"),
  );
  act(() => jest.advanceTimersByTime(600));
  view.rerender(
    <DesignPreviewFrames
      {...base}
      src={`${ADDRESS}/about`}
      quickPreviewId="q1"
    />,
  );
  expect(mockFrames.has(`${ADDRESS}/about?val_quick=q1`)).toBe(true);
});
