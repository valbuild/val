import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { EditorButtonVariant } from "../types";
import { ButtonVariantPicker } from "./ButtonVariantPickerComponent";

const BUTTON_BASE_CLASS = [
  "inline-flex items-center rounded px-2 py-0.5 text-sm font-medium",
  "bg-bg-brand-secondary text-fg-brand-secondary cursor-pointer",
].join(" ");

interface ButtonNodeViewRefs {
  variantsRef: React.RefObject<EditorButtonVariant[] | undefined>;
}

export interface ButtonNodeViewOptions {
  getPortalContainer?: () => HTMLElement | null;
}

function createOverlayManager(
  anchorEl: HTMLElement,
  refs: ButtonNodeViewRefs,
  view: EditorView,
  getPos: () => number | undefined,
  getCurrentNode: () => PMNode,
  options?: ButtonNodeViewOptions,
) {
  let overlayContainer: HTMLElement | null = null;
  let reactRoot: Root | null = null;
  let isOpen = false;
  let dismissHandler: ((e: MouseEvent) => void) | null = null;

  function closeOverlay() {
    if (reactRoot) {
      reactRoot.unmount();
      reactRoot = null;
    }
    overlayContainer?.remove();
    overlayContainer = null;
    isOpen = false;
    if (dismissHandler) {
      document.removeEventListener("mousedown", dismissHandler, true);
      dismissHandler = null;
    }
  }

  function positionOverlay(useFixed: boolean) {
    if (!overlayContainer) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    if (useFixed) {
      overlayContainer.style.left = `${anchorRect.left}px`;
      overlayContainer.style.top = `${anchorRect.bottom + 4}px`;
    } else {
      const parent = view.dom.parentElement;
      const parentRect =
        parent?.offsetParent?.getBoundingClientRect() ??
        parent?.parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      overlayContainer.style.left = `${anchorRect.left - parentRect.left}px`;
      overlayContainer.style.top = `${anchorRect.bottom - parentRect.top + 4}px`;
    }
  }

  function openOverlay() {
    const variants = refs.variantsRef.current;
    if (!variants || variants.length === 0) return;

    const parent = view.dom.parentElement;
    if (!parent) return;

    closeOverlay();
    isOpen = true;

    overlayContainer = document.createElement("div");
    overlayContainer.style.minWidth = "180px";

    overlayContainer.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    const portal = options?.getPortalContainer?.();
    const useFixed = !!portal;
    overlayContainer.className = [
      `${useFixed ? "fixed" : "absolute"} z-[60] rounded-md border border-border-primary`,
      "bg-bg-primary p-1 shadow-lg",
    ].join(" ");
    const mountTarget = portal ?? parent;
    mountTarget.appendChild(overlayContainer);
    positionOverlay(useFixed);

    const currentNode = getCurrentNode();
    const currentVariant = currentNode.attrs.variant as string;
    const currentHref = (currentNode.attrs.href as string | null) ?? null;

    function onSelectVariant(variantId: string, href?: string) {
      const pos = getPos();
      if (pos === undefined) return;

      const variantConfig = refs.variantsRef.current?.find(
        (v) => v.variant === variantId,
      );
      if (!variantConfig) return;

      const { schema } = view.state;
      const isAtom = variantConfig.children === false;
      const nodeType = isAtom
        ? schema.nodes.button_atom
        : schema.nodes.button_editable;
      if (!nodeType) return;

      const attrs: Record<string, unknown> = { variant: variantId };
      if (!isAtom) {
        attrs.href = href ? href : null;
      }

      const currentNode = getCurrentNode();
      const oldIsAtom = currentNode.type.name === "button_atom";

      if (isAtom === oldIsAtom) {
        const tr = view.state.tr.setNodeMarkup(pos, undefined, attrs);
        view.dispatch(tr);
      } else {
        const newNode = isAtom
          ? nodeType.create(attrs)
          : nodeType.create(
              attrs,
              variantConfig.label ? [schema.text(variantConfig.label)] : [],
            );
        const tr = view.state.tr.replaceWith(
          pos,
          pos + currentNode.nodeSize,
          newNode,
        );
        view.dispatch(tr);
      }

      closeOverlay();
      view.focus();
    }

    reactRoot = createRoot(overlayContainer);
    reactRoot.render(
      createElement(ButtonVariantPicker, {
        variants,
        currentVariant,
        currentHref,
        onSelectVariant,
        onClose: () => {
          closeOverlay();
          view.focus();
        },
      }),
    );

    dismissHandler = (e: MouseEvent) => {
      if (
        overlayContainer &&
        !overlayContainer.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        closeOverlay();
      }
    };
    setTimeout(
      () => document.addEventListener("mousedown", dismissHandler!, true),
      0,
    );
  }

  function toggle() {
    if (isOpen) {
      closeOverlay();
    } else {
      openOverlay();
    }
  }

  return { toggle, closeOverlay, isOpen: () => isOpen };
}

