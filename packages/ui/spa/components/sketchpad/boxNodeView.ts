import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { mediaOf } from "./sketchpadDoc";
import type { SketchMedia } from "@valbuild/shared/internal";

export type BoxViewOptions = {
  /** The icons are the sketch's, and change when the assistant draws one. */
  getIcons: () => Record<string, string>;
  /** Whether a file can be stored here. Where not, a box takes a link. */
  canUpload: () => boolean;
  /** Stores a file and resolves to its URL, or to null when it could not. */
  attach: (file: File) => Promise<SketchMedia | null>;
  /** A file dropped where it cannot be stored: say so. */
  refuseFile: (file: File) => void;
};

const SVG = "http://www.w3.org/2000/svg";

/** Kinds that read as a control, and are drawn as one rather than a box. */
const INLINE_KINDS = new Set(["button", "link", "input"]);
const TALL_KINDS = new Set(["image", "video", "map", "chart", "embed"]);

const BOX =
  "group relative flex flex-col gap-2 rounded-md border border-dashed border-fg-tertiary bg-bg-secondary p-3 text-fg-secondary";
const INLINE =
  "group relative inline-flex max-w-full items-center gap-1.5 self-start rounded-md border border-dashed border-fg-tertiary px-2.5 py-1.5 text-sm text-fg-secondary";
const ACTION =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border-primary bg-bg-primary text-fg-secondary shadow-sm hover:bg-bg-secondary hover:text-fg-primary";

/**
 * A box: its kind and icon, the image or video in it, and its label. The
 * label is the node's content, so the caret moves into it like any other
 * text; everything around it is chrome the editor does not see.
 */
