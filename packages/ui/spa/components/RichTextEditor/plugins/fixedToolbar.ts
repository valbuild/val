import { Plugin, PluginKey } from "prosemirror-state";
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

export const fixedToolbarKey = new PluginKey("fixedToolbar");

export interface FixedToolbarOptions {
  getMount: () => HTMLElement | null;
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

export function createFixedToolbarPlugin(
  schema: Schema,
  options: FixedToolbarOptions,
): Plugin {
  let toolbarEl: HTMLElement | null = null;
  let reactRoot: Root | null = null;
  if (!options.linkHelper) {
    throw new Error("fixedToolbar requires a linkHelper instance");
  }
  const linkHelper = options.linkHelper;

  const renderOptions = {
    showBlockTypeSelect: true,
  };

  function renderToolbar(view: EditorView) {
    if (!reactRoot) return;
    reactRoot.render(
      createElement(ToolbarButtons, {
        view,
        schema,
        features: options.features,
        linkHelper,
        options: renderOptions,
        images: options.getImages?.(),
        imageModuleEntries: options.getImageModuleEntries?.(),
        imageGetUrl: options.getImageGetUrl?.(),
        onImageUpload: options.getOnImageUpload?.(),
        imageAccept: options.getImageAccept?.(),
        uploadProgress: options.getUploadProgress?.() ?? null,
        buttonVariants: options.getButtonVariants?.(),
        detailsVariants: options.getDetailsVariants?.(),
        linkCatalog: options.getLinkCatalog?.(),
        styleConfig: options.styleConfig,
      }),
    );
  }

  return new Plugin({
    key: fixedToolbarKey,
    view(view) {
      const mount = options.getMount();
      if (mount) {
        toolbarEl = document.createElement("div");
        toolbarEl.className =
          "flex flex-row items-center justify-start px-2 py-1 gap-x-1";
        toolbarEl.setAttribute("role", "toolbar");
        toolbarEl.setAttribute("aria-label", "Formatting");
        toolbarEl.addEventListener(
          "mousedown",
          (e) => {
            if ((e.target as HTMLElement).tagName === "SELECT") return;
            e.preventDefault();
          },
          true,
        );

        mount.appendChild(toolbarEl);
        reactRoot = createRoot(toolbarEl);
        renderToolbar(view);
      }
      return {
        update: renderToolbar,
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
