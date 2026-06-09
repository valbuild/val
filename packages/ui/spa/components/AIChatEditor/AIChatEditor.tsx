import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useMemo,
  useEffect,
} from "react";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import type { Schema } from "prosemirror-model";
import classNames from "classnames";
import type { SourcePath } from "@valbuild/core";
import { buildChatSchema } from "./schema/buildChatSchema";
import { buildChatKeymap } from "./plugins/keymap";
import { buildChatInputRules } from "./plugins/inputRules";
import { createSubmitOnEnterPlugin } from "./plugins/submitOnEnterPlugin";
import { createChatFloatingToolbarPlugin } from "./plugins/floatingToolbar";
import {
  createChatImageNodeView,
  fetchUrlAsFile,
  insertImageWithUpload,
} from "./plugins/imageNodeView";
import { createFieldRefNodeView } from "./plugins/fieldRefNodeView";
import { serializeChatDocument } from "./serialize/serializeChatDocument";
import { parseChatDocument } from "./serialize/parseChatDocument";
import type { ChatDocument, ChatEditorRef } from "./types";

export interface AIChatEditorProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSubmit?: () => void;
  onChange?: (doc: ChatDocument) => void;
  onUploadAiImage?: (file: File) => Promise<{ key: string }>;
  getPortalContainer?: () => HTMLElement | null;
}

function transformPastedHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<o:p\b[^>]*>[\s\S]*?<\/o:p>/gi, "");
}

// Pull every <img src="..."> URL out of an HTML fragment, skipping any image
// that already carries our `data-val-ai-key` attribute (those are round-trips
// from our own editor and have a valid key already).
function extractImageSrcsFromHtml(html: string | undefined | null): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  );
  const out: string[] = [];
  doc.body.querySelectorAll("img").forEach((img) => {
    if (img.hasAttribute("data-val-ai-key")) return;
    const src = img.getAttribute("src");
    if (src) out.push(src);
  });
  return out;
}

async function uploadHtmlImageSrcs(
  view: EditorView,
  srcs: string[],
  upload: (file: File) => Promise<{ key: string }>,
): Promise<void> {
  for (const src of srcs) {
    const file = await fetchUrlAsFile(src);
    if (!file) {
      console.warn("AI chat: skipped pasted image (fetch failed)", src);
      continue;
    }
    insertImageWithUpload(view, file, upload);
  }
}

