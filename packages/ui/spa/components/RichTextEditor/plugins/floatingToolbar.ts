import { NodeSelection, Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Schema } from "prosemirror-model";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  EditorImage,
  EditorLinkCatalogItem,
  EditorButtonVariant,
  EditorDetailsVariant,
  EditorStyleConfig,
  ResolvedEditorFeatures,
} from "../types";
import type { LinkHelper } from "./formattingToolbarShared";
import { ToolbarButtons } from "./ToolbarButtonsComponent";

export const floatingToolbarKey = new PluginKey("floatingToolbar");

export interface FloatingToolbarOptions {
  getPortalContainer?: () => HTMLElement | null;
  getLinkCatalog?: () => EditorLinkCatalogItem[] | undefined;
  getImages?: () => EditorImage[] | undefined;
  getImageModuleEntries?: () =>
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined;
  getImageGetUrl?: () => ((filePath: string) => string) | undefined;
  getOnImageUpload?: () =>
    | ((file: File, insertIntoView: (ref: string, opts?: { previewUrl?: string; width?: number; height?: number; mimeType?: string }) => string[] | null) => Promise<{ filePath: string; ref: string } | null>)
    | undefined;
  getImageAccept?: () => string | undefined;
  getUploadProgress?: () => number | null | undefined;
  getButtonVariants?: () => EditorButtonVariant[] | undefined;
  getDetailsVariants?: () => EditorDetailsVariant[] | undefined;
  linkHelper?: LinkHelper;
  styleConfig?: EditorStyleConfig;
  features?: ResolvedEditorFeatures;
}

export function createFloatingToolbarPlugin(
  schema: Schema,
  options?: FloatingToolbarOptions,
): Plugin {
  let toolbarEl: HTMLElement | null = null;
  let reactRoot: Root | null = null;
  if (!options?.linkHelper) {
    throw new Error("floatingToolbar requires a linkHelper instance");
  }
  const linkHelper = options.linkHelper;

  function updateToolbar(view: EditorView) {
    if (!toolbarEl || !reactRoot) return;

    const { selection } = view.state;
    const { empty, from, to } = selection;

    const { $from } = selection;
    const insideEditableButton =
      $from.parent.type.name === "button_editable" ||
      (selection instanceof NodeSelection &&
        selection.node.type.name === "button_editable");

    if (
      empty ||
      insideEditableButton ||
      (!view.hasFocus() && !linkHelper.isPickerOpen())
    ) {
      toolbarEl.style.display = "none";
      if (!linkHelper.isPickerOpen()) {
        linkHelper.closePicker();
      }
      return;
    }

    reactRoot.render(
      createElement(ToolbarButtons, {
        view,
        schema,
        features: options?.features,
        linkHelper,
        images: options?.getImages?.(),
        imageModuleEntries: options?.getImageModuleEntries?.(),
        imageGetUrl: options?.getImageGetUrl?.(),
        onImageUpload: options?.getOnImageUpload?.(),
        imageAccept: options?.getImageAccept?.(),
        uploadProgress: options?.getUploadProgress?.() ?? null,
        buttonVariants: options?.getButtonVariants?.(),
        detailsVariants: options?.getDetailsVariants?.(),
        linkCatalog: options?.getLinkCatalog?.(),
        styleConfig: options?.styleConfig,
      }),
    );

    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    const portal = options?.getPortalContainer?.();
    if (portal) {
      const left = (start.left + end.left) / 2;
      const top = start.top - 40;
      toolbarEl.style.display = "flex";
      toolbarEl.style.left = `${Math.max(0, left - 60)}px`;
      toolbarEl.style.top = `${Math.max(0, top)}px`;
    } else {
      const parentRect = view.dom.parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      const left = (start.left + end.left) / 2 - parentRect.left;
      const top = start.top - parentRect.top - 40;
      toolbarEl.style.display = "flex";
      toolbarEl.style.left = `${Math.max(0, left - 60)}px`;
      toolbarEl.style.top = `${Math.max(0, top)}px`;
    }
  }

  return new Plugin({
    key: floatingToolbarKey,
    view(editorView) {
      toolbarEl = document.createElement("div");
      const portal = options?.getPortalContainer?.();
      toolbarEl.className = [
        `${portal ? "fixed" : "absolute"} z-50 flex items-center gap-x-1 rounded-md border border-border-primary`,
        "bg-bg-primary px-2 py-1 shadow-lg transition-opacity",
      ].join(" ");
      toolbarEl.style.display = "none";
      toolbarEl.setAttribute("role", "toolbar");
      toolbarEl.setAttribute("aria-label", "Formatting (selection)");
      toolbarEl.addEventListener("mousedown", (e) => e.preventDefault(), true);
      (portal ?? editorView.dom.parentElement)?.appendChild(toolbarEl);

      reactRoot = createRoot(toolbarEl);

      return {
        update: updateToolbar,
        destroy() {
          const root = reactRoot;
          reactRoot = null;
          toolbarEl?.remove();
          toolbarEl = null;
          if (root) {
            queueMicrotask(() => root.unmount());
          }
        },
      };
    },
  });
}
