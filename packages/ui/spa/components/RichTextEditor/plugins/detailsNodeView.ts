import type { Node as PMNode, Schema } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { DetailsEditorModal } from "./DetailsEditorModal";

function extractSummaryText(node: PMNode): string {
  let text = "";
  node.forEach((child, _offset, index) => {
    if (index === 0 && child.type.name === "details_summary") {
      text = child.textContent;
    }
  });
  return text || "Details";
}

function extractSummaryInlines(node: PMNode): PMNode[] {
  const inlines: PMNode[] = [];
  node.forEach((child, _offset, index) => {
    if (index === 0 && child.type.name === "details_summary") {
      child.forEach((inline) => inlines.push(inline));
    }
  });
  return inlines;
}

function extractBodyNodes(node: PMNode): PMNode[] {
  const bodies: PMNode[] = [];
  let first = true;
  node.forEach((child) => {
    if (first) {
      first = false;
      return;
    }
    bodies.push(child);
  });
  return bodies;
}

export function createDetailsNodeView(schema: Schema) {
  return (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => {
    const variant = node.attrs.variant as string;

    const dom = document.createElement("div");
    dom.className = "details-collapsed group my-1 select-none";
    dom.style.cursor = "pointer";
    if (variant !== "details") {
      dom.setAttribute("data-variant", variant);
    }

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.padding = "4px 6px";
    row.style.borderRadius = "4px";
    row.style.transition = "background 100ms ease";
    row.addEventListener("mouseenter", () => {
      row.style.background = "var(--bg-secondary-hover, #f5f5f5)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "";
    });
    dom.appendChild(row);

    const caret = document.createElement("span");
    caret.textContent = "▶";
    caret.style.fontSize = "0.65em";
    caret.style.color = "var(--fg-secondary-alt, #888)";
    caret.style.userSelect = "none";
    caret.style.flexShrink = "0";
    caret.style.transition = "transform 120ms ease";
    row.appendChild(caret);

    const summaryLabel = document.createElement("span");
    summaryLabel.style.fontSize = "inherit";
    summaryLabel.style.color = "var(--fg-primary, #333)";
    summaryLabel.textContent = extractSummaryText(node);
    row.appendChild(summaryLabel);

    let modalRoot: Root | null = null;
    let modalContainer: HTMLElement | null = null;

    function closeModal() {
      if (modalRoot) {
        modalRoot.unmount();
        modalRoot = null;
      }
      modalContainer?.remove();
      modalContainer = null;
      caret.style.transform = "";
    }

    function openModal() {
      closeModal();
      caret.style.transform = "rotate(90deg)";

      const pos = getPos();
      if (pos === undefined) return;

      const latestNode = view.state.doc.nodeAt(pos);
      if (!latestNode || latestNode.type.name !== "details") return;

      const summaryInlines = extractSummaryInlines(latestNode);
      const bodyNodes = extractBodyNodes(latestNode);

      modalContainer = document.createElement("div");
      document.body.appendChild(modalContainer);

      modalRoot = createRoot(modalContainer);
      modalRoot.render(
        createElement(DetailsEditorModal, {
          schema,
          summaryContent: summaryInlines,
          bodyNodes,
          onSave: (newSummaryContent: PMNode[], newBodyNodes: PMNode[]) => {
            const latestPos = getPos();
            if (latestPos === undefined) return;

            const doc = view.state.doc;
            const detailsNode = doc.nodeAt(latestPos);
            if (!detailsNode || detailsNode.type.name !== "details") return;

            const summaryType = schema.nodes.details_summary;
            const newSummary = summaryType.create(null, newSummaryContent);

            const ensuredBody =
              newBodyNodes.length > 0
                ? newBodyNodes
                : [schema.nodes.paragraph.create()];

            const newDetails = detailsNode.type.create(detailsNode.attrs, [
              newSummary,
              ...ensuredBody,
            ]);

            const tr = view.state.tr.replaceWith(
              latestPos,
              latestPos + detailsNode.nodeSize,
              newDetails,
            );
            view.dispatch(tr);

            closeModal();
            summaryLabel.textContent = newSummary.textContent || "Details";
            view.focus();
          },
          onCancel: () => {
            closeModal();
            view.focus();
          },
        }),
      );
    }

    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    });

    return {
      dom,

      update(updatedNode: PMNode) {
        if (updatedNode.type.name !== "details") return false;
        const newVariant = updatedNode.attrs.variant as string;
        if (newVariant !== "details") {
          dom.setAttribute("data-variant", newVariant);
        } else {
          dom.removeAttribute("data-variant");
        }
        summaryLabel.textContent = extractSummaryText(updatedNode);
        return true;
      },

      stopEvent() {
        return true;
      },

      ignoreMutation() {
        return true;
      },

      destroy() {
        closeModal();
      },
    };
  };
}
