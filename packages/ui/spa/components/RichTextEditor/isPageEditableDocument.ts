import type { EditorDocument } from "./types";

/**
 * Whether a value is a richtext document made only of what can be edited on
 * the page: paragraphs, headings, lists, marks, links, line breaks and
 * images (`inlineEditing.ts` in `@valbuild/shared` has the same list, and
 * edits nothing else in place).
 *
 * A check rather than a cast. The document comes back across the frame from
 * the page, as JSON anyone could have written, and it is about to be handed
 * to the editor's parser, which trusts what it is given.
 */
export function isPageEditableDocument(
  value: unknown,
): value is EditorDocument {
  return Array.isArray(value) && value.every(isBlock);
}

const TEXT_BLOCKS: ReadonlySet<unknown> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function childrenOf(value: object): unknown[] | null {
  const children: unknown = Reflect.get(value, "children");
  return Array.isArray(children) ? children : null;
}

function isBlock(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const tag: unknown = Reflect.get(value, "tag");
  const children = childrenOf(value);
  if (children === null) return false;
  if (TEXT_BLOCKS.has(tag)) return children.every(isInline);
  if (tag === "ul" || tag === "ol") return children.every(isListItem);
  return false;
}

function isListItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const children = childrenOf(value);
  return (
    Reflect.get(value, "tag") === "li" &&
    children !== null &&
    children.every(isBlock)
  );
}

function isInline(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  const tag: unknown = Reflect.get(value, "tag");
  if (tag === "br") return true;
  if (tag === "img") {
    const src: unknown = Reflect.get(value, "src");
    return typeof src === "object" && src !== null;
  }
  const children = childrenOf(value);
  if (children === null) return false;
  if (tag === "span") {
    const styles: unknown = Reflect.get(value, "styles");
    return (
      Array.isArray(styles) &&
      styles.every((style) => typeof style === "string") &&
      children.every((child) => typeof child === "string")
    );
  }
  if (tag === "a") {
    return (
      typeof Reflect.get(value, "href") === "string" && children.every(isInline)
    );
  }
  return false;
}
