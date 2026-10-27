import { Check, Copy, ImagePlus, Trash2, X } from "lucide-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../designSystem/cn";
import { copyText } from "../../utils/copyText";
import {
  formatPlaceholder,
  formatText,
  parseSketch,
  renderSketchAscii,
  replaceLine,
  type SketchError,
  type SketchNode,
  type SketchPlaceholder,
  type SketchText,
} from "./pageSketch";

export type PageSketchView = "wireframe" | "ascii";

export type PageSketchProps = {
  value: string;
  onChange?: (value: string) => void;
  /** Shown above the editor, e.g. the page's route. */
  title?: string;
  /** Shown beside the title, e.g. who is editing. */
  status?: ReactNode;
  /** True while someone else (the assistant) is writing to the sketch. */
  readOnly?: boolean;
  defaultView?: PageSketchView;
  /**
   * Stores a file put in a box and resolves to the URL the sketch will name
   * it by. That URL is what the assistant reads, so in the Studio it is where
   * the upload landed. Defaults to an object URL, which lives as long as the
   * tab does.
   */
  onAttachMedia?: (file: File) => Promise<string>;
};

/**
 * The theme replaces Tailwind's font families rather than extending them, so
 * `font-mono` is not a class here. The ASCII view and the editor's gutter
 * need one, since both are laid out in characters.
 */
const MONO =
  "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

/** Must match the editor's `leading-5`: the gutter and scroll-to-line use it. */
const LINE_HEIGHT = 20;

type Notice = {
  message: string;
  details?: string;
  retry?: () => void;
};

async function objectUrlOf(file: File): Promise<string> {
  return URL.createObjectURL(file);
}

/**
 * A page sketch: the text on the left, and the page it describes on the
 * right. Both can be edited: type in the text, or click a heading, a
 * paragraph or a box's label on the page and type there; drop an image or a
 * video on a box to put it in. Either way the text is what changes, because
 * the text is what the assistant reads. See `pageSketch.ts` for the format.
 */
