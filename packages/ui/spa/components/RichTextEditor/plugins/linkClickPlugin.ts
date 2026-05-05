import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import type { EditorLinkCatalogItem } from "../types";
import type { LinkHelper } from "./formattingToolbarShared";

export const linkClickPluginKey = new PluginKey("linkClick");

export interface LinkClickPluginOptions {
  getLinkCatalog?: () => EditorLinkCatalogItem[] | undefined;
  linkHelper: LinkHelper;
}

function findAnchorAncestor(
  node: HTMLElement | null,
  boundary: HTMLElement,
): HTMLAnchorElement | null {
  let el = node;
  while (el && el !== boundary) {
    if (el.nodeName === "A") return el as HTMLAnchorElement;
    el = el.parentElement;
  }
  return null;
}

export function createLinkClickPlugin(
  schema: Schema,
  options: LinkClickPluginOptions,
): Plugin {
  const { linkHelper, getLinkCatalog } = options;

  return new Plugin({
    key: linkClickPluginKey,
    props: {
      handleDOMEvents: {
        dblclick(view, event) {
          const linkType = schema.marks.link;
          if (!linkType) return false;

          const anchor = findAnchorAncestor(
            event.target as HTMLElement | null,
            view.dom,
          );
          if (!anchor) return false;

          event.preventDefault();

          const domPos = view.posAtDOM(anchor.firstChild ?? anchor, 0);
          if (domPos < 0) return false;

          const $pos = view.state.doc.resolve(domPos);
          const linkMark =
            linkType.isInSet($pos.marks()) ??
            (($pos.nodeAfter && linkType.isInSet($pos.nodeAfter.marks)) ||
              null);
          if (!linkMark) return false;

          const href = linkMark.attrs.href as string;
          const parentNode = $pos.parent;
          const parentStart = $pos.start($pos.depth);

          let linkStart = domPos;
          let linkEnd = domPos;
          let offset = 0;
          for (let i = 0; i < parentNode.childCount; i++) {
            const child = parentNode.child(i);
            const childMark = child.isText
              ? linkType.isInSet(child.marks)
              : null;
            const matches =
              childMark && (childMark.attrs.href as string) === href;

            if (matches) {
              const absStart = parentStart + offset;
              const absEnd = absStart + child.nodeSize;
              if (absEnd > linkStart && absStart <= domPos) {
                linkStart = absStart;
                linkEnd = absEnd;
                for (let j = i + 1; j < parentNode.childCount; j++) {
                  const next = parentNode.child(j);
                  const nextMark = next.isText
                    ? linkType.isInSet(next.marks)
                    : null;
                  if (!nextMark || (nextMark.attrs.href as string) !== href)
                    break;
                  linkEnd += next.nodeSize;
                }
                break;
              }
            }
            offset += child.nodeSize;
          }

          if (linkStart >= linkEnd) return false;

          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, linkStart, linkEnd),
          );
          view.dispatch(tr);

          const catalog = getLinkCatalog?.();
          if (catalog && catalog.length > 0) {
            linkHelper.showCatalogPicker(view, linkType, catalog);
          } else {
            linkHelper.showUrlEditor(view, linkType);
          }

          return true;
        },
      },
    },
  });
}
