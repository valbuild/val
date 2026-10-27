import { Sparkles, X } from "lucide-react";
import type { Plugin } from "prosemirror-state";
import { useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import type { SketchMedia } from "./sketchFormat";
import { SketchpadEditor } from "./SketchpadEditor";

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
  /**
   * Sends the Sketchpad to the assistant: a message in its chat that asks it
   * to read it now. Without it there is no button: a Sketchpad outside an AI
   * session has no one to send it to.
   */
  onAskAssistant?: () => void;
  /**
   * Whether the assistant has seen the Sketchpad as it is now. It reads it
   * whenever it likes (it has a tool for that), so this is not a lock: it is
   * what tells the person their changes are not news to it yet.
   */
  assistantStatus?: SketchpadAssistantStatus;
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

async function objectUrlOf(file: File): Promise<string> {
  return URL.createObjectURL(file);
}

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
}: SketchpadProps) {
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
        {/* On a phone the title has a line of its own, or it is a few letters. */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
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
        {onAskAssistant && (
          <AskAssistant
            status={assistantStatus ?? "changed"}
            onAsk={onAskAssistant}
          />
        )}
        {notice && (
          <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />
        )}
      </div>

      <SketchpadEditor
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        attach={attach}
        plugins={plugins}
      />
    </div>
  );
}

function AskAssistant({
  status,
  onAsk,
}: {
  status: SketchpadAssistantStatus;
  onAsk: () => void;
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
        "relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium disabled:cursor-default disabled:opacity-60",
        status === "changed"
          ? "border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover"
          : "border-border-primary bg-bg-primary text-fg-secondary hover:bg-bg-secondary",
      )}
    >
      <Sparkles
        className={cn("h-3.5 w-3.5", status === "reading" && "animate-pulse")}
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
