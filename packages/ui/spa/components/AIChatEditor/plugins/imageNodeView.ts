import type { EditorView, NodeView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export function createChatImageNodeView() {
  return function imageNodeView(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView {
    const wrapper = document.createElement("span");
    wrapper.className = "relative inline-block align-baseline mx-0.5";
    wrapper.style.lineHeight = "0";
    wrapper.contentEditable = "false";

    const img = document.createElement("img");
    img.style.maxHeight = "64px";
    img.style.borderRadius = "4px";
    img.style.border = "1px solid var(--border-primary, #ddd)";
    img.style.display = "inline-block";
    img.style.verticalAlign = "baseline";

    const setImgAttrs = (n: PMNode) => {
      img.src = (n.attrs.previewUrl as string | null) ?? "";
      img.alt = (n.attrs.alt as string | null) ?? "";
      img.setAttribute("data-val-ai-key", (n.attrs.key as string) ?? "");
      const isPending = (n.attrs.key as string)?.startsWith("pending:");
      wrapper.style.opacity = isPending ? "0.6" : "1";
    };
    setImgAttrs(node);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remove image");
    removeBtn.className =
      "absolute -top-1 -right-1 rounded-full bg-bg-primary border border-border-primary text-fg-secondary hover:text-fg-primary w-4 h-4 leading-none text-xs flex items-center justify-center";
    removeBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
      view.focus();
    });

    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);

    return {
      dom: wrapper,
      update(updated) {
        if (updated.type !== node.type) return false;
        setImgAttrs(updated);
        return true;
      },
      stopEvent(e) {
        return (e as Event).type === "mousedown";
      },
      ignoreMutation() {
        return true;
      },
      // Note: we intentionally do NOT revoke the blob URL on destroy. Once the
      // user sends the message, the URL is "transferred" to the user bubble in
      // AIChat — clearing the editor must not invalidate it. Blob URLs are
      // released when the page is reloaded.
    };
  };
}

/**
 * Fetch a URL and wrap the response as a File so it can be uploaded via
 * `insertImageWithUpload`. Used by the editor's paste/drop handlers when the
 * payload is HTML containing an `<img src>` instead of a binary file.
 * Returns null on CORS failures, non-2xx responses, or non-image content.
 */
export async function fetchUrlAsFile(
  url: string,
  fallbackName = "pasted-image",
): Promise<File | null> {
  try {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const ext = blob.type.split("/")[1] || "png";
    return new File([blob], `${fallbackName}.${ext}`, { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * Insert an image node with a `pending:` key and trigger an upload. After the
 * upload resolves, update the node attrs in place to carry the real key.
 */
export function insertImageWithUpload(
  view: EditorView,
  file: File,
  uploadAiImage: (file: File) => Promise<{ key: string }>,
): boolean {
  const imageType = view.state.schema.nodes.image;
  if (!imageType) return false;

  const pendingKey = `pending:${crypto.randomUUID()}`;
  const previewUrl = URL.createObjectURL(file);
  const mimeType = file.type || "image/*";

  const node = imageType.create({
    key: pendingKey,
    alt: "",
    previewUrl,
    mimeType,
  });

  const { from } = view.state.selection;
  view.dispatch(view.state.tr.insert(from, node));

  uploadAiImage(file)
    .then(({ key }) => {
      view.state.doc.descendants((n, pos) => {
        if (n.type === imageType && n.attrs.key === pendingKey) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...n.attrs,
            key,
          });
          view.dispatch(tr);
          return false;
        }
        return true;
      });
    })
    .catch((err) => {
      console.error("AI chat image upload failed", err);
      view.state.doc.descendants((n, pos) => {
        if (n.type === imageType && n.attrs.key === pendingKey) {
          view.dispatch(view.state.tr.delete(pos, pos + n.nodeSize));
          return false;
        }
        return true;
      });
    });

  return true;
}