export function createButtonAtomNodeView(
  variantsRef: React.RefObject<EditorButtonVariant[] | undefined>,
  options?: ButtonNodeViewOptions,
) {
  return (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => {
    const wrapper = document.createElement("span");
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";

    const dom = document.createElement("button");
    dom.setAttribute("type", "button");
    dom.className = `${BUTTON_BASE_CLASS} cursor-default`;
    dom.contentEditable = "false";

    let currentNode = node;
    const variant = node.attrs.variant as string;
    dom.setAttribute("data-variant", variant);
    dom.setAttribute("data-atom", "true");

    const label =
      variantsRef.current?.find((v) => v.variant === variant)?.label ?? variant;
    dom.textContent = label;

    wrapper.appendChild(dom);

    const overlay = createOverlayManager(
      dom,
      { variantsRef },
      view,
      getPos,
      () => currentNode,
      options,
    );

    dom.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.toggle();
    });

    return {
      dom: wrapper,
      stopEvent: () => true,

      update(updatedNode: PMNode) {
        if (updatedNode.type.name !== "button_atom") return false;
        currentNode = updatedNode;
        const newVariant = updatedNode.attrs.variant as string;
        dom.setAttribute("data-variant", newVariant);
        const newLabel =
          variantsRef.current?.find((v) => v.variant === newVariant)?.label ??
          newVariant;
        dom.textContent = newLabel;
        return true;
      },

      destroy() {
        overlay.closeOverlay();
      },
    };
  };
}

export function createButtonEditableNodeView(
  variantsRef: React.RefObject<EditorButtonVariant[] | undefined>,
  options?: ButtonNodeViewOptions,
) {
  return (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => {
    const wrapper = document.createElement("span");
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";

    const dom = document.createElement("button");
    dom.setAttribute("type", "button");
    dom.className = BUTTON_BASE_CLASS;

    let currentNode = node;
    const variant = node.attrs.variant as string;
    dom.setAttribute("data-variant", variant);

    function applyHref(href: string | null) {
      if (href) {
        dom.setAttribute("data-href", href);
        dom.title = href;
      } else {
        dom.removeAttribute("data-href");
        dom.removeAttribute("title");
      }
    }
    applyHref(node.attrs.href as string | null);

    const contentDOM = document.createElement("span");
    dom.appendChild(contentDOM);
    wrapper.appendChild(dom);

    const overlay = createOverlayManager(
      dom,
      { variantsRef },
      view,
      getPos,
      () => currentNode,
      options,
    );

    dom.addEventListener("dblclick", (e) => {
      e.preventDefault();
      overlay.toggle();
    });

    return {
      dom: wrapper,
      contentDOM,

      update(updatedNode: PMNode) {
        if (updatedNode.type.name !== "button_editable") return false;
        currentNode = updatedNode;
        dom.setAttribute("data-variant", updatedNode.attrs.variant as string);
        applyHref(updatedNode.attrs.href as string | null);
        return true;
      },

      destroy() {
        overlay.closeOverlay();
      },
    };
  };
}
