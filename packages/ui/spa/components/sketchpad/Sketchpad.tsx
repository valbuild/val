import { Check, Copy, X } from "lucide-react";
import type { Plugin } from "prosemirror-state";
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
  type SketchMedia,
  type SketchNode,
} from "./sketchFormat";
import { SketchpadEditor } from "./SketchpadEditor";

export type SketchpadView = "page" | "text" | "ascii";

export type SketchpadPerson = {
  name: string;
  /** Who is looking at it: shown first, and named "you". */
  you?: boolean;
};

export type SketchpadProps = {
  value: string;
  onChange?: (value: string) => void;
  /** Shown above the page, e.g. the page's route. */
  title?: string;
  /** Shown under the title, e.g. who is editing. */
  status?: ReactNode;
  /** True while someone else (the assistant) is writing to the sketch. */
  readOnly?: boolean;
  defaultView?: SketchpadView;
  /**
   * Stores a file put in a box and resolves to the URL the sketch will name
   * it by. That URL is what the assistant reads, so in the Studio it is where
   * the upload landed. Defaults to an object URL, which lives as long as the
   * tab does.
   */
  onAttachMedia?: (file: File) => Promise<string>;
  /** The proposal's people (Flow H), when the Sketchpad is in one. */
  people?: SketchpadPerson[];
  /** See `SketchpadEditorProps.plugins`: where working together plugs in. */
  plugins?: Plugin[];
};

/**
 * The theme replaces Tailwind's font families rather than extending them, so
 * `font-mono` is not a class here. The Text and ASCII views need one, since
 * both are laid out in characters.
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
 * Sketchpad: a page's content and rough layout, worked out with the
 * assistant before anyone builds it.
 *
 * Three views of one text. **Page** is the page as a document you type in,
 * with the caret moving through headings, boxes and columns. **Text** is the
 * same thing as the assistant reads and writes it. **ASCII** is the page as
 * monospace text, which is how the assistant is shown what you see. Whatever
 * is edited where, the text is what changes. See `sketchFormat.ts`.
 */
export function Sketchpad({
  value,
  onChange,
  title,
  status,
  readOnly = false,
  defaultView = "page",
  onAttachMedia,
  people,
  plugins,
}: SketchpadProps) {
  const { blocks, errors } = useMemo(() => parseSketch(value), [value]);
  const [view, setView] = useState<SketchpadView>(defaultView);
  const [notice, setNotice] = useState<Notice | null>(null);

  const attach = async (file: File): Promise<SketchMedia | null> => {
    const type = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : null;
    if (type === null) {
      setNotice({
        message: `"${file.name}" is not an image or a video, so it cannot go in a box.`,
      });
      return null;
    }
    setNotice(null);
    try {
      const src = await (onAttachMedia ?? objectUrlOf)(file);
      return { type, src };
    } catch (error) {
      return new Promise((resolve) =>
        setNotice({
          message: `"${file.name}" could not be added. The box is as it was.`,
          details: error instanceof Error ? error.message : undefined,
          retry: () => {
            setNotice(null);
            attach(file).then(resolve);
          },
        }),
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary text-fg-primary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-primary px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {title ? (
              <>
                <span className="text-fg-secondary">Sketchpad · </span>
                {title}
              </>
            ) : (
              "Sketchpad"
            )}
          </div>
          {status && (
            <div className="truncate text-xs text-fg-secondary">{status}</div>
          )}
        </div>
        {people && people.length > 0 && <People people={people} />}
        <ViewToggle view={view} onChange={setView} />
        {notice && (
          <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />
        )}
      </div>

      {/* Kept mounted, so undo and the caret survive a look at the text. */}
      <div
        className={cn(
          "min-h-0 flex-1 flex-col",
          view === "page" ? "flex" : "hidden",
        )}
      >
        {errors.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 border-b border-border-primary bg-bg-error-secondary px-3 py-1.5 text-xs text-fg-error-secondary">
            {errors.length === 1
              ? "One line of the text could not be read, and is shown as text."
              : `${errors.length} lines of the text could not be read, and are shown as text.`}
            <button
              type="button"
              onClick={() => setView("text")}
              className="cursor-pointer font-medium underline"
            >
              Show {errors.length === 1 ? "it" : "them"}
            </button>
          </div>
        )}
        <SketchpadEditor
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          attach={attach}
          plugins={plugins}
        />
      </div>
      {view === "text" && (
        <SketchText
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          errors={errors}
        />
      )}
      {view === "ascii" && (
        <div className="min-h-0 flex-1 overflow-auto bg-bg-tertiary p-4">
          <AsciiPage blocks={blocks} />
        </div>
      )}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

function People({ people }: { people: SketchpadPerson[] }) {
  const sorted = [...people].sort((a, b) => Number(!!b.you) - Number(!!a.you));
  const shown = sorted.slice(0, 3);
  const rest = sorted.length - shown.length;
  const names = sorted.map((p) => (p.you ? `${p.name} (you)` : p.name));
  return (
    <div
      className="flex items-center -space-x-1.5"
      title={`Working on this: ${names.join(", ")}`}
      aria-label={`Working on this: ${names.join(", ")}`}
    >
      {shown.map((person) => (
        <span
          key={person.name}
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-primary bg-bg-brand-secondary text-[10px] font-semibold text-fg-brand-secondary"
        >
          {initialsOf(person.name)}
        </span>
      ))}
      {rest > 0 && (
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-bg-primary bg-bg-secondary px-1 text-[10px] font-semibold text-fg-secondary">
          +{rest}
        </span>
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: SketchpadView;
  onChange: (view: SketchpadView) => void;
}) {
  const options: { value: SketchpadView; label: string }[] = [
    { value: "page", label: "Page" },
    { value: "text", label: "Text" },
    { value: "ascii", label: "ASCII" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Show the sketch as"
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

/**
 * The sketch as the assistant reads it, in a plain text editor with line
 * numbers. Indentation is the structure, so Enter keeps it and Tab adds to it.
 */
function SketchText({
  value,
  onChange,
  readOnly,
  errors,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly: boolean;
  errors: SketchError[];
}) {
  const [caretLine, setCaretLine] = useState<number | null>(null);
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
      // A new line keeps the indent, and goes one level in after a row or col.
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 bg-bg-secondary">
        <div
          ref={gutterRef}
          aria-hidden
          className={`select-none overflow-hidden py-3 ${MONO} text-[13px] leading-5 text-fg-tertiary`}
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).map((line) => (
            <div
              key={line}
              className={cn(
                "flex items-center gap-1 pl-2 pr-2 text-right",
                line === caretLine && "text-fg-primary",
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
          ))}
        </div>
        <textarea
          ref={editorRef}
          aria-label="Sketch text"
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          wrap="off"
          placeholder={EMPTY_HINT}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          onSelect={(e) =>
            setCaretLine(
              value.slice(0, e.currentTarget.selectionStart).split("\n").length,
            )
          }
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
