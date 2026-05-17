import { useRef, useEffect, useCallback } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { Schema, Node as PMNode } from "prosemirror-model";

export interface DetailsEditorModalProps {
  schema: Schema;
  summaryContent: PMNode[];
  bodyNodes: PMNode[];
  onSave: (summaryContent: PMNode[], bodyNodes: PMNode[]) => void;
  onCancel: () => void;
}

function MiniEditor({
  schema,
  initialDoc,
  viewRef,
  label,
  minHeight,
  allowEnter = true,
}: {
  schema: Schema;
  initialDoc: PMNode;
  viewRef: React.MutableRefObject<EditorView | null>;
  label: string;
  minHeight: string;
  allowEnter?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const blockEnter = () => true;
    const plugins = allowEnter
      ? [keymap(baseKeymap), history()]
      : [
          keymap({ Enter: blockEnter, "Shift-Enter": blockEnter }),
          keymap(baseKeymap),
          history(),
        ];
    const state = EditorState.create({ doc: initialDoc, plugins });
    const view = new EditorView(containerRef.current, {
      state,
      editable: () => true,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [schema, initialDoc, viewRef, allowEnter]);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <div
        ref={containerRef}
        className={[
          "prose-editor overflow-y-auto rounded-md",
          "border border-border-primary bg-bg-primary p-2",
          "text-fg-primary caret-fg-primary",
          "focus-within:ring-2 focus-within:ring-border-brand-primary",
        ].join(" ")}
        style={{ minHeight }}
      />
    </div>
  );
}

export function DetailsEditorModal({
  schema,
  summaryContent,
  bodyNodes,
  onSave,
  onCancel,
}: DetailsEditorModalProps) {
  const summaryViewRef = useRef<EditorView | null>(null);
  const bodyViewRef = useRef<EditorView | null>(null);

  const summaryDoc = schema.node("doc", null, [
    schema.node("paragraph", null, summaryContent),
  ]);

  const bodyContent =
    bodyNodes.length > 0 ? bodyNodes : [schema.node("paragraph")];
  const bodyDoc = schema.node("doc", null, bodyContent);

  const handleSave = useCallback(() => {
    const sView = summaryViewRef.current;
    const bView = bodyViewRef.current;
    if (!sView || !bView) return;

    const summaryInlines: PMNode[] = [];
    const firstParagraph = sView.state.doc.firstChild;
    if (firstParagraph) {
      firstParagraph.forEach((child) => summaryInlines.push(child));
    }

    const bodies: PMNode[] = [];
    bView.state.doc.forEach((child) => bodies.push(child));

    onSave(summaryInlines, bodies);
  }, [onSave]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={handleBackdropClick}
    >
      <div
        className={[
          "flex w-full max-w-2xl flex-col rounded-lg border border-border-primary",
          "bg-bg-primary shadow-2xl",
        ].join(" ")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-primary px-4 py-3">
          <h2 className="text-sm font-semibold text-fg-primary">
            Edit Details
          </h2>
          <button
            type="button"
            className="rounded p-1 text-fg-secondary hover:bg-bg-secondary-hover"
            onClick={onCancel}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          <MiniEditor
            schema={schema}
            initialDoc={summaryDoc}
            viewRef={summaryViewRef}
            label="Summary"
            minHeight="40px"
            allowEnter={false}
          />
          <MiniEditor
            schema={schema}
            initialDoc={bodyDoc}
            viewRef={bodyViewRef}
            label="Hidden content"
            minHeight="120px"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border-primary px-4 py-3">
          <button
            type="button"
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium",
              "text-fg-secondary hover:bg-bg-secondary-hover",
            ].join(" ")}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-bg-brand-primary text-fg-brand-primary",
              "hover:opacity-90",
            ].join(" ")}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
