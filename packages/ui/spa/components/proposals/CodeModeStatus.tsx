import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import { PreviewProblemCard, type PreviewProblem } from "./PreviewProblemCard";

/**
 * Where the preview is, in code mode, in words a person uses: up to date,
 * behind (Save brings it up to date), updating, or it could not be updated.
 *
 * Deliberately NOT "build", "typecheck" or "lint": nobody editing a site has
 * to know what those are. The preview is the thing they look at, so the
 * status is about the preview. What went wrong is under "Details", for
 * whoever has to act on it.
 */
export type CodeModeBuild =
  | { state: "up-to-date" }
  /** The code changed since the preview was made: Save updates it. */
  | { state: "behind" }
  /**
   * The change is being shown without a build (a quick preview): its
   * components and styles, in seconds.
   */
  | { state: "previewing" }
  /**
   * The preview shows the change without a build: what runs in the browser
   * is new, what runs on the server is the last build's. Save builds it.
   */
  | { state: "quick" }
  /** `progress` from 0 to 1, or `null` when it cannot be told. */
  | { state: "updating"; progress: number | null }
  /** What happened, and what can be done: see `PreviewProblem`. */
  | { state: "failed"; problem: PreviewProblem };

/** The tooltip, and what a screen reader hears. */
export function codeModeStatusText(build: CodeModeBuild): string {
  switch (build.state) {
    case "up-to-date":
      return "The preview is up to date.";
    case "behind":
      return "The code changed since the preview was made. Save to update it.";
    case "previewing":
      return "Showing the change in the preview…";
    case "quick":
      return "The preview shows the change without a build: what runs on the server is still the last build's. Save to build it.";
    case "updating":
      return build.progress === null
        ? "Updating the preview…"
        : `Updating the preview… ${percent(build.progress)}`;
    case "failed":
      return "The preview couldn't be updated, so it shows the last version that worked.";
  }
}

function shortText(build: CodeModeBuild): string {
  switch (build.state) {
    case "up-to-date":
      return "Up to date";
    case "behind":
      return "Save to update";
    case "previewing":
      return "Previewing…";
    case "quick":
      return "Quick preview";
    case "updating":
      return build.progress === null
        ? "Updating…"
        : `Updating ${percent(build.progress)}`;
    case "failed":
      return "Couldn't update";
  }
}

function percent(progress: number): string {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}

/**
 * The reload button, carrying the preview's status in two or three words:
 * "Up to date", "Save to update", "Updating 42%", "Couldn't update". One
 * width in every state, so nothing beside it moves when the status changes,
 * and the arrow is at its end, so the arrow does not move either.
 *
 * Pressing it reloads the preview -- except when the preview could not be
 * updated, where it opens what happened and what to do about it (the same
 * `PreviewProblemCard` the switcher's menu shows).
 */
export function CodeModeStatus({
  build,
  onReload,
}: {
  build: CodeModeBuild;
  onReload: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);
  useEffect(() => {
    if (build.state !== "failed") setIsOpen(false);
  }, [build.state]);

  const failed = build.state === "failed" ? build : null;
  const updating =
    build.state === "updating" || build.state === "previewing" ? build : null;
  const text = codeModeStatusText(build);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={failed !== null ? () => setIsOpen((open) => !open) : onReload}
        aria-label={
          failed !== null
            ? `${text} Show what happened`
            : `Reload the preview. ${text}`
        }
        aria-haspopup={failed !== null ? "dialog" : undefined}
        aria-expanded={failed !== null ? isOpen : undefined}
        title={failed !== null ? text : `${text} Press to reload it.`}
        className={cn(
          "relative inline-flex h-7 items-center gap-1.5 rounded-md text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          // One width in every state: nothing beside it moves.
          "w-[7.75rem] px-2",
          isOpen && "bg-bg-float-raised text-fg-primary",
        )}
      >
        {/*
         * The words BEFORE the arrow, right-aligned against it: the arrow is
         * pinned to the button's end, and as the words change they grow and
         * shrink into the empty space on the left, where nothing is.
         */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-right tabular-nums",
            failed !== null && "text-fg-error-on-surface",
          )}
        >
          {shortText(build)}
        </span>
        <RotateCw
          size={13}
          className={cn(
            "shrink-0",
            updating !== null && "animate-spin [animation-duration:1.4s]",
          )}
        />
      </button>
      {/* Screen readers hear changes; nothing is drawn for them. */}
      <span role="status" className="sr-only">
        {text}
      </span>
      {isOpen && failed !== null && (
        <div
          role="dialog"
          aria-label="The preview couldn't be updated"
          className="absolute right-0 top-full z-full mt-1 w-80 rounded-md shadow-lg"
        >
          <PreviewProblemCard
            problem={failed.problem}
            onAct={() => setIsOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