export class BoxView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly header: HTMLElement;
  private readonly icon: SVGSVGElement;
  private readonly kind: HTMLButtonElement;
  private readonly media: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private node: PMNode;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly options: BoxViewOptions,
    private readonly registry: Set<BoxView>,
  ) {
    this.node = node;
    this.dom = document.createElement("div");
    this.header = el("div", "flex items-center gap-1.5");
    this.header.contentEditable = "false";
    this.icon = document.createElementNS(SVG, "svg");
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.75",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "h-3.5 w-3.5 shrink-0",
      "aria-hidden": "true",
    })) {
      this.icon.setAttribute(name, value);
    }
    this.icon.appendChild(document.createElementNS(SVG, "path"));
    this.kind = el(
      "button",
      "cursor-pointer rounded px-0.5 text-[11px] font-medium text-fg-tertiary hover:bg-bg-primary hover:text-fg-primary",
    );
    this.kind.type = "button";
    this.kind.title = "Change what kind of box this is";
    this.kind.addEventListener("click", () => this.editKind());
    this.header.append(this.icon, this.kind);

    this.media = el("div", "");
    this.media.contentEditable = "false";

    this.contentDOM = el(
      "div",
      "relative min-w-[2ch] rounded px-1 text-sm outline-none",
    );

    this.actions = el(
      "div",
      // Always there on a touch screen, which has no hover to show them on.
      "absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
    );
    this.actions.contentEditable = "false";
    this.fileInput = el("input", "hidden");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*,video/*";
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (file) {
        this.attach(file);
      }
    });

    this.dom.addEventListener("dragover", (event) => {
      if (this.view.editable && (hasFiles(event) || hasLink(event))) {
        event.preventDefault();
        event.stopPropagation();
        this.dom.dataset.dropping = "true";
      }
    });
    this.dom.addEventListener("dragleave", () => {
      delete this.dom.dataset.dropping;
    });
    this.dom.addEventListener("drop", (event) => {
      if (!this.view.editable || !(hasFiles(event) || hasLink(event))) {
        return;
      }
      // Ours, not ProseMirror's: it would insert the file's name as text.
      event.preventDefault();
      event.stopPropagation();
      delete this.dom.dataset.dropping;
      // An image dragged from a web page is its link, which lasts: taken as
      // it is, wherever a file could not be stored.
      const link = mediaLink(linkOf(event));
      if (link) {
        this.setAttrs({ mediaType: link.type, mediaSrc: link.src });
        return;
      }
      const file = event.dataTransfer?.files[0];
      if (file) {
        if (this.options.canUpload()) {
          this.attach(file);
        } else {
          this.options.refuseFile(file);
        }
      }
    });

    this.render();
    registry.add(this);
  }

  /** Draws everything but the label, which ProseMirror owns. */
  render() {
    const node = this.node;
    const kind = String(node.attrs.kind);
    const media = mediaOf(node);
    const inline = INLINE_KINDS.has(kind.toLowerCase()) && !media;
    const tall = TALL_KINDS.has(kind.toLowerCase()) && !media;

    this.dom.className = inline
      ? INLINE
      : `${BOX} ${tall ? "aspect-video justify-center" : "min-h-16 justify-center"} data-[dropping=true]:border-solid data-[dropping=true]:border-border-focus data-[dropping=true]:bg-bg-primary`;

    const path = this.options.getIcons()[kind.toLowerCase()];
    this.icon.style.display = path ? "" : "none";
    this.icon.firstElementChild?.setAttribute("d", path ?? "");
    this.kind.textContent = kind;
    this.kind.style.display = inline ? "none" : "";

    this.media.replaceChildren();
    if (media?.type === "image") {
      const img = el("img", "max-h-80 w-full rounded object-cover");
      img.src = media.src;
      img.alt = node.textContent;
      this.media.append(img);
    } else if (media?.type === "video") {
      const video = el("video", "max-h-80 w-full rounded bg-bg-tertiary");
      video.src = media.src;
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      this.media.append(video);
    }

    this.actions.replaceChildren();
    if (this.view.editable && !inline) {
      const upload = this.options.canUpload();
      this.actions.append(
        this.action(
          upload
            ? media
              ? "Replace image or video"
              : "Add image or video"
            : media
              ? "Change the link to the image or video"
              : "Add a link to an image or video",
          IMAGE_PLUS,
          () => (upload ? this.fileInput.click() : this.editLink()),
        ),
      );
      if (media) {
        this.actions.append(
          this.action(`Remove the ${media.type}`, TRASH, () =>
            this.setAttrs({ mediaType: null, mediaSrc: null }),
          ),
        );
      }
      this.actions.append(this.fileInput);
    }

    const parts: Node[] = inline
      ? [this.icon, this.contentDOM]
      : [this.header, this.media, this.contentDOM, this.actions];
    if (inline) {
      this.icon.remove();
    } else if (this.icon.parentNode !== this.header) {
      this.header.prepend(this.icon);
    }
    parts.forEach((part, i) => {
      if (this.dom.childNodes[i] !== part) {
        this.dom.insertBefore(part, this.dom.childNodes[i] ?? null);
      }
    });
    while (this.dom.childNodes.length > parts.length) {
      this.dom.lastChild?.remove();
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    // The chrome's own buttons and the kind field handle their events.
    const target = event.target;
    return (
      target instanceof Node &&
      !this.contentDOM.contains(target) &&
      (this.header.contains(target) ||
        this.actions.contains(target) ||
        this.media.contains(target))
    );
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection" }): boolean {
    if (mutation.type === "selection") {
      return false;
    }
    return !this.contentDOM.contains(mutation.target);
  }

  destroy() {
    this.registry.delete(this);
  }

  private setAttrs(attrs: Record<string, unknown>) {
    const pos = this.getPos();
    if (pos === undefined) {
      return;
    }
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        ...attrs,
      }),
    );
  }

  private attach(file: File) {
    this.options.attach(file).then((media) => {
      if (media) {
        this.setAttrs({ mediaType: media.type, mediaSrc: media.src });
      }
    });
  }

  /** A field for the link, in place of the media, until Enter or Escape. */
  private editLink() {
    if (!this.view.editable) {
      return;
    }
    const field = el("div", "flex flex-col gap-1");
    const input = el(
      "input",
      "w-full rounded border border-border-primary bg-bg-primary px-2 py-1 text-sm text-fg-primary outline-none focus:border-border-focus aria-[invalid=true]:border-border-error",
    );
    input.type = "url";
    input.placeholder = "https://… an image or a video";
    input.value = mediaOf(this.node)?.src ?? "";
    input.setAttribute("aria-label", "Link to an image or video");
    const hint = el("p", "text-xs text-fg-secondary");
    hint.id = `sketch-link-${Math.random().toString(36).slice(2)}`;
    hint.textContent =
      "A link that starts with https://, or a path on the site such as /images/hero.jpg. Enter to add it, Escape to leave it.";
    input.setAttribute("aria-describedby", hint.id);
    field.append(input, hint);

    let done = false;
    const finish = (save: boolean) => {
      if (done) {
        return;
      }
      const value = input.value.trim();
      if (save && value !== "") {
        const link = mediaLink(value);
        if (!link) {
          input.setAttribute("aria-invalid", "true");
          hint.textContent =
            "That is not a link this box can show. It takes a link that starts with https://, or a path on the site that starts with /.";
          hint.className = "text-xs text-fg-error-primary";
          input.focus();
          return;
        }
        done = true;
        field.remove();
        this.setAttrs({ mediaType: link.type, mediaSrc: link.src });
        this.view.focus();
        return;
      }
      done = true;
      field.remove();
      this.render();
      this.view.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
    });
    this.media.replaceChildren(field);
    input.focus();
    input.select();
  }

  private editKind() {
    if (!this.view.editable) {
      return;
    }
    const input = el(
      "input",
      "w-28 rounded border border-border-focus bg-bg-primary px-1 text-[11px] text-fg-primary outline-none",
    );
    input.value = String(this.node.attrs.kind);
    input.setAttribute("aria-label", "Kind of box");
    let done = false;
    const finish = (save: boolean) => {
      if (done) {
        return;
      }
      done = true;
      const kind = input.value.replace(/[[\]:\s]+/g, "-").replace(/^-|-$/g, "");
      input.replaceWith(this.kind);
      if (save && kind && kind !== this.node.attrs.kind) {
        this.setAttrs({ kind });
      }
      this.view.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    this.kind.replaceWith(input);
    input.focus();
    input.select();
  }

  private action(label: string, icon: string, onClick: () => void) {
    const button = el("button", ACTION);
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    const svg = document.createElementNS(SVG, "svg");
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "h-3.5 w-3.5",
    })) {
      svg.setAttribute(name, value);
    }
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", icon);
    svg.append(path);
    button.append(svg);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", onClick);
    return button;
  }
}

// The Studio's own chrome, not a box's icon: lucide's image-plus and trash-2.
const IMAGE_PLUS =
  "M16 5h6 M19 2v6 M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5 M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21 M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z";
const TRASH =
  "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function hasLink(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("text/uri-list");
}

/** The first link in a drop: a uri-list is one per line, `#` lines comments. */
function linkOf(event: DragEvent): string {
  const list = event.dataTransfer?.getData("text/uri-list") ?? "";
  return (
    list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("#")) ?? ""
  );
}

/** A path on the site, or an http(s) address: what every reader can load. */
function isLasting(src: string): boolean {
  if (src.startsWith("/")) {
    return !src.startsWith("//");
  }
  try {
    const { protocol } = new URL(src);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|ogv|m3u8)(?:[?#]|$)/i;

/**
 * The media a link names, if a box can show it: a web address, or a path on
 * the site. Nothing that lives only in this tab -- `blob:`, `data:` -- since
 * the sketch is saved and read elsewhere, where those are dead.
 */
export function mediaLink(value: string): SketchMedia | null {
  const src = value.trim();
  if (src === "") {
    return null;
  }
  if (!isLasting(src)) {
    return null;
  }
  return { type: VIDEO_EXTENSION.test(src) ? "video" : "image", src };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}
