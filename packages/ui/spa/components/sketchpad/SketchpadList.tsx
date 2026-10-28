import { Archive, ChevronDown, PencilRuler } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { useValPortal } from "../ValPortalProvider";

/** A sketchpad of the project, as a row of the list names it. */
export type SketchpadListItem = {
  id: string;
  /** Its first heading, if it has one. */
  title: string | null;
  /** The route it is about, if any. */
  page: string | null;
  /** "Changed 2 min ago by Kari". */
  detail?: string;
  /** Put away: not shown until someone reopens it. Nothing is deleted. */
  archived: boolean;
};

export type SketchpadListProps = {
  sketchpads: SketchpadListItem[];
  /** The one on screen, if any. */
  currentId?: string | null;
  onOpen: (id: string) => void;
  onReopen: (id: string) => void;
  /**
   * Shows the archived ones without a click. Folded by default, beside open
   * ones to choose from; open where reopening is what someone came to do.
   */
  archivedOpen?: boolean;
};

/**
 * The session's sketchpads: the open ones, then the archived ones with a way
 * back. Archiving hides a sketchpad and nothing else, so reopening one brings
 * it back exactly as it was left -- text, photos and all.
 */
export function SketchpadList({
  sketchpads,
  currentId,
  onOpen,
  onReopen,
  archivedOpen = false,
}: SketchpadListProps) {
  const [showArchived, setShowArchived] = useState(archivedOpen);
  const open = sketchpads.filter((s) => !s.archived);
  const archived = sketchpads.filter((s) => s.archived);

  if (sketchpads.length === 0) {
    return (
      <p className="px-3 py-3 text-sm text-fg-secondary">
        No sketchpads in this project yet. Ask the assistant to sketch a page.
      </p>
    );
  }

  return (
    <div className="flex flex-col py-1 text-sm">
      {open.length === 0 && (
        <p className="px-3 py-2 text-fg-secondary">
          Every sketchpad in this project is archived.
        </p>
      )}
      {open.map((sketchpad) => (
        <button
          key={sketchpad.id}
          type="button"
          onClick={() => onOpen(sketchpad.id)}
          aria-current={sketchpad.id === currentId ? "true" : undefined}
          className={cn(
            "flex cursor-pointer flex-col items-start px-3 py-2 text-left hover:bg-bg-secondary",
            sketchpad.id === currentId && "bg-bg-secondary",
          )}
        >
          <span className="font-medium">{nameOf(sketchpad)}</span>
          <RowDetail sketchpad={sketchpad} className="text-fg-secondary" />
        </button>
      ))}
      {archived.length > 0 && (
        <div className="mt-1 border-t border-border-primary pt-1">
          <button
            type="button"
            aria-expanded={showArchived || open.length === 0}
            onClick={() => setShowArchived((shown) => !shown)}
            className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary"
          >
            <Archive className="h-3.5 w-3.5" />
            Archived ({archived.length})
            <ChevronDown
              className={cn(
                "ml-auto h-3.5 w-3.5 transition-transform",
                (showArchived || open.length === 0) && "rotate-180",
              )}
            />
          </button>
          {(showArchived || open.length === 0) &&
            archived.map((sketchpad) => (
              <div
                key={sketchpad.id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg-secondary">
                    {nameOf(sketchpad)}
                  </div>
                  <RowDetail
                    sketchpad={sketchpad}
                    className="truncate text-fg-tertiary"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onReopen(sketchpad.id)}
                  className="h-7 shrink-0 cursor-pointer rounded-md border border-border-primary px-2 text-xs font-medium hover:bg-bg-secondary"
                >
                  Reopen
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** A sketch is named by its heading, else by its page. */
function nameOf(sketchpad: SketchpadListItem): string {
  return sketchpad.title ?? sketchpad.page ?? "Untitled sketch";
}

function RowDetail({
  sketchpad,
  className,
}: {
  sketchpad: SketchpadListItem;
  className?: string;
}) {
  const parts = [
    sketchpad.title !== null ? sketchpad.page : null,
    sketchpad.detail,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? (
    <span className={cn("block text-xs", className)}>{parts.join(" · ")}</span>
  ) : null;
}

/** `SketchpadList` behind a button, closing once something is chosen. */
export function SketchpadListPopover({
  trigger,
  align = "start",
  side = "bottom",
  ...list
}: SketchpadListProps & {
  trigger: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const portal = useValPortal();
  const close =
    <T,>(f: (id: T) => void) =>
    (id: T) => {
      setOpen(false);
      f(id);
    };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        container={portal}
        align={align}
        side={side}
        className="w-72 p-0"
      >
        <div className="border-b border-border-primary px-3 py-2 text-xs font-medium text-fg-secondary">
          Sketchpads
        </div>
        <SketchpadList
          {...list}
          onOpen={close(list.onOpen)}
          onReopen={close(list.onReopen)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Where the Sketchpad was, once it is archived: a strip beside the preview
 * and the chat with the way back, so archiving puts it away without making
 * it unfindable.
 */
export function SketchpadStrip(props: SketchpadListProps) {
  const archived = props.sketchpads.filter((s) => s.archived).length;
  return (
    <SketchpadListPopover
      {...props}
      archivedOpen
      side="left"
      trigger={
        <button
          type="button"
          aria-label={`Sketchpads${archived > 0 ? `, ${archived} archived` : ""}`}
          title="Sketchpads"
          className="flex h-full w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border-primary bg-bg-primary py-3 text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
        >
          <PencilRuler className="h-4 w-4" />
          <span className="text-xs font-medium [writing-mode:vertical-rl]">
            Sketchpads{archived > 0 ? ` · ${archived} archived` : ""}
          </span>
        </button>
      }
    />
  );
}
