import {
  BarChart3,
  Check,
  Copy,
  Film,
  ImageIcon,
  List,
  Map as MapIcon,
  MousePointerClick,
  Square,
  Table,
  TrendingUp,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../designSystem/cn";
import { copyText } from "../../utils/copyText";
import {
  parseSketch,
  renderSketchAscii,
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

/**
 * A page sketch: the text on the left, and the page it describes on the
 * right. Clicking a block selects its line; moving the caret highlights its
 * block. See `pageSketch.ts` for the format.
 */
export function PageSketch({
  value,
  onChange,
  title,
  status,
  readOnly = false,
  defaultView = "wireframe",
}: PageSketchProps) {
  const { blocks, errors } = useMemo(() => parseSketch(value), [value]);
  const [view, setView] = useState<PageSketchView>(defaultView);
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [showLayout, setShowLayout] = useState(true);
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

  const selectLine = (line: number) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const lines = value.split("\n");
    const start = lines
      .slice(0, line - 1)
      .reduce((sum, l) => sum + l.length + 1, 0);
    const indent = lines[line - 1].length - lines[line - 1].trimStart().length;
    editor.focus();
    editor.setSelectionRange(start + indent, start + lines[line - 1].length);
    editor.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
    setCaretLine(line);
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
            <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-md border border-border-primary bg-bg-primary p-6 shadow-sm">
              {blocks.map((block, i) => (
                <Block
                  key={i}
                  node={block}
                  activeLine={activeLine}
                  showLayout={showLayout}
                  onSelectLine={selectLine}
                  onHoverLine={setHoveredLine}
                />
              ))}
            </div>
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
  "row",
  "  col 2",
  "    ## Wider column",
  "  col",
  "    [button: Sign up]",
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

type BlockProps = {
  node: SketchNode;
  activeLine: number | null;
  showLayout: boolean;
  onSelectLine: (line: number) => void;
  onHoverLine: (line: number | null) => void;
};

function Block(props: BlockProps) {
  const { node, activeLine, showLayout, onSelectLine, onHoverLine } = props;
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
                ? {
                    flex: `${child.type === "col" ? child.weight : 1} 1 0`,
                  }
                : undefined
            }
          >
            <Block {...props} node={child} />
          </div>
        ))}
      </div>
    );
  }
  if (node.type === "text") {
    return (
      <div {...interaction} className={cn("cursor-pointer rounded", ring)}>
        <Text node={node} />
      </div>
    );
  }
  return (
    <div {...interaction} className={cn("cursor-pointer rounded", ring)}>
      <Placeholder node={node} />
    </div>
  );
}

function Text({ node }: { node: SketchText }) {
  switch (node.level) {
    case 1:
      return (
        <h1 className="text-2xl font-semibold leading-tight">{node.text}</h1>
      );
    case 2:
      return (
        <h2 className="text-lg font-semibold leading-snug">{node.text}</h2>
      );
    case 3:
      return <h3 className="text-sm font-semibold">{node.text}</h3>;
    default:
      return <p className="text-sm text-fg-secondary">{node.text}</p>;
  }
}

const KIND_ICONS: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  button: MousePointerClick,
  link: MousePointerClick,
  form: TextCursorInput,
  input: TextCursorInput,
  list: List,
  map: MapIcon,
  chart: BarChart3,
  table: Table,
  stat: TrendingUp,
};

const TALL_KINDS = new Set(["image", "video", "map", "chart", "embed"]);

function Placeholder({ node }: { node: SketchPlaceholder }) {
  const kind = node.kind.toLowerCase();
  const Icon = KIND_ICONS[kind] ?? Square;
  if (kind === "button" || kind === "link") {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-fg-tertiary px-3 py-1.5 text-sm text-fg-secondary">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.label ?? kind}</span>
      </span>
    );
  }
  if (kind === "input") {
    return (
      <span className="flex h-9 w-full min-w-0 items-center gap-1.5 rounded-md border border-dashed border-fg-tertiary px-2.5 text-sm text-fg-tertiary">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.label ?? kind}</span>
      </span>
    );
  }
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-dashed border-fg-tertiary bg-bg-secondary p-3 text-center text-fg-secondary",
        TALL_KINDS.has(kind)
          ? "aspect-video"
          : kind === "table"
            ? "min-h-40"
            : "min-h-16",
      )}
    >
      {kind === "image" && (
        // The wireframe convention for "a picture goes here".
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full text-border-primary"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <line
            x1="0"
            y1="0"
            x2="100"
            y2="100"
            stroke="currentColor"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="100"
            y1="0"
            x2="0"
            y2="100"
            stroke="currentColor"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <span className="relative flex items-center gap-1.5 rounded bg-bg-secondary px-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        <Icon className="h-3.5 w-3.5" />
        {node.kind}
      </span>
      {node.label && (
        <span className="relative rounded bg-bg-secondary px-1.5 text-sm">
          {node.label}
        </span>
      )}
    </div>
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
