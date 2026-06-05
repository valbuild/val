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
          const items = event.clipboardData?.items;
          if (!items) return false;
          const upload = onUploadAiImageRef.current;
          if (!upload) return false;
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
          return false;
        },
        handleDrop(view, event) {
          const upload = onUploadAiImageRef.current;
          if (!upload) return false;
          const files = (event as DragEvent).dataTransfer?.files;
          if (!files || files.length === 0) return false;
          const file = Array.from(files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (!file) return false;
          event.preventDefault();
          insertImageWithUpload(view, file, upload);
          return true;
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
