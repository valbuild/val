import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { type ResolvedEditorFeatures, HEADING_FEATURE_KEYS } from "../types";

export const gutterPluginKey = new PluginKey("gutter");

export interface GutterPluginOptions {
  getPortalContainer?: () => HTMLElement | null;
}

export function createGutterPlugin(
  schema: Schema,
  features?: ResolvedEditorFeatures,
  options?: GutterPluginOptions,
): Plugin {
  let gutterEl: HTMLElement | null = null;
  let menuEl: HTMLElement | null = null;

  function createGutter(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "absolute left-0 top-0 w-8 pointer-events-none";
    el.style.height = "100%";
    view.dom.parentElement?.appendChild(el);
    return el;
  }

  function createMenu(useFixed: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = [
      `${useFixed ? "fixed" : "absolute"} z-50 flex flex-col rounded-md border border-border-primary`,
      "bg-bg-primary p-1 shadow-lg text-sm min-w-[140px]",
    ].join(" ");
    el.style.display = "none";
    return el;
  }

  /**
   * Find the absolute position right after a top-level block at the given
   * doc-content index.  Computing this at action-time (rather than capturing
   * it during gutter render) avoids stale-position bugs when the document
   * changes between render and click.
   */
  function endOfBlock(doc: PMNode, blockIndex: number): number {
    let pos = 0;
    for (let i = 0; i <= blockIndex; i++) {
      pos += doc.child(i).nodeSize;
    }
    return pos;
  }

  function insertBlockAfter(
    view: EditorView,
    blockIndex: number,
    block: PMNode,
  ) {
    const { doc } = view.state;
    if (blockIndex < 0 || blockIndex >= doc.childCount) return;

    const insertPos = endOfBlock(doc, blockIndex);
    const tr = view.state.tr.insert(insertPos, block);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1), 1));
    view.dispatch(tr);
    view.focus();
  }

  function getBlockTypes(
    schema: Schema,
    blockIndex: number,
  ): { label: string; action: (view: EditorView) => void }[] {
    const types: { label: string; action: (view: EditorView) => void }[] = [];

    types.push({
      label: "Paragraph",
      action: (view) => {
        insertBlockAfter(view, blockIndex, schema.nodes.paragraph.create());
      },
    });

    if (schema.nodes.heading) {
      for (let level = 1; level <= 3; level++) {
        if (!features || features[HEADING_FEATURE_KEYS[level - 1]]) {
          types.push({
            label: `Heading ${level}`,
            action: (view) => {
              insertBlockAfter(
                view,
                blockIndex,
                schema.nodes.heading.create({ level }),
              );
            },
          });
        }
      }
    }

    if (schema.nodes.code_block && (!features || features.codeBlock)) {
      types.push({
        label: "Code Block",
        action: (view) => {
          insertBlockAfter(view, blockIndex, schema.nodes.code_block.create());
        },
      });
    }

    if (
      schema.nodes.details &&
      schema.nodes.details_summary &&
      (!features || features.details)
    ) {
      types.push({
        label: "Details",
        action: (view) => {
          const summaryNode = schema.nodes.details_summary.create(null, []);
          const paragraph = schema.nodes.paragraph.create();
          const detailsNode = schema.nodes.details.create(
            { variant: "details" },
            [summaryNode, paragraph],
          );
          insertBlockAfter(view, blockIndex, detailsNode);
        },
      });
    }

    return types;
  }

  function updateGutter(view: EditorView) {
    if (!gutterEl) return;

    gutterEl.innerHTML = "";
    const parentRect = view.dom.parentElement?.getBoundingClientRect();
    if (!parentRect) return;

    const { doc } = view.state;
    doc.forEach((_node, offset, index) => {
      const coords = view.coordsAtPos(offset + 1);
      const top = coords.top - parentRect.top;

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = [
        "pointer-events-auto absolute left-1 flex h-6 w-6 items-center justify-center",
        "rounded text-fg-secondary-alt opacity-0 transition-opacity hover:opacity-100",
        "hover:bg-bg-secondary-hover",
      ].join(" ");
      handle.style.top = `${top}px`;
      handle.textContent = "+";
      handle.title = "Add block below";

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(view, handle, index);
      });

      gutterEl!.appendChild(handle);
    });
  }

  function showMenu(view: EditorView, anchor: HTMLElement, blockIndex: number) {
    const portal = options?.getPortalContainer?.();
    if (!menuEl) {
      menuEl = createMenu(!!portal);
      (portal ?? view.dom.parentElement)?.appendChild(menuEl);
    }

    menuEl.innerHTML = "";
    const types = getBlockTypes(schema, blockIndex);
    for (const type of types) {
      const item = document.createElement("button");
      item.type = "button";
      item.className =
        "px-3 py-1 text-left text-fg-secondary hover:bg-bg-secondary-hover rounded";
      item.textContent = type.label;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        type.action(view);
        menuEl!.style.display = "none";
      });
      menuEl.appendChild(item);
    }

    const rect = anchor.getBoundingClientRect();

    if (portal) {
      menuEl.style.display = "flex";
      menuEl.style.left = `${rect.right + 4}px`;
      menuEl.style.top = `${rect.top}px`;
    } else {
      const parentRect = view.dom.parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      menuEl.style.display = "flex";
      menuEl.style.left = `${rect.right - parentRect.left + 4}px`;
      menuEl.style.top = `${rect.top - parentRect.top}px`;
    }

    const hideMenu = (ev: MouseEvent) => {
      if (!menuEl?.contains(ev.target as Node)) {
        menuEl!.style.display = "none";
        document.removeEventListener("mousedown", hideMenu);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", hideMenu), 0);
  }

  return new Plugin({
    key: gutterPluginKey,
    view(editorView) {
      gutterEl = createGutter(editorView);
      // ProseMirror only invokes plugin `update` after the first state pass; on
      // initial mount plugin views are created without an update call, so we
      // must populate the gutter here.
      updateGutter(editorView);
      return {
        update: updateGutter,
        destroy() {
          gutterEl?.remove();
          menuEl?.remove();
          gutterEl = null;
          menuEl = null;
        },
      };
    },
  });
}