export const AIChatEditor = forwardRef<ChatEditorRef | null, AIChatEditorProps>(
  function AIChatEditor(
    {
      placeholder,
      disabled,
      className,
      onSubmit,
      onChange,
      onUploadAiImage,
      getPortalContainer,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const schema = useMemo<Schema>(() => buildChatSchema(), []);

    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onUploadAiImageRef = useRef(onUploadAiImage);
    onUploadAiImageRef.current = onUploadAiImage;
    const disabledRef = useRef<boolean | undefined>(disabled);
    disabledRef.current = disabled;

    useLayoutEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const doc = schema.node("doc", null, [schema.node("paragraph")]);

      const plugins = [
        createSubmitOnEnterPlugin(schema, () => onSubmitRef.current?.()),
        ...buildChatKeymap(schema),
        buildChatInputRules(schema),
        history(),
        dropCursor(),
        gapCursor(),
        createChatFloatingToolbarPlugin(schema, {
          getPortalContainer,
          getUploadAiImage: () => onUploadAiImageRef.current,
        }),
      ];

      const view = new EditorView(container, {
        state: EditorState.create({ doc, schema, plugins }),
        nodeViews: {
          field_ref: createFieldRefNodeView(),
          image: createChatImageNodeView(),
        },
        transformPastedHTML: transformPastedHtml,
        handlePaste(view, event) {
          const upload = onUploadAiImageRef.current;
          if (!upload) return false;
          const items = event.clipboardData?.items;
          if (items) {
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (item.kind === "file" && item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) {
                  insertImageWithUpload(view, file, upload);
                  return true;
                }
              }
            }
          }
          // No binary image in the clipboard. If the HTML payload contains an
          // <img src=...> from a web page, fetch + upload it through the same
          // pipeline so we never leave a stale pending: key in the doc.
          const html = event.clipboardData?.getData("text/html");
          const srcs = extractImageSrcsFromHtml(html);
          if (srcs.length > 0) {
            uploadHtmlImageSrcs(view, srcs, upload);
            return true;
          }
          return false;
        },
        handleDrop(view, event) {
          const upload = onUploadAiImageRef.current;
          if (!upload) return false;
          const dt = (event as DragEvent).dataTransfer;
          const files = dt?.files;
          if (files && files.length > 0) {
            const file = Array.from(files).find((f) =>
              f.type.startsWith("image/"),
            );
            if (file) {
              event.preventDefault();
              insertImageWithUpload(view, file, upload);
              return true;
            }
          }
          const html = dt?.getData("text/html");
          const srcs = extractImageSrcsFromHtml(html);
          if (srcs.length > 0) {
            event.preventDefault();
            uploadHtmlImageSrcs(view, srcs, upload);
            return true;
          }
          return false;
        },
        dispatchTransaction(tr) {
          const next = view.state.apply(tr);
          view.updateState(next);
          if (tr.docChanged) {
            onChangeRef.current?.(serializeChatDocument(next.doc));
          }
        },
        editable: () => !disabledRef.current,
      });

      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, [schema]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.setProps({ editable: () => !disabledRef.current });
    }, [disabled]);

    useImperativeHandle(
      ref,
      (): ChatEditorRef => ({
        getDocument: () => {
          const view = viewRef.current;
          if (!view) return [];
          return serializeChatDocument(view.state.doc);
        },
        setDocument: (newDoc) => {
          const view = viewRef.current;
          if (!view) return;
          const next = parseChatDocument(newDoc, schema);
          const state = EditorState.create({
            doc: next,
            schema,
            plugins: view.state.plugins,
          });
          view.updateState(state);
        },
        clear: () => {
          const view = viewRef.current;
          if (!view) return;
          const next = schema.node("doc", null, [schema.node("paragraph")]);
          const state = EditorState.create({
            doc: next,
            schema,
            plugins: view.state.plugins,
          });
          view.updateState(state);
        },
        focus: () => {
          viewRef.current?.focus();
        },
        isEmpty: () => {
          const view = viewRef.current;
          if (!view) return true;
          const doc = view.state.doc;
          if (doc.childCount === 0) return true;
          if (doc.childCount > 1) return false;
          const only = doc.firstChild;
          if (!only) return true;
          if (only.type.name !== "paragraph") return false;
          return only.content.size === 0;
        },
        insertFieldRef: (path: SourcePath) => {
          const view = viewRef.current;
          if (!view) return;
          const fieldType = schema.nodes.field_ref;
          const node = fieldType.create({ path });
          const docSize = view.state.doc.content.size;
          const last = view.state.doc.lastChild;
          const tr = view.state.tr;
          if (last && last.type.name === "paragraph") {
            const insertPos = docSize - 1;
            tr.insert(insertPos, node);
            tr.insertText(" ", insertPos + node.nodeSize);
          } else {
            const para = schema.node("paragraph", null, [node]);
            tr.insert(docSize, para);
          }
          view.dispatch(tr.scrollIntoView());
          view.focus();
        },
      }),
      [schema],
    );

    return (
      <div
        className={classNames(
          "val-chat-editor relative flex flex-col cursor-text",
          className,
          {
            "opacity-60 cursor-not-allowed": disabled,
          },
        )}
        onMouseDown={(e) => {
          // If the user clicks the wrapper (padding/empty area) — not inside
          // the editor DOM itself — focus the editor at the end so the click
          // doesn't feel "dead".
          if (disabled) return;
          const view = viewRef.current;
          if (!view) return;
          if (
            e.target === e.currentTarget ||
            e.target === containerRef.current
          ) {
            e.preventDefault();
            view.focus();
            const end = view.state.doc.content.size;
            view.dispatch(
              view.state.tr.setSelection(
                Selection.near(view.state.doc.resolve(end)),
              ),
            );
          }
        }}
      >
        <div
          ref={containerRef}
          className={classNames(
            "val-chat-editor-content flex-1 min-h-[2.25rem] outline-none",
            "[&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none",
          )}
          data-placeholder={placeholder || ""}
        />
      </div>
    );
  },
);
