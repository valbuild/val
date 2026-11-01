import { RotateCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";

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
  /** `progress` from 0 to 1, or `null` when it cannot be told. */
  | { state: "updating"; progress: number | null }
  | { state: "failed"; error: string; onAskAssistant?: () => void };

/**
 * Four ways to show it, for choosing between. Every one sits in the reload
 * button's place and keeps ONE width in every state, so nothing in the
 * toolbar moves when the status changes.
 *
 * - `reload` -- the reload button alone: it turns while the preview updates,
 *   with the percentage beside the arrow; a dot when it is behind or failed.
 * - `label` -- the same, with two or three words: "Up to date", "Updating
 *   42%", "Save to update", "Couldn't update".
 * - `ring` -- no text at all: a ring around the reload arrow fills as it
 *   updates. The percentage is in the tooltip.
 * - `line` -- a hairline along the foot of the toolbar fills as it updates;
 *   the reload button only carries the dot.
 */
export type CodeModeStatusVariant = "reload" | "label" | "ring" | "line";

export const CODE_MODE_STATUS_VARIANTS: CodeModeStatusVariant[] = [
  "reload",
  "label",
  "ring",
  "line",
];

/** The tooltip, and what a screen reader hears. */
export function codeModeStatusText(build: CodeModeBuild): string {
  switch (build.state) {
    case "up-to-date":
      return "The preview is up to date.";
    case "behind":
      return "The code changed since the preview was made. Save to update it.";
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
 * The reload button, carrying the preview's status. Pressing it reloads the
 * preview -- except when the preview could not be updated, where it opens
 * what happened and what to do about it, Reload among them.
 */
export function CodeModeStatus({
  build,
  variant,
  onReload,
}: {
  build: CodeModeBuild;
  variant: CodeModeStatusVariant;
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
  const updating = build.state === "updating" ? build : null;
  const text = codeModeStatusText(build);
  const dot =
    build.state === "failed"
      ? "bg-bg-error-primary"
      : build.state === "behind"
        ? "bg-fg-warning-primary"
        : null;

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
          variant === "reload" && "w-14 justify-end pr-2",
          variant === "label" && "w-[7.75rem] px-2",
          (variant === "ring" || variant === "line") && "w-7 justify-center",
          isOpen && "bg-bg-float-raised text-fg-primary",
        )}
      >
        {/*
         * `reload`: the percentage BEFORE the arrow, in a slot that is always
         * there, so the arrow never moves when it appears.
         */}
        {variant === "reload" && (
          <span className="w-8 text-right tabular-nums">
            {updating !== null && updating.progress !== null
              ? percent(updating.progress)
              : ""}
          </span>
        )}
        {variant === "ring" ? (
          <Ring progress={updating?.progress ?? null} active={!!updating} />
        ) : (
          <RotateCw
            size={13}
            className={cn(
              "shrink-0",
              updating !== null && "animate-spin [animation-duration:1.4s]",
            )}
          />
        )}
        {variant === "label" && (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left tabular-nums",
              failed !== null && "text-fg-error-on-surface",
            )}
          >
            {shortText(build)}
          </span>
        )}
        {dot !== null && variant !== "label" && (
          <span
            aria-hidden
            className={cn(
              "absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-bg-float",
              dot,
            )}
          />
        )}
      </button>
      {/* Screen readers hear changes; nothing is drawn for them. */}
      <span role="status" className="sr-only">
        {text}
      </span>
      {isOpen && failed !== null && (
        <div
          role="dialog"
          aria-label="The preview couldn't be updated"
          className="absolute right-0 top-full z-full mt-1 w-72 rounded-md border border-border-float bg-bg-float p-3 text-xs shadow-lg"
        >
          <p className="font-medium text-fg-primary">
            The preview couldn&rsquo;t be updated
          </p>
          <p className="mt-1 leading-relaxed text-fg-secondary">
            It shows the last version that worked. The assistant can usually fix
            this; or change something and Save again.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-fg-secondary">
              Details
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[0.6875rem] text-fg-secondary">
              {failed.error}
            </pre>
          </details>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onReload();
              }}
              className="inline-flex h-7 items-center rounded-md px-2 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              Reload
            </button>
            {failed.onAskAssistant !== undefined && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  failed.onAskAssistant?.();
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-bg-proposal px-2 font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
              >
                <Sparkles size={13} className="shrink-0" />
                Ask the assistant to fix it
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A ring that fills as the preview updates, around the reload arrow. With no
 * percentage to show, a quarter of it turns instead.
 */
function Ring({
  progress,
  active,
}: {
  progress: number | null;
  active: boolean;
}) {
  const r = 9;
  const length = 2 * Math.PI * r;
  const filled = progress === null ? 0.25 : Math.min(1, Math.max(0, progress));
  return (
    <span className="relative grid h-[22px] w-[22px] place-items-center">
      {active && (
        <svg
          aria-hidden
          viewBox="0 0 22 22"
          className={cn(
            "absolute inset-0 -rotate-90",
            progress === null && "animate-spin",
          )}
        >
          <circle
            cx="11"
            cy="11"
            r={r}
            fill="none"
            strokeWidth="2"
            className="stroke-border-float"
          />
          <circle
            cx="11"
            cy="11"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={length}
            strokeDashoffset={length * (1 - filled)}
            className="stroke-bg-proposal transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      )}
      <RotateCw size={11} className="shrink-0" />
    </span>
  );
}

/**
 * The `line` variant's hairline, along the foot of the toolbar and drawn over
 * its border, so it takes no room. Rendered by the toolbar (which is
 * `relative`), not by the button, so it spans the toolbar's width.
 */
export function CodeModeProgressLine({ build }: { build: CodeModeBuild }) {
  if (build.state !== "updating") return null;
  const progress = build.progress;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -bottom-px z-10 h-0.5 overflow-hidden"
    >
      <span
        className={cn(
          "block h-full bg-bg-proposal transition-[width] duration-300",
          progress === null && "w-1/3 animate-pulse",
        )}
        style={
          progress === null
            ? undefined
            : { width: `${Math.round(progress * 100)}%` }
        }
      />
    </span>
  );
}
