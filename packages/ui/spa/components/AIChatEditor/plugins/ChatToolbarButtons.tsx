import { useState } from "react";
import type { EditorView } from "prosemirror-view";
import type { MarkType, NodeType, Schema } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import {
  Bold,
  Italic,
  Strikethrough,
  Code as CodeIcon,
  List,
  ListOrdered,
  Quote,
  Image as ImageIcon,
  ChevronDown,
} from "lucide-react";
import classNames from "classnames";
import { insertImageWithUpload } from "./imageNodeView";

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function isListActive(state: EditorState, listType: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listType) return true;
  }
  return false;
}

function toggleList(view: EditorView, listType: NodeType, schema: Schema) {
  const { state, dispatch } = view;
  if (isListActive(state, listType)) {
    return liftListItem(schema.nodes.list_item)(state, dispatch);
  }
  return wrapInList(listType)(state, dispatch);
}

function currentHeadingLevel(state: EditorState): 1 | 2 | 3 | null {
  const { $from } = state.selection;
  if ($from.parent.type.name === "heading") {
    const level = $from.parent.attrs.level as number;
    if (level === 1 || level === 2 || level === 3) return level;
  }
  return null;
}

function ToolbarIconButton({
  active,
  onMouseDown,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={onMouseDown}
      className={classNames(
        "flex h-7 w-7 items-center justify-center rounded text-fg-primary",
        "hover:bg-bg-secondary disabled:opacity-50",
        { "bg-bg-secondary": active },
      )}
    >
      {children}
    </button>
  );
}

export function ChatToolbarButtons({
  view,
  schema,
  onUploadAiImage,
}: {
  view: EditorView;
  schema: Schema;
  onUploadAiImage?: (file: File) => Promise<{ key: string }>;
}) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const { state } = view;
  const currentLevel = currentHeadingLevel(state);
  const headingLabel = currentLevel ? `H${currentLevel}` : "P";

  const apply = (cmd: (s: EditorState) => boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    cmd(view.state);
    view.focus();
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          title="Block type"
          onMouseDown={(e) => {
            e.preventDefault();
            setHeadingOpen((v) => !v);
          }}
          className="flex h-7 items-center justify-center gap-1 rounded px-2 text-xs font-medium text-fg-primary hover:bg-bg-secondary"
        >
          {headingLabel}
          <ChevronDown size={12} />
        </button>
        {headingOpen && (
          <div className="absolute left-0 top-8 z-10 min-w-[8em] rounded-md border border-border-primary bg-bg-primary shadow-md py-1">
            {(["P", "H1", "H2", "H3"] as const).map((label) => (
              <button
                key={label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (label === "P") {
                    setBlockType(schema.nodes.paragraph)(
                      view.state,
                      view.dispatch,
                      view,
                    );
                  } else {
                    const level = parseInt(label[1], 10);
                    setBlockType(schema.nodes.heading, { level })(
                      view.state,
                      view.dispatch,
                      view,
                    );
                  }
                  setHeadingOpen(false);
                  view.focus();
                }}
                className="block w-full px-3 py-1 text-left text-xs hover:bg-bg-secondary"
              >
                {label === "P" ? "Paragraph" : `Heading ${label[1]}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-border-primary" />

      <ToolbarIconButton
        title="Bold (Ctrl+B)"
        active={isMarkActive(state, schema.marks.bold)}
        onMouseDown={apply((s) =>
          toggleMark(schema.marks.bold)(s, view.dispatch),
        )}
      >
        <Bold size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title="Italic (Ctrl+I)"
        active={isMarkActive(state, schema.marks.italic)}
        onMouseDown={apply((s) =>
          toggleMark(schema.marks.italic)(s, view.dispatch),
        )}
      >
        <Italic size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title="Strikethrough (Ctrl+Shift+X)"
        active={isMarkActive(state, schema.marks.strikethrough)}
        onMouseDown={apply((s) =>
          toggleMark(schema.marks.strikethrough)(s, view.dispatch),
        )}
      >
        <Strikethrough size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title="Inline code (Ctrl+E)"
        active={isMarkActive(state, schema.marks.code)}
        onMouseDown={apply((s) =>
          toggleMark(schema.marks.code)(s, view.dispatch),
        )}
      >
        <CodeIcon size={14} />
      </ToolbarIconButton>

      <div className="mx-1 h-5 w-px bg-border-primary" />

      <ToolbarIconButton
        title="Bullet list (Ctrl+Shift+8)"
        active={isListActive(state, schema.nodes.bullet_list)}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleList(view, schema.nodes.bullet_list, schema);
          view.focus();
        }}
      >
        <List size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title="Numbered list (Ctrl+Shift+9)"
        active={isListActive(state, schema.nodes.ordered_list)}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleList(view, schema.nodes.ordered_list, schema);
          view.focus();
        }}
      >
        <ListOrdered size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title="Blockquote (Ctrl+Shift+B)"
        onMouseDown={(e) => {
          e.preventDefault();
          wrapIn(schema.nodes.blockquote)(view.state, view.dispatch);
          view.focus();
        }}
      >
        <Quote size={14} />
      </ToolbarIconButton>

      {onUploadAiImage && (
        <>
          <div className="mx-1 h-5 w-px bg-border-primary" />
          <ToolbarIconButton
            title="Insert image"
            onMouseDown={(e) => {
              e.preventDefault();
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = () => {
                const file = input.files?.[0];
                if (file) {
                  insertImageWithUpload(view, file, onUploadAiImage);
                }
              };
              input.click();
            }}
          >
            <ImageIcon size={14} />
          </ToolbarIconButton>
        </>
      )}
    </>
  );
}
