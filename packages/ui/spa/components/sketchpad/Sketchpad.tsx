import {
  Archive,
  ChevronDown,
  FileText,
  Maximize2,
  PencilRuler,
  Sparkles,
  X,
} from "lucide-react";
import type { Plugin } from "prosemirror-state";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import {
  useLockBodyScroll,
  useVisualViewport,
} from "../shell/useVisualViewport";
import type { SketchMedia } from "@valbuild/shared/internal";
import { SketchpadEditor } from "./SketchpadEditor";
import { SketchpadListPopover, type SketchpadListProps } from "./SketchpadList";

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
  /**
   * The page it is about: a route, or null. A label, not a link -- the
   * sketchpad is the project's, and changing its page moves nothing.
   */
  page?: string | null;
  /** Shown as a chip that can be edited when given. */
  onPageChange?: (page: string | null) => void;
  /** Routes to suggest while the page is edited: the site's pages. */
  pageOptions?: string[];
  /** Shown under the title, e.g. who is editing. */
  status?: ReactNode;
  /** True while someone else (the assistant) is writing to the sketch. */
  readOnly?: boolean;
  /**
   * Stores a file put in a box and resolves to the URL the sketch will name
   * it by. That URL is what the assistant and everyone else read, so it has
   * to last: where the upload landed.
   *
   * Without it a box takes a LINK and no file. An object URL is not a
   * fallback: it would be saved, and be a dead link after a reload, in
   * another tab, and for everyone the sketch is shared with.
   */
  onAttachMedia?: (file: File) => Promise<string>;
  /** The proposal's people (Flow H), when the Sketchpad is in one. */
  people?: SketchpadPerson[];
  /** See `SketchpadEditorProps.plugins`: where working together plugs in. */
  plugins?: Plugin[];
  /**
   * Sends the Sketchpad to the assistant: a message in its chat that asks it
   * to read it now. Without it there is no button: a Sketchpad outside an AI
   * session has no one to send it to.
   */
  onAskAssistant?: () => void;
  /**
   * Puts the Sketchpad away. It is hidden, not deleted: the session keeps it
   * and the list of sketchpads reopens it.
   */
  onArchive?: () => void;
  /** The session's other sketchpads, behind the title, to switch or reopen. */
  sketchpads?: SketchpadListProps;
  /**
   * Whether the assistant has seen the Sketchpad as it is now. It reads it
   * whenever it likes (it has a tool for that), so this is not a lock: it is
   * what tells the person their changes are not news to it yet.
   */
  assistantStatus?: SketchpadAssistantStatus;
  /**
   * The page as the site serves it, for full screen. Given, the header has a
   * full-screen button: on a phone, the sketch and its page take the whole
   * screen, the Studio's bars and all. The tools are by the thumb, and under
   * them one bar: the chat, a button to the other view, "Send to AI" and X. Where there is room for the
   * two side by side, leave it out.
   */
  fullscreenPreview?: ReactNode;
  /** Opens in full screen. */
  defaultFullscreen?: boolean;
  /**
   * Opens the assistant's chat. In full screen that is the small button at
   * the left of the bottom bar, where the Studio's own bar has it; it leaves
   * full screen, since the chat is the Studio's and full screen covers it.
   */
  onOpenChat?: () => void;
};

/**
 * - `read`: the assistant read it, and nothing changed since.
 * - `changed`: changed since the assistant last read it (or it never has).
 * - `reading`: the assistant is reading it, or writing to it, right now.
 */
export type SketchpadAssistantStatus = "read" | "changed" | "reading";

type Notice = {
  message: string;
  details?: string;
  retry?: () => void;
};

/**
 * Sketchpad: a page's content and rough layout, worked out with the
 * assistant before anyone builds it.
 *
 * The person only ever sees the page: a document they type in, with the
 * caret moving through headings, boxes and columns. The assistant sees the
 * same page as text (`sketchFormat.ts`), written in exactly one way, so what
 * it reads is what is on the screen and nothing else.
 */
