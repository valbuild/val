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
  /**
   * `progress` from 0 to 1, or `null` when it cannot be told; `step`, what
   * the build is doing now ("Building the site"), when it says.
   */
  | { state: "updating"; progress: number | null; step?: string | null }
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
    case "updating": {
      const step = build.step ? ` ${build.step}.` : "";
      return build.progress === null
        ? `Updating the preview…${step}`
        : `Updating the preview: ${percent(build.progress)}.${step}`;
    }
    case "failed":
      return "The preview couldn't be updated, so it shows the last version that worked.";
  }
}

function percent(progress: number): string {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}

/**
 * The reload button, as an icon alone: what state the preview is in is said
 * by the icon -- still, turning, a ring filling as the build goes, a dot when
 * Save would update it, red when it could not be updated -- and in words by
 * its tooltip and to screen readers. A fixed size, so nothing beside it moves
 * when the state does.
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
  const progress =
    build.state === "updating" && build.progress !== null
      ? Math.min(1, Math.max(0, build.progress))
      : null;
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
          "relative grid h-7 w-7 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          isOpen && "bg-bg-float-raised text-fg-primary",
          failed !== null && "text-fg-error-on-surface",
        )}
      >
        {progress !== null && <ProgressRing progress={progress} />}
        {/* The span turns, not the SVG: see designSystem/spinner. */}
        <span
          className={cn(
            "inline-flex",
            updating !== null &&
              progress === null &&
              "animate-spin [animation-duration:1.4s] will-change-transform",
          )}
        >
          <RotateCw size={13} className="shrink-0" />
        </span>
        {(build.state === "behind" || build.state === "quick") && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-fg-brand-primary"
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

/**
 * How far the build is, as a ring filling round the icon: drawn from the
 * top, clockwise. Under the icon, and taking no clicks.
 */
function ProgressRing({ progress }: { progress: number }) {
  const r = 12;
  const length = 2 * Math.PI * r;
  return (
    <svg
      aria-hidden
      viewBox="0 0 28 28"
      className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
    >
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        strokeWidth="2"
        className="stroke-border-float"
      />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - progress)}
        className="stroke-fg-brand-primary transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}
