import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorLinkCatalogItem } from "../types";

export const linkCatalogPluginKey = new PluginKey("linkCatalog");

export interface LinkCatalogPluginOptions {
  getLinkCatalog: () => EditorLinkCatalogItem[] | undefined;
}

export function createLinkCatalogPlugin(
  options: LinkCatalogPluginOptions,
): Plugin {
  return new Plugin({
    key: linkCatalogPluginKey,
    appendTransaction(
      transactions: readonly Transaction[],
      _oldState,
      newState,
    ) {
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      const catalog = options.getLinkCatalog();
      if (!catalog || catalog.length === 0) return null;

      const linkType = newState.schema.marks.link;
      if (!linkType) return null;

      const allowedHrefs = new Set(catalog.map((item) => item.href.trim()));
      let tr = newState.tr;
      let changed = false;

      newState.doc.descendants((node, pos) => {
        if (!node.isInline || !node.isText) return;
        const linkMark = linkType.isInSet(node.marks);
        if (!linkMark) return;

        const href = (linkMark.attrs.href as string).trim();
        if (!allowedHrefs.has(href)) {
          tr = tr.removeMark(pos, pos + node.nodeSize, linkType);
          changed = true;
        }
      });

      return changed ? tr : null;
    },
  });
}
