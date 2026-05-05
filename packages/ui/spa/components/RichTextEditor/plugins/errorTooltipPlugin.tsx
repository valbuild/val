import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createRoot, type Root } from "react-dom/client";
import { errorPluginKey } from "./errorPlugin";
import type { EditorError } from "../types";
import { ErrorTooltip } from "./ErrorTooltipComponent";

export const errorTooltipKey = new PluginKey("errorTooltip");

export interface ErrorTooltipCallbacks {
  getPortalContainer?: () => HTMLElement | null;
  onApplyErrorFix?: (args: {
    path: string;
    kind: string;
    fixId: string;
  }) => void;
}

export function createErrorTooltipPlugin(
  callbacks: ErrorTooltipCallbacks,
): Plugin {
  let tooltipContainer: HTMLElement | null = null;
  let reactRoot: Root | null = null;
  let currentErrorPath: string | null = null;
  let hoverHandler: ((e: MouseEvent) => void) | null = null;
  let leaveHandler: ((e: MouseEvent) => void) | null = null;
  let tooltipMouseEnter: (() => void) | null = null;
  let tooltipMouseLeave: (() => void) | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  function cancelHide() {
    if (hideTimeout !== null) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimeout = setTimeout(() => {
      hideTooltip();
      hideTimeout = null;
    }, 150);
  }

  function createContainer(view: EditorView): HTMLElement {
    const portal = callbacks.getPortalContainer?.();
    const el = document.createElement("div");
    el.className = [
      `${portal ? "fixed" : "absolute"} z-50 max-w-xs rounded-md border border-border-error-primary`,
      "bg-bg-primary p-2 shadow-lg",
    ].join(" ");
    el.style.display = "none";
    (portal ?? view.dom.parentElement)?.appendChild(el);
    return el;
  }

  function showTooltip(view: EditorView, error: EditorError, target: Element) {
    if (!tooltipContainer) return;
    cancelHide();

    currentErrorPath = error.path;

    if (!reactRoot) {
      reactRoot = createRoot(tooltipContainer);
    }

    reactRoot.render(
      <ErrorTooltip
        error={error}
        onApplyFix={(args) => {
          callbacks.onApplyErrorFix?.(args);
          hideTooltip();
        }}
      />,
    );

    const targetRect = target.getBoundingClientRect();
    const portal = callbacks.getPortalContainer?.();

    if (portal) {
      tooltipContainer.style.display = "block";
      tooltipContainer.style.left = `${targetRect.left}px`;
      tooltipContainer.style.top = `${targetRect.bottom + 4}px`;
    } else {
      const parentRect = view.dom.parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      tooltipContainer.style.display = "block";
      tooltipContainer.style.left = `${targetRect.left - parentRect.left}px`;
      tooltipContainer.style.top = `${targetRect.bottom - parentRect.top + 4}px`;
    }
  }

  function hideTooltip() {
    cancelHide();
    if (tooltipContainer) {
      tooltipContainer.style.display = "none";
    }
    currentErrorPath = null;
  }

  function findErrorForElement(
    view: EditorView,
    el: Element,
  ): { error: EditorError; target: Element } | null {
    const errorEl = el.closest("[data-error-path]");
    if (!errorEl) return null;

    const errorPath = errorEl.getAttribute("data-error-path");
    if (!errorPath) return null;

    const errorState = errorPluginKey.getState(view.state);
    const errors: EditorError[] = errorState?.errors ?? [];
    const fullError = errors.find((e) => e.path === errorPath);

    if (!fullError) {
      const errorKind = errorEl.getAttribute("data-error-kind") ?? "";
      const message = errorEl.getAttribute("title") ?? "";
      return {
        error: { path: errorPath, kind: errorKind, message },
        target: errorEl,
      };
    }

    return { error: fullError, target: errorEl };
  }

  return new Plugin({
    key: errorTooltipKey,
    view(editorView) {
      tooltipContainer = createContainer(editorView);

      tooltipMouseEnter = () => cancelHide();
      tooltipMouseLeave = () => scheduleHide();
      tooltipContainer.addEventListener("mouseenter", tooltipMouseEnter);
      tooltipContainer.addEventListener("mouseleave", tooltipMouseLeave);

      hoverHandler = (e: MouseEvent) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const result = findErrorForElement(editorView, target);
        if (!result) return;

        if (result.error.path === currentErrorPath) return;
        showTooltip(editorView, result.error, result.target);
      };

      leaveHandler = (e: MouseEvent) => {
        const related = e.relatedTarget;
        if (related instanceof Node && tooltipContainer?.contains(related)) {
          return;
        }
        scheduleHide();
      };

      editorView.dom.addEventListener("mouseover", hoverHandler);
      editorView.dom.addEventListener("mouseout", leaveHandler);

      return {
        update() {},
        destroy() {
          cancelHide();
          if (hoverHandler) {
            editorView.dom.removeEventListener("mouseover", hoverHandler);
          }
          if (leaveHandler) {
            editorView.dom.removeEventListener("mouseout", leaveHandler);
          }
          if (reactRoot) {
            reactRoot.unmount();
            reactRoot = null;
          }
          tooltipContainer?.remove();
          tooltipContainer = null;
          currentErrorPath = null;
        },
      };
    },
  });
}