export function Sketchpad({
  value,
  onChange,
  title,
  status,
  readOnly = false,
  onAttachMedia,
  people,
  plugins,
  onAskAssistant,
  assistantStatus,
  onArchive,
  sketchpads,
  page,
  onPageChange,
  pageOptions,
  fullscreenPreview,
  defaultFullscreen = false,
  onOpenChat,
}: SketchpadProps) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fullscreen, setFullscreen] = useState(
    defaultFullscreen && fullscreenPreview !== undefined,
  );
  const [shown, setShown] = useState<"sketch" | "page">("sketch");
  // Pinned to what is visible, so the tools and "Send to AI" sit on top of
  // a phone's keyboard rather than under it -- as the overlay's full-screen
  // sheets do. See `useVisualViewport`.
  const viewport = useVisualViewport(fullscreen);
  useLockBodyScroll(fullscreen);
  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const upload = async (
    store: (file: File) => Promise<string>,
    file: File,
  ): Promise<SketchMedia | null> => {
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
      const src = await store(file);
      return { type, src };
    } catch (error) {
      return new Promise((resolve) =>
        setNotice({
          message: `"${file.name}" could not be added. The box is as it was.`,
          details: error instanceof Error ? error.message : undefined,
          retry: () => {
            setNotice(null);
            upload(store, file).then(resolve);
          },
        }),
      );
    }
  };

  const attach = onAttachMedia
    ? (file: File) => upload(onAttachMedia, file)
    : null;
  const refuseFile = (file: File) =>
    setNotice({
      message: `"${file.name}" cannot be stored in a sketchpad yet, so it is not added. Drag the image in from a web page, or add a link to it with the image button on the box.`,
    });

  const titleBlock = (
    <>
      {sketchpads ? (
        <SketchpadListPopover
          {...sketchpads}
          trigger={
            <button
              type="button"
              title="Sketchpads in this project"
              className="-ml-1 flex max-w-full cursor-pointer items-center gap-1 rounded px-1 text-sm font-medium hover:bg-bg-secondary"
            >
              <span className="truncate">
                <TitleText title={title} />
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-secondary" />
            </button>
          }
        />
      ) : (
        <div className="truncate text-sm font-medium">
          <TitleText title={title} />
        </div>
      )}
      {(page !== undefined || status) && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-fg-secondary">
          {page !== undefined && (
            <PageChip
              page={page}
              onChange={readOnly ? undefined : onPageChange}
              options={pageOptions}
            />
          )}
          {status && <span className="truncate">{status}</span>}
        </div>
      )}
    </>
  );
  const archiveButton = onArchive && (
    <button
      type="button"
      onClick={onArchive}
      title="Archive this sketchpad. It can be reopened from the list of sketchpads."
      aria-label="Archive this sketchpad"
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
    >
      <Archive className="h-4 w-4" />
    </button>
  );

  return (
    <div
      role={fullscreen ? "dialog" : undefined}
      aria-label={fullscreen ? "Sketchpad, full screen" : undefined}
      aria-modal={fullscreen ? true : undefined}
      style={
        fullscreen
          ? { top: viewport.offsetTop, height: viewport.height }
          : undefined
      }
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-bg-primary text-fg-primary",
        fullscreen
          ? "fixed inset-x-0 z-overlay"
          : "h-full rounded-lg border border-border-primary",
      )}
    >
      {fullscreen ? (
        <div className="shrink-0 border-b border-border-primary">
          {/* Only what it is: every button is in the bar at the bottom. */}
          <div className="px-3 py-2">{titleBlock}</div>
          {notice && (
            <div className="px-2 pb-2">
              <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-primary px-3 py-2">
          {/* On a phone the title has a line of its own, or it is a few letters. */}
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            {titleBlock}
          </div>
          {people && people.length > 0 && <People people={people} />}
          {onAskAssistant && (
            <AskAssistant
              status={assistantStatus ?? "changed"}
              onAsk={onAskAssistant}
            />
          )}
          {fullscreenPreview !== undefined && (
            <button
              type="button"
              onClick={() => {
                setShown("sketch");
                setFullscreen(true);
              }}
              title="Full screen: the sketch and its page, with nothing else"
              className="flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border-primary px-2 text-xs font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Full screen
            </button>
          )}
          {archiveButton}
          {notice && (
            <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />
          )}
        </div>
      )}

      {/* The same editor in both, so the caret and undo survive the switch. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          fullscreen && shown === "page" && "hidden",
        )}
      >
        <SketchpadEditor
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          attach={attach}
          onFileRefused={refuseFile}
          plugins={plugins}
          toolbar={fullscreen ? "bottom" : "top"}
          touch={fullscreen}
        />
      </div>
      {fullscreen && shown === "page" && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {fullscreenPreview}
        </div>
      )}
      {/*
       * Under the tools, where the thumb is -- and out of the way while the
       * keyboard is up, when what is being done is typing. The chat at the
       * left, as in the Studio's own bar; leaving at the right.
       */}
      {fullscreen && !viewport.isKeyboardOpen && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border-primary px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {onOpenChat && (
            <button
              type="button"
              onClick={() => {
                setFullscreen(false);
                onOpenChat();
              }}
              aria-label="AI chat"
              title="Open the chat with the assistant"
              className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-md border border-border-primary text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
            >
              <Sparkles className="h-5 w-5" />
            </button>
          )}
          {/*
           * One button, naming the other view: on the sketch it says Page,
           * on the page Sketch. A fixed width, so the bar does not shift
           * when it is pressed.
           */}
          <button
            type="button"
            onClick={() => setShown(shown === "sketch" ? "page" : "sketch")}
            title={
              shown === "sketch"
                ? "Show the page this sketches"
                : "Back to the sketch"
            }
            className="flex h-12 w-24 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border-primary text-base font-medium text-fg-primary hover:bg-bg-secondary"
          >
            {shown === "sketch" ? (
              <>
                <FileText className="h-4 w-4" /> Page
              </>
            ) : (
              <>
                <PencilRuler className="h-4 w-4" /> Sketch
              </>
            )}
          </button>
          <div className="min-w-0 flex-1">
            {onAskAssistant && (
              <AskAssistant
                status={assistantStatus ?? "changed"}
                onAsk={onAskAssistant}
                size="bar"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="Leave full screen"
            title="Leave full screen"
            className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-md border border-border-primary text-fg-primary hover:bg-bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** The page a sketch is about, and where to change it. */
function PageChip({
  page,
  onChange,
  options,
}: {
  page: string | null;
  onChange?: (page: string | null) => void;
  options?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(page ?? "");
  const listId = useId();
  const label = page ?? "No page";
  if (!onChange) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <FileText className="h-3 w-3" />
        {label}
      </span>
    );
  }
  if (!editing) {
    return (
      <button
        type="button"
        title="Change which page this sketches"
        onClick={() => {
          setDraft(page ?? "");
          setEditing(true);
        }}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 -mx-1 hover:bg-bg-secondary hover:text-fg-primary"
      >
        <FileText className="h-3 w-3" />
        {label}
      </button>
    );
  }
  const save = () => {
    setEditing(false);
    const next = draft.trim() === "" ? null : draft.trim();
    if (next !== page) {
      onChange(next);
    }
  };
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <FileText className="h-3 w-3" />
      <input
        autoFocus
        aria-label="Page this sketches"
        placeholder="/a-page, or empty for none"
        value={draft}
        list={options ? listId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="h-6 w-44 rounded border border-border-focus bg-bg-primary px-1.5 text-xs text-fg-primary outline-none"
      />
      {options && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </span>
  );
}

function TitleText({ title }: { title?: string }) {
  return title ? (
    <>
      <span className="text-fg-secondary">Sketchpad · </span>
      {title}
    </>
  ) : (
    <>Sketchpad</>
  );
}

function AskAssistant({
  status,
  onAsk,
  size = "inline",
}: {
  status: SketchpadAssistantStatus;
  onAsk: () => void;
  /** `bar`: the width of the screen, under a phone's thumb. */
  size?: "inline" | "bar";
}) {
  const hint =
    status === "read"
      ? "The assistant has read the Sketchpad as it is now. Send it again to ask about it"
      : status === "reading"
        ? "The assistant is reading the Sketchpad"
        : "Changed since the assistant read it. Send it to ask about the changes";
  return (
    <button
      type="button"
      onClick={onAsk}
      disabled={status === "reading"}
      title={hint}
      className={cn(
        "relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border font-medium disabled:cursor-default disabled:opacity-60",
        size === "bar"
          ? "h-12 w-full justify-center whitespace-nowrap text-base"
          : "h-7 px-2 text-xs",
        status === "changed"
          ? "border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover"
          : "border-border-primary bg-bg-primary text-fg-secondary hover:bg-bg-secondary",
      )}
    >
      <Sparkles
        className={cn(
          size === "bar" ? "h-5 w-5" : "h-3.5 w-3.5",
          status === "reading" && "animate-pulse",
        )}
      />
      {status === "reading" ? "AI is reading…" : "Send to AI"}
      <span className="sr-only">. {hint}.</span>
    </button>
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
          <span>{notice.details}</span>
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
