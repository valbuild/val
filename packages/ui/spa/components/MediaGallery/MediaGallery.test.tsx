/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MediaGallery } from "./MediaGallery";
import type { MediaItem } from "./types";
import { validationErrorsByEntry } from "../fields/galleryEntryErrors";
import type { SourcePath } from "@valbuild/core";

/**
 * A library of 10,000 images, as the gallery shows it.
 *
 * It rendered every tile: 10,000 `<img>`, 115 MB of heap and a 105 s scroll,
 * and at 100,000 the tab crashed. These are its budgets -- tiles on screen,
 * not entries in the library -- and the things the window must not cost:
 * picking a tile, finding one by searching, and an entry opened from
 * elsewhere being on screen.
 */
const ITEMS: MediaItem[] = Array.from({ length: 10_000 }, (_, i) => ({
  ref: `/public/val/images/image-${i}.png`,
  url: `/val/images/image-${i}.png`,
  name: `image-${i}.png`,
  folder: "/val/images",
  mimeType: "image/png",
  width: 1200,
  height: 800,
  description: `Image ${i}`,
}));

/** What a browser would measure: a grid 1,000 px wide and 600 px tall. */
const WIDTH = 1_000;
const HEIGHT = 600;
/** 8rem tiles with a 4 px gap in 1,000 px: as `auto-fill` lays them out. */
const COLUMNS = Math.floor((WIDTH + 4) / (128 + 4));
/** A row of square tiles and their names, measured. */
const ROW = Math.round((WIDTH - 4 * (COLUMNS - 1)) / COLUMNS) + 56;
/** A row of the list, measured. */
const LIST_ROW = 48;

let restore: (() => void)[] = [];
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const scrolls = (el: Element) => el.className.includes("overflow-y-auto");
  const props: [object, string, (this: HTMLElement) => number][] = [
    [
      HTMLElement.prototype,
      "offsetHeight",
      function () {
        if (this.getAttribute("role") === "listitem") return LIST_ROW;
        if (this.hasAttribute("data-index")) return ROW;
        return scrolls(this) ? HEIGHT : 0;
      },
    ],
    [
      HTMLElement.prototype,
      "offsetWidth",
      function () {
        return scrolls(this) ? WIDTH : 0;
      },
    ],
    [
      Element.prototype,
      "clientWidth",
      function () {
        return scrolls(this) ? WIDTH : 0;
      },
    ],
    [
      Element.prototype,
      "scrollHeight",
      function () {
        return scrolls(this) ? 1_000_000 : 0;
      },
    ],
  ];
  restore = props.map(([proto, name, get]) => {
    const before = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, get });
    return () => {
      if (before) Object.defineProperty(proto, name, before);
    };
  });
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
      // After the call, as a browser's scroll event is: never while React
      // is rendering, as a microtask could be.
      setTimeout(() => this.dispatchEvent(new Event("scroll")), 0);
    }
  } as Element["scrollTo"];
  restore.push(() => {
    Element.prototype.scrollTo = scrollTo;
  });
});
afterEach(() => {
  restore.forEach((undo) => undo());
});

/** The tiles: pressable, and not the Grid / List switch, which is named. */
function tiles(): HTMLElement[] {
  return screen
    .queryAllByRole("button")
    .filter(
      (button) =>
        button.hasAttribute("aria-pressed") &&
        !button.hasAttribute("aria-label"),
    );
}

/** Rendered, and every scroll that started has landed. */
async function settled(ui: React.ReactElement) {
  await act(async () => {
    render(ui);
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

describe("a gallery of 10,000 images", () => {
  it("renders the tiles on screen, not every entry", async () => {
    await settled(
      <MediaGallery
        kind="images"
        items={ITEMS}
        selectedRef={null}
        onSelect={() => {}}
      />,
    );
    const rendered = tiles().length;
    // The rows that fit, and the overscan of two on each side.
    const rowsOnScreen = Math.ceil(HEIGHT / ROW);
    expect(rendered).toBeGreaterThanOrEqual(rowsOnScreen * COLUMNS);
    expect(rendered).toBeLessThanOrEqual((rowsOnScreen + 4) * COLUMNS);
    // And so the pictures: one per tile on screen.
    expect(document.querySelectorAll("img").length).toBe(rendered);
  });

  it("picks the tile that is clicked", async () => {
    const onSelect = jest.fn();
    await settled(
      <MediaGallery
        kind="images"
        items={ITEMS}
        selectedRef={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("image-3.png"));
    expect(onSelect).toHaveBeenCalledWith("/public/val/images/image-3.png");
  });

  it("finds an entry far down the library by searching", async () => {
    await settled(
      <MediaGallery
        kind="images"
        items={ITEMS}
        selectedRef={null}
        onSelect={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search images…"), {
        target: { value: "image-9999.png" },
      });
    });
    expect(tiles().map((tile) => tile.title)).toEqual(["image-9999.png"]);
  });

  it("has an entry opened from elsewhere on screen", async () => {
    await settled(
      <MediaGallery
        kind="images"
        items={ITEMS}
        selectedRef="/public/val/images/image-9000.png"
        onSelect={() => {}}
        renderInspector={() => null}
      />,
    );
    const selected = tiles().filter(
      (tile) => tile.getAttribute("aria-pressed") === "true",
    );
    expect(selected.map((tile) => tile.title)).toEqual(["image-9000.png"]);
    expect(tiles().length).toBeLessThanOrEqual(
      (Math.ceil(HEIGHT / ROW) + 4) * COLUMNS,
    );
  });

  it("renders the rows of the list on screen, not every entry", async () => {
    await settled(
      <MediaGallery
        kind="images"
        items={ITEMS}
        selectedRef={null}
        onSelect={() => {}}
        defaultView="list"
      />,
    );
    expect(tiles().length).toBeLessThanOrEqual(
      Math.ceil(HEIGHT / LIST_ROW) + 4,
    );
    expect(screen.getByRole("list").getAttribute("role")).toBe("list");
  });
});

describe("validationErrorsByEntry", () => {
  const GALLERY = "/content/images.val.ts" as SourcePath;
  it("files each error under its entry, and its description's apart", () => {
    const byRef = validationErrorsByEntry(GALLERY, {
      '/content/images.val.ts?p="/public/val/a.png"': [{ message: "missing" }],
      '/content/images.val.ts?p="/public/val/a.png"."alt"': [
        { message: "too long" },
      ],
      '/content/images.val.ts?p="/public/val/b.png"."width"': [
        { message: "not a number" },
      ],
      '/content/other.val.ts?p="/public/val/a.png"': [{ message: "elsewhere" }],
    });
    expect(Object.fromEntries(byRef)).toEqual({
      "/public/val/a.png": { entry: ["missing"], description: ["too long"] },
      "/public/val/b.png": { entry: ["not a number"], description: [] },
    });
  });
});