export function PageSketch({
  value,
  onChange,
  title,
  status,
  readOnly = false,
  defaultView = "wireframe",
  onAttachMedia,
}: PageSketchProps) {
  const { blocks, icons, errors } = useMemo(() => parseSketch(value), [value]);
  const [view, setView] = useState<PageSketchView>(defaultView);
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [showLayout, setShowLayout] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  // An upload finishes after the person may have typed on; it has to land in
  // the text as it is then, not as it was when the file was dropped.
  const latestValue = useRef(value);
  latestValue.current = value;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  // Where the caret goes once a keystroke we rewrote has been rendered.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor && pendingCaret.current !== null) {
      editor.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const lineCount = value.split("\n").length;
  const errorLines = useMemo(
    () => new Set(errors.map((e) => e.line)),
    [errors],
  );
  const activeLine = hoveredLine ?? caretLine;

  const selectLine = (line: number, focusEditor = true) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const lines = value.split("\n");
    const start = lines
      .slice(0, line - 1)
      .reduce((sum, l) => sum + l.length + 1, 0);
    const indent = lines[line - 1].length - lines[line - 1].trimStart().length;
    if (focusEditor) {
      editor.focus();
    }
    editor.setSelectionRange(start + indent, start + lines[line - 1].length);
    editor.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
    setCaretLine(line);
  };

  const commitLine = (line: number, content: string) => {
    onChange?.(replaceLine(latestValue.current, line, content));
  };

  const attachMedia = async (node: SketchPlaceholder, file: File) => {
    const type = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : null;
    if (type === null) {
      setNotice({
        message: `"${file.name}" is not an image or a video, so it cannot go in a box.`,
      });
      return;
    }
    setNotice(null);
    try {
      const src = await (onAttachMedia ?? objectUrlOf)(file);
      commitLine(
        node.line,
        formatPlaceholder({ ...node, media: { type, src } }),
      );
    } catch (error) {
      setNotice({
        message: `"${file.name}" could not be added. The box is as it was.`,
        details: error instanceof Error ? error.message : undefined,
        retry: () => attachMedia(node, file),
      });
    }
  };

  const sketch: SketchContextValue = {
    icons,
    activeLine,
    showLayout,
    editable: !readOnly && onChange !== undefined,
    onSelectLine: (line) => selectLine(line, false),
    onHoverLine: setHoveredLine,
    onCommitLine: commitLine,
    onAttachMedia: attachMedia,
  };

  const updateCaretLine = () => {
    const editor = editorRef.current;
    if (editor) {
      setCaretLine(value.slice(0, editor.selectionStart).split("\n").length);
    }
  };

  const replaceSelection = (text: string) => {
    const editor = editorRef.current;
    if (!editor || !onChange) {
      return;
    }
    const { selectionStart, selectionEnd } = editor;
    pendingCaret.current = selectionStart + text.length;
    onChange(value.slice(0, selectionStart) + text + value.slice(selectionEnd));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) {
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      replaceSelection("  ");
    } else if (event.key === "Enter" && !event.shiftKey) {
      // Indentation is the structure, so a new line keeps it, and goes one
      // level in after a row or a col.
      event.preventDefault();
      const before = value.slice(0, event.currentTarget.selectionStart);
      const current = before.slice(before.lastIndexOf("\n") + 1);
      const indent = current.slice(
        0,
        current.length - current.trimStart().length,
      );
      const opens = /^(row|col)(\s+\d+)?$/.test(current.trim());
      replaceSelection("\n" + indent + (opens ? "  " : ""));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary text-fg-primary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-primary px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {title ?? "Page sketch"}
          </div>
          {status && (
            <div className="truncate text-xs text-fg-secondary">{status}</div>
          )}
          {notice && (
            <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />
          )}
        </div>
        {view === "wireframe" && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={showLayout}
              onChange={(e) => setShowLayout(e.target.checked)}
            />
            Rows and columns
          </label>
        )}
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-48 flex-col border-border-primary md:w-[42%] md:min-w-64 md:border-r max-md:h-1/2 max-md:border-b">
          <div className="flex min-h-0 flex-1 bg-bg-secondary">
            <div
              ref={gutterRef}
              aria-hidden
              className={`select-none overflow-hidden py-3 ${MONO} text-[13px] leading-5 text-fg-tertiary`}
            >
              {Array.from({ length: lineCount }, (_, i) => i + 1).map(
                (line) => (
                  <div
                    key={line}
                    className={cn(
                      "flex items-center gap-1 pl-2 pr-2 text-right",
                      line === activeLine && "text-fg-primary",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        errorLines.has(line)
                          ? "bg-bg-error-primary"
                          : "bg-transparent",
                      )}
                    />
                    <span className="min-w-[2ch]">{line}</span>
                  </div>
                ),
              )}
            </div>
            <textarea
              ref={editorRef}
              aria-label="Page sketch"
              value={value}
              readOnly={readOnly}
              spellCheck={false}
              wrap="off"
              placeholder={EMPTY_HINT}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={onKeyDown}
              onSelect={updateCaretLine}
              onBlur={() => setCaretLine(null)}
              onScroll={(e) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
              className={cn(
                `min-h-0 flex-1 resize-none bg-transparent py-3 pr-3 ${MONO} text-[13px] leading-5 text-fg-primary outline-none placeholder:text-fg-tertiary`,
                readOnly && "cursor-default text-fg-secondary",
              )}
            />
          </div>
          {errors.length > 0 && (
            <ErrorList errors={errors} onSelectLine={selectLine} />
          )}
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-bg-tertiary p-4">
          {blocks.length === 0 ? (
            <EmptyPage />
          ) : view === "wireframe" ? (
            <SketchContext.Provider value={sketch}>
              <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-md border border-border-primary bg-bg-primary p-6 shadow-sm">
                {blocks.map((block, i) => (
                  <Block key={i} node={block} />
                ))}
              </div>
            </SketchContext.Provider>
          ) : (
            <AsciiPage blocks={blocks} />
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY_HINT = [
  "# A heading",
  "A paragraph of text.",
  "[image: What the picture shows]",
  "[hero: Team on the roof](image: /public/val/roof.jpg)",
  "row",
  "  col 2",
  "    ## Wider column",
  "  col",
  "    [button: Sign up]",
  "icon image M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6",
].join("\n");

function ViewToggle({
  view,
  onChange,
}: {
  view: PageSketchView;
  onChange: (view: PageSketchView) => void;
}) {
  const options: { value: PageSketchView; label: string }[] = [
    { value: "wireframe", label: "Wireframe" },
    { value: "ascii", label: "ASCII" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Show the page as"
      className="inline-flex rounded-md border border-border-primary bg-bg-secondary p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={view === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "cursor-pointer rounded px-2 py-0.5 text-xs text-fg-secondary",
            view === option.value && "bg-bg-primary text-fg-primary shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ErrorList({
  errors,
  onSelectLine,
}: {
  errors: SketchError[];
  onSelectLine: (line: number) => void;
}) {
  return (
    <ul className="max-h-32 overflow-auto border-t border-border-primary bg-bg-error-secondary px-3 py-2 text-xs text-fg-error-secondary">
      {errors.map((error, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onSelectLine(error.line)}
            className="cursor-pointer text-left hover:underline"
          >
            <span className="font-medium">Line {error.line}:</span>{" "}
            {error.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-2 rounded-md border border-dashed border-border-primary p-6 text-sm text-fg-secondary">
      <div className="font-medium text-fg-primary">
        Nothing on this page yet
      </div>
      <p>
        Write a line on the left, or ask the assistant to sketch the page. One
        block per line; indent under <code>row</code> and <code>col</code> to
        put blocks side by side.
      </p>
    </div>
  );
}

function NoticeLine({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-bg-error-secondary px-2 py-1 text-xs text-fg-error-secondary"
    >
      <span>{notice.message}</span>
      {notice.retry && (
        <button
          type="button"
          onClick={notice.retry}
          className="cursor-pointer font-medium underline"
        >
          Try again
        </button>
      )}
      {notice.details && (
        <details>
          <summary className="cursor-pointer">Details</summary>
          <span className={`${MONO}`}>{notice.details}</span>
        </details>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-auto cursor-pointer"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

type SketchContextValue = {
  icons: Record<string, string>;
  activeLine: number | null;
  showLayout: boolean;
  editable: boolean;
  onSelectLine: (line: number) => void;
  onHoverLine: (line: number | null) => void;
  onCommitLine: (line: number, content: string) => void;
  onAttachMedia: (node: SketchPlaceholder, file: File) => void;
};

const SketchContext = createContext<SketchContextValue | null>(null);

function useSketch(): SketchContextValue {
  const sketch = useContext(SketchContext);
  if (!sketch) {
    throw new Error("A sketch block was rendered outside of PageSketch");
  }
  return sketch;
}

function Block({ node }: { node: SketchNode }) {
  const { activeLine, showLayout, onSelectLine, onHoverLine } = useSketch();
  const active = node.line === activeLine;
  const interaction = {
    "data-line": node.line,
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelectLine(node.line);
    },
    onMouseOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onHoverLine(node.line);
    },
    onMouseLeave: () => onHoverLine(null),
  };
  const ring = active && "ring-2 ring-border-focus";

  if (node.type === "row" || node.type === "col") {
    const isRow = node.type === "row";
    return (
      <div
        {...interaction}
        className={cn(
          "relative flex min-w-0 cursor-pointer rounded",
          isRow ? "flex-row gap-4" : "flex-col gap-3",
          showLayout && "border border-dashed border-border-primary p-3 pt-5",
          ring,
        )}
      >
        {showLayout && (
          <span
            className={`absolute left-1.5 top-0.5 ${MONO} text-[10px] text-fg-tertiary`}
          >
            {isRow ? "row" : node.weight === 1 ? "col" : `col ${node.weight}`}
          </span>
        )}
        {node.children.length === 0 && (
          <span className="text-xs italic text-fg-tertiary">empty</span>
        )}
        {node.children.map((child, i) => (
          <div
            key={i}
            className="flex min-w-0 flex-col"
            style={
              isRow
                ? { flex: `${child.type === "col" ? child.weight : 1} 1 0` }
                : undefined
            }
          >
            <Block node={child} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div {...interaction} className={cn("rounded", ring)}>
      {node.type === "text" ? (
        <Text node={node} />
      ) : (
        <Placeholder node={node} />
      )}
    </div>
  );
}

/**
 * Text that is edited where it is shown. The DOM is the source of truth while
 * it has focus -- React writing children into a node the browser is editing
 * is how text ends up duplicated -- so the text is put in by hand, and only
 * when nobody is typing in it.
 */
function EditableText({
  text,
  placeholder,
  onCommit,
  className,
}: {
  text: string;
  /** Shown while empty. */
  placeholder?: string;
  onCommit: (text: string) => void;
  className?: string;
}) {
  const { editable } = useSketch();
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    // `:focus` rather than `document.activeElement`, which is the shadow
    // host inside the Studio.
    if (element && !element.matches(":focus")) {
      element.textContent = text;
    }
  }, [text]);

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter") {
      // One line per block: a new line is a new block, made in the text.
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.currentTarget.textContent = text;
      event.currentTarget.blur();
    }
  };

  return (
    <span
      ref={ref}
      role={editable ? "textbox" : undefined}
      aria-label={editable ? "Edit text" : undefined}
      contentEditable={editable ? "plaintext-only" : false}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const next = (e.currentTarget.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim();
        if (next !== text) {
          onCommit(next);
        }
      }}
      className={cn(
        "rounded outline-none",
        editable &&
          "cursor-text hover:bg-bg-secondary focus:bg-bg-secondary focus:ring-2 focus:ring-border-focus",
        "empty:before:text-fg-tertiary empty:before:content-[attr(data-placeholder)]",
        className,
      )}
    />
  );
}

function Text({ node }: { node: SketchText }) {
  const { onCommitLine } = useSketch();
  const editable = (
    <EditableText
      text={node.text}
      onCommit={(text) => {
        // Emptying a heading or a paragraph is not a way to delete it: that
        // is done in the text, where the line is.
        if (text !== "") {
          onCommitLine(node.line, formatText(node.level, text));
        }
      }}
    />
  );
  switch (node.level) {
    case 1:
      return (
        <h1 className="text-2xl font-semibold leading-tight">{editable}</h1>
      );
    case 2:
      return <h2 className="text-lg font-semibold leading-snug">{editable}</h2>;
    case 3:
      return <h3 className="text-sm font-semibold">{editable}</h3>;
    default:
      return <p className="text-sm text-fg-secondary">{editable}</p>;
  }
}

/**
 * A kind's icon, as the assistant drew it. A kind nobody drew one for has
 * none, rather than a generic shape that would make every box look alike.
 */
function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const { icons } = useSketch();
  const path = icons[kind.toLowerCase()];
  if (!path) {
    return null;
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5 shrink-0", className)}
    >
      <path d={path} />
    </svg>
  );
}

/** Kinds that read as a control, and are drawn as one rather than a box. */
const INLINE_KINDS = new Set(["button", "link", "input"]);
const TALL_KINDS = new Set(["image", "video", "map", "chart", "embed"]);

function Placeholder({ node }: { node: SketchPlaceholder }) {
  const { editable, onCommitLine, onAttachMedia, activeLine } = useSketch();
  const [dropping, setDropping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kind = node.kind.toLowerCase();
  const label = (
    <EditableText
      text={node.label ?? ""}
      placeholder={editable ? "Say what goes here" : undefined}
      onCommit={(text) =>
        onCommitLine(
          node.line,
          formatPlaceholder({ ...node, label: text === "" ? null : text }),
        )
      }
      className="min-w-[2ch] px-1"
    />
  );

  if (INLINE_KINDS.has(kind) && !node.media) {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-fg-tertiary px-2.5 py-1.5 text-sm text-fg-secondary",
          kind === "input" && "flex w-full",
        )}
      >
        <KindIcon kind={kind} />
        {label}
      </span>
    );
  }

  const isFileDrag = (e: DragEvent) =>
    editable && Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div
      onDragOver={(e) => {
        if (isFileDrag(e)) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!isFileDrag(e)) {
          return;
        }
        e.preventDefault();
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (file) {
          onAttachMedia(node, file);
        }
      }}
      className={cn(
        "group relative flex flex-col gap-2 overflow-hidden rounded-md border border-dashed border-fg-tertiary bg-bg-secondary p-3 text-fg-secondary",
        !node.media &&
          (TALL_KINDS.has(kind)
            ? "aspect-video items-center justify-center text-center"
            : "min-h-16 items-center justify-center text-center"),
        dropping && "border-solid border-border-focus bg-bg-primary",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary",
          node.media && "self-start",
        )}
      >
        <KindIcon kind={kind} />
        {node.kind}
      </span>
      {node.media?.type === "image" && (
        <img
          src={node.media.src}
          alt={node.label ?? ""}
          className="max-h-80 w-full rounded object-cover"
        />
      )}
      {node.media?.type === "video" && (
        <video
          src={node.media.src}
          controls
          muted
          playsInline
          className="max-h-80 w-full rounded bg-bg-tertiary"
        />
      )}
      <span className="text-sm">{label}</span>
      {dropping && (
        <span className="text-xs text-fg-primary">
          Drop to put it in this box
        </span>
      )}

      {editable && (
        <div
          className={cn(
            "absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
            node.line === activeLine && "opacity-100",
          )}
        >
          <BoxAction
            label={node.media ? "Replace image or video" : "Add image or video"}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </BoxAction>
          {node.media && (
            <BoxAction
              label={`Remove the ${node.media.type}`}
              onClick={() =>
                onCommitLine(
                  node.line,
                  formatPlaceholder({ ...node, media: null }),
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </BoxAction>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) {
                onAttachMedia(node, file);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function BoxAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border-primary bg-bg-primary text-fg-secondary shadow-sm hover:bg-bg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      {children}
    </button>
  );
}

function AsciiPage({ blocks }: { blocks: SketchNode[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const charRef = useRef<HTMLSpanElement>(null);
  const [columns, setColumns] = useState(72);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const char = charRef.current;
    if (!container || !char) {
      return;
    }
    const measure = () => {
      const charWidth = char.getBoundingClientRect().width / 10;
      if (charWidth > 0) {
        setColumns(
          Math.min(
            100,
            Math.max(24, Math.floor(container.clientWidth / charWidth) - 2),
          ),
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const ascii = useMemo(
    () => renderSketchAscii(blocks, columns),
    [blocks, columns],
  );

  return (
    <div ref={containerRef} className="relative">
      <span
        ref={charRef}
        aria-hidden
        className={`invisible absolute ${MONO} text-[13px]`}
      >
        0000000000
      </span>
      <button
        type="button"
        onClick={() => {
          copyText(ascii);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-0 top-0 inline-flex cursor-pointer items-center gap-1 rounded-md border border-border-primary bg-bg-primary px-2 py-1 text-xs text-fg-secondary hover:bg-bg-secondary"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className={`${MONO} text-[13px] leading-5 text-fg-primary`}>
        {ascii}
      </pre>
    </div>
  );
}
