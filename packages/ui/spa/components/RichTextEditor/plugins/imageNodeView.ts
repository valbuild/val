import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useState, useRef } from "react";
import type { ImageSelectRenderer } from "../types";
import { nodeViewPosToJsonPath } from "../pmPosToJsonPath";

export interface ImageNodeViewOptions {
  inline?: boolean;
  getPortalContainer?: () => HTMLElement | null;
  getUrl?: () => ((filePath: string) => string) | undefined;
  getOnImageUpload?: () =>
    | ((file: File, insertIntoView: (ref: string, opts?: { previewUrl?: string; width?: number; height?: number; mimeType?: string }) => string[] | null) => Promise<{ filePath: string; ref: string } | null>)
    | undefined;
  getImageAccept?: () => string | undefined;
}

function ImageNodeUploadButton({
  onUpload,
  accept,
}: {
  onUpload: (file: File) => Promise<{ filePath: string; ref: string } | null>;
  accept: string;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return createElement("div", { style: { marginTop: "6px" } },
    createElement("input", {
      ref: inputRef,
      type: "file",
      accept,
      hidden: true,
      onChange: (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.currentTarget.files?.[0];
        if (!file) return;
        setUploading(true);
        onUpload(file).finally(() => setUploading(false));
        ev.target.value = "";
      },
    }),
    createElement(
      "button",
      {
        type: "button",
        disabled: uploading,
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
          width: "100%",
          padding: "4px 8px",
          fontSize: "12px",
          borderRadius: "4px",
          border: "1px solid var(--border-primary, #ccc)",
          background: "var(--bg-secondary, #f5f5f5)",
          cursor: uploading ? "wait" : "pointer",
          opacity: uploading ? 0.6 : 1,
        },
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          inputRef.current?.click();
        },
      },
      uploading ? "Uploading..." : "Upload image",
    ),
  );
}

export function createImageNodeView(
  rendererRef: React.RefObject<ImageSelectRenderer | undefined>,
  options?: ImageNodeViewOptions,
) {
  const inline = options?.inline ?? false;
  const resolveUrl = (filePath: string): string => {
    const fn = options?.getUrl?.();
    return fn ? fn(filePath) : filePath;
  };

  return (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => {
    const dom = document.createElement(inline ? "span" : "figure");
    if (!inline) {
      dom.style.margin = "0.5em 0";
      dom.style.position = "relative";
    } else {
      dom.style.position = "relative";
      dom.style.display = "inline-block";
    }

    const img = document.createElement("img");
    img.src = (node.attrs.previewUrl as string) || resolveUrl(node.attrs.src as string);
    if (node.attrs.alt) img.alt = node.attrs.alt;
    img.style.maxWidth = "100%";
    img.style.cursor = "pointer";
    if (!inline) {
      img.style.display = "block";
      img.style.borderRadius = "var(--radius, 0.25rem)";
    }
    dom.appendChild(img);

    if (!inline && node.attrs.caption) {
      const figcaption = document.createElement("figcaption");
      figcaption.textContent = node.attrs.caption;
      figcaption.style.fontSize = "0.85em";
      figcaption.style.color = "var(--fg-secondary-alt)";
      figcaption.style.marginTop = "0.3em";
      figcaption.style.textAlign = "center";
      dom.appendChild(figcaption);
    }

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

    function openOverlay() {
      const renderer = rendererRef.current;
      const onImageUpload = options?.getOnImageUpload?.();
      if (!renderer && !onImageUpload) return;

      closeOverlay();
      isOpen = true;

      overlayContainer = document.createElement("div");
      overlayContainer.style.minWidth = "200px";

      overlayContainer.addEventListener("mousedown", (e) => {
        e.stopPropagation();
      });

      const portal = options?.getPortalContainer?.();
      if (portal) {
        overlayContainer.className = [
          "fixed z-50 rounded-md border border-border-primary",
          "bg-bg-primary p-2 shadow-lg",
        ].join(" ");
        const imgRect = img.getBoundingClientRect();
        overlayContainer.style.left = `${imgRect.left}px`;
        overlayContainer.style.top = `${imgRect.bottom + 4}px`;
        portal.appendChild(overlayContainer);
      } else {
        overlayContainer.className = [
          "absolute z-50 rounded-md border border-border-primary",
          "bg-bg-primary p-2 shadow-lg",
        ].join(" ");
        overlayContainer.style.left = "0";
        overlayContainer.style.top = `${img.offsetHeight + 4}px`;
        dom.appendChild(overlayContainer);
      }

      const currentSrc = node.attrs.src as string;

      function onSelect(newSrc: string): string[] | null {
        const pos = getPos();
        if (pos === undefined) return null;

        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: newSrc,
        });
        view.dispatch(tr);

        closeOverlay();
        view.focus();

        const jsonPath = nodeViewPosToJsonPath(view.state.doc, pos);
        return jsonPath ? [...jsonPath, "src"] : null;
      }

      reactRoot = createRoot(overlayContainer);

      const children: React.ReactNode[] = [];
      if (renderer) {
        children.push(createElement(() => renderer(currentSrc, onSelect)));
      }
      if (onImageUpload) {
        const uploadHandler = onImageUpload;
        const accept = options?.getImageAccept?.() ?? "image/*";
        children.push(
          createElement(ImageNodeUploadButton, {
            key: "upload",
            accept,
            onUpload: async (file: File) => {
              const result = await uploadHandler(file, onSelect);
              return result;
            },
          }),
        );
      }
      reactRoot.render(
        createElement("div", null, ...children),
      );

      dismissHandler = (e: MouseEvent) => {
        if (
          overlayContainer &&
          !overlayContainer.contains(e.target as Node) &&
          !img.contains(e.target as Node)
        ) {
          closeOverlay();
        }
      };
      setTimeout(
        () => document.addEventListener("mousedown", dismissHandler!, true),
        0,
      );
    }

    img.addEventListener("mousedown", (e) => {
      if (!rendererRef.current && !options?.getOnImageUpload?.()) return;
      e.preventDefault();
      e.stopPropagation();

      if (isOpen) {
        closeOverlay();
      } else {
        openOverlay();
      }
    });

    return {
      dom,
      stopEvent: () => false,

      update(updatedNode: PMNode) {
        if (updatedNode.type !== node.type) return false;
        node = updatedNode;
        img.src = (node.attrs.previewUrl as string) || resolveUrl(node.attrs.src as string);
        if (node.attrs.alt) {
          img.alt = node.attrs.alt;
        } else {
          img.removeAttribute("alt");
        }
        return true;
      },

      destroy() {
        closeOverlay();
      },
    };
  };
}
