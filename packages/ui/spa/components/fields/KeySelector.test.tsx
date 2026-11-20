/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * The reference dropdown at size: a `keyOf` into a record of 10,000 entries.
 *
 * It rendered every key as an option, open or not (the options were written
 * inline, so a closed dropdown still built them on every render of the field)
 * -- 10,001 options froze the tab for 2.4 s on open, and at 100,000 it did not
 * open. These are its budgets, and the things windowing must not cost:
 * finding a key by searching, reaching one with the keyboard, picking it.
 */
jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: () => ({ status: "loading" }),
  useShallowSourceAtPath: () => ({ status: "loading" }),
  usePreviewAtPath: () => undefined,
  useAddPatch: () => ({}),
  useFilePatchIds: () => new Map(),
}));
jest.mock("../ValPortalProvider", () => ({
  __esModule: true,
  useValPortal: () => null,
}));
jest.mock("../../components/ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock("../AnyField", () => ({
  __esModule: true,
  AnyField: () => null,
}));
jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => null,
  PreviewNull: () => null,
}));

import { KeySelector } from "./KeyOfField";

const KEYS = Array.from({ length: 10_000 }, (_, i) => `post-${i}`);
/** The list's own height, and an option's: what a browser would measure. */
const VIEWPORT = 300;
const OPTION = 36;

let restore: (() => void)[] = [];
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
  // jsdom lays nothing out, so the window is measured from these: the list
  // scrolls in a 300px box, and an option is 36px tall.
  const offsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute("role") === "option") return OPTION;
      if (this.className.includes("overflow-y-auto")) return VIEWPORT;
      return 0;
    },
  });
  // How far it can scroll: what the virtualizer clamps a scroll to.
  const scrollHeight = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollHeight",
  );
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return this.className.includes("overflow-y-auto") ? 10_000 * OPTION : 0;
    },
  });
  // Scrolling, as a browser does it: the offset moves, and says so.
  const scrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (
    this: Element,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options === "object" && typeof options.top === "number") {
      // jsdom's own `scrollTop` is always 0.
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        value: options.top,
      });
      // After the call returns, as a browser's scroll event is.
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    }
  } as Element["scrollTo"];
  restore = [
    () => {
      if (offsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          offsetHeight,
        );
      }
      Element.prototype.scrollTo = scrollTo;
      if (scrollHeight) {
        Object.defineProperty(Element.prototype, "scrollHeight", scrollHeight);
      }
    },
  ];
});
afterEach(() => {
  restore.forEach((undo) => undo());
});

function mount(props: Partial<React.ComponentProps<typeof KeySelector>> = {}): {
  onChange: jest.Mock;
} {
  const onChange = jest.fn();
  render(
    <KeySelector keys={KEYS} value={null} onChange={onChange} {...props} />,
  );
  return { onChange };
}

function open() {
  fireEvent.click(screen.getByRole("combobox"));
}

function search(): HTMLElement {
  return screen.getByPlaceholderText("Search key...");
}

function activeOption(): HTMLElement | null {
  const id = search().getAttribute("aria-activedescendant");
  return id === null ? null : document.getElementById(id);
}

describe("KeySelector with 10,000 keys", () => {
  it("renders no option while it is closed", () => {
    mount();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("renders the options on screen, not every key", () => {
    mount();
    open();
    const options = screen.getAllByRole("option");
    // The window (300 / 36, so 9) and the overscan on each side.
    expect(options.length).toBeGreaterThanOrEqual(VIEWPORT / OPTION);
    expect(options.length).toBeLessThanOrEqual(
      Math.ceil(VIEWPORT / OPTION) + 2 * 8,
    );
    // ...and says how many there are, for a screen reader.
    expect(options[0].getAttribute("aria-setsize")).toBe("10000");
  });

  it("finds a key far down the list by searching", async () => {
    const { onChange } = mount();
    open();
    await act(async () => {
      fireEvent.change(search(), { target: { value: "post-9999" } });
    });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "post-9999",
    ]);
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("post-9999");
  });

  it("reaches the last key with the keyboard, and picks it", async () => {
    const { onChange } = mount();
    open();
    expect(activeOption()?.textContent).toBe("post-0");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(activeOption()?.textContent).toBe("post-2");

    await act(async () => {
      fireEvent.keyDown(search(), { key: "End" });
    });
    // Scrolled to, so it is rendered: the active option is always an element.
    expect(activeOption()?.textContent).toBe("post-9999");
    expect(screen.getAllByRole("option").length).toBeLessThan(40);
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("post-9999");
  });

  it("opens on the value, however far down it is", async () => {
    mount({ value: "post-7000" });
    await act(async () => open());
    expect(activeOption()?.textContent).toBe("post-7000");
  });

  it("keeps the create option at hand, whatever the search", async () => {
    const onCreate = jest.fn();
    mount({ onCreate });
    open();
    await act(async () => {
      fireEvent.change(search(), { target: { value: "no such key" } });
    });
    expect(screen.getByText("No keys found.")).toBeDefined();
    // The only thing left to choose, so it is the active one.
    expect(activeOption()?.textContent).toBe("New entry");
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(screen.getByPlaceholderText("Key")).toBeDefined();
  });
});
