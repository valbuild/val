import { newFirst } from "./format";
import type { MediaItem } from "./types";

const item = (ref: string, isNew?: boolean): MediaItem => ({
  ref,
  url: ref,
  name: ref,
  folder: "/val/images",
  mimeType: "image/png",
  ...(isNew ? { isNew } : {}),
});

describe("newFirst", () => {
  test("new entries come first, the newest of them first", () => {
    // In record order: an upload is an `add` at the end of the record, so
    // `d` went up after `b`.
    const ordered = newFirst([
      item("a"),
      item("b", true),
      item("c"),
      item("d", true),
    ]);
    expect(ordered.map((entry) => entry.ref)).toEqual(["d", "b", "a", "c"]);
  });

  test("with nothing new, the order is left alone", () => {
    const items = [item("b"), item("a")];
    expect(newFirst(items)).toBe(items);
  });
});
