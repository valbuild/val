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

    const portal = options?.getPortalContainer?.();
    toolbarEl.style.display = "flex";

    const positionToolbar = () => {
      if (!toolbarEl) return;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const selectionCenterX = (start.left + end.left) / 2;
      const selectionTop = Math.min(start.top, end.top);
      const selectionBottom = Math.max(start.bottom, end.bottom);

      // Fallbacks cover the very first render before React has flushed
      // the buttons (offsetWidth/Height would be 0 then).
      const toolbarWidth = toolbarEl.offsetWidth || 220;
      const toolbarHeight = toolbarEl.offsetHeight || 36;

      const margin = 8;
      const gap = 8;

      let leftViewport = selectionCenterX - toolbarWidth / 2;
      let topViewport = selectionTop - toolbarHeight - gap;

      // Flip below the selection if there's no room above.
      if (topViewport < margin) {
        topViewport = selectionBottom + gap;
      }

      // Clamp horizontally so the toolbar stays inside the viewport.
      const maxLeft = window.innerWidth - toolbarWidth - margin;
      leftViewport = Math.max(margin, Math.min(leftViewport, maxLeft));

      if (portal) {
        toolbarEl.style.left = `${leftViewport}px`;
        toolbarEl.style.top = `${topViewport}px`;
      } else {
        const parentRect = view.dom.parentElement?.getBoundingClientRect();
        if (!parentRect) return;
        toolbarEl.style.left = `${leftViewport - parentRect.left}px`;
        toolbarEl.style.top = `${topViewport - parentRect.top}px`;
      }
    };

    positionToolbar();
    // Re-position after React commits, so the very first show uses real
    // toolbar dimensions instead of the fallback estimate.
    requestAnimationFrame(positionToolbar);
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
