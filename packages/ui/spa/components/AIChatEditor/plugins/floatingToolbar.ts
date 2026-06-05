import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Schema } from "prosemirror-model";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatToolbarButtons } from "./ChatToolbarButtons";

export const chatFloatingToolbarKey = new PluginKey("chatFloatingToolbar");

export interface ChatFloatingToolbarOptions {
  getPortalContainer?: () => HTMLElement | null;
  getUploadAiImage?: () =>
    | ((file: File) => Promise<{ key: string }>)
    | undefined;
}

export function createChatFloatingToolbarPlugin(
  schema: Schema,
  options?: ChatFloatingToolbarOptions,
): Plugin {
  let toolbarEl: HTMLElement | null = null;
  let reactRoot: Root | null = null;

  function updateToolbar(view: EditorView) {
    if (!toolbarEl || !reactRoot) return;
    const { selection } = view.state;
    const { empty, from, to } = selection;
    if (empty || !view.hasFocus()) {
      toolbarEl.style.display = "none";
      return;
    }

    reactRoot.render(
      createElement(ChatToolbarButtons, {
        view,
        schema,
        onUploadAiImage: options?.getUploadAiImage?.(),
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
    key: chatFloatingToolbarKey,
    view(editorView) {
      toolbarEl = document.createElement("div");
      const portal = options?.getPortalContainer?.();
      toolbarEl.className = [
        `${portal ? "fixed" : "absolute"} z-50 flex items-center gap-x-0.5 rounded-md border border-border-primary`,
        "bg-bg-primary px-1 py-1 shadow-lg",
      ].join(" ");
      toolbarEl.style.display = "none";
      toolbarEl.setAttribute("role", "toolbar");
      toolbarEl.setAttribute("aria-label", "Chat formatting (selection)");
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
