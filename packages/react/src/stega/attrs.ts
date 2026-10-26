import { Internal, Json, Val } from "@valbuild/core";
import { ValEncodedString } from "./stegaEncode";
import { stegaDecodeStrings } from "./stegaDecodeStrings";

export type ValAttrs = { "data-val-path"?: string };

/**
 * The `data-val-path` an element needs so the Studio can find, outline and
 * open what it shows -- for an element Val does not tag by itself.
 *
 * `attrs(page)` is every path inside `page`. `attrs(post, "author")` is the
 * one field: for an element that shows a value that is not text -- a
 * `s.keyOf` key, a date, a colour -- which is never stega encoded, so nothing
 * on the page says where it came from. A byline that shows the author a post
 * points at is the post's `author` field, and a click on it should open that.
 */
export function attrs(target: unknown): ValAttrs;
export function attrs<T extends object>(
  target: T,
  field: keyof T & string,
): ValAttrs;
export function attrs(target: unknown, field?: string): ValAttrs {
  if (field !== undefined) {
    const path =
      typeof target === "object" && target !== null
        ? Internal.createValPathOfItem(
            Internal.getValPath(target as Val<Json>),
            field,
          )
        : undefined;
    return path ? { "data-val-path": path } : {};
  }
  const allPaths: Set<string> = new Set();
  function addPath(target: unknown) {
    if (typeof target === "string") {
      const paths = stegaDecodeStrings(target as ValEncodedString);
      if (paths) {
        for (const path of paths) {
          allPaths.add(path);
        }
      }
    }
    if (typeof target === "object" && target !== null) {
      const path = Internal.getValPath(target as Val<Json>);
      if (path) {
        allPaths.add(path);
      }
      Object.values(target).forEach(addPath);
    }
  }
  addPath(target);
  if (allPaths.size === 0) {
    return {};
  }
  return {
    "data-val-path": Array.from(allPaths).join(","),
  };
}
