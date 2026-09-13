import { ChevronRight, Earth } from "lucide-react";
import { cn } from "../designSystem/cn";

export type ExternalPagesButtonProps = {
  /** How many external URLs the project has. */
  count: number;
  /**
   * How many of them have something wrong with them.
   *
   * The reason the button can replace the list rather than merely hide it: a
   * collapsed section that says nothing about what is inside it is a section
   * nobody opens, and the whole point of moving external pages behind a button
   * is that they are a list you visit, not a list you scroll past.
   */
  issueCount?: number;
  onClick: () => void;
};

/**
 * The way into the external pages, from the bottom of the Pages panel.
 *
 * External pages used to be a second section in this panel, under the site
 * map. They are pages in the sense that content links to them, and in no other
 * sense: they have no tree, no children, no route, and nothing to select them
 * for except reading or fixing the URL. A flat list of two dozen URLs under the
 * site map is a wall that pushes the site map up and out of view, and answers
 * none of the questions someone opens it with - which of these is used, which
 * of these is broken, which of these is the same link twice.
 */
export function ExternalPagesButton({
  count,
  issueCount = 0,
  onClick,
}: ExternalPagesButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full h-9 px-3 rounded-md text-xs text-left",
        "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
      )}
    >
      <Earth size={14} className="shrink-0 text-fg-secondary-alt" aria-hidden />
      <span className="font-medium">External pages</span>
      <span className="text-fg-secondary-alt tabular-nums">{count}</span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        {issueCount > 0 && (
          <span
            className="min-w-[1rem] h-4 px-1 grid place-items-center rounded bg-bg-warning-primary text-fg-warning-primary text-[0.625rem] font-semibold tabular-nums"
            title={`${issueCount} URL${issueCount === 1 ? "" : "s"} to look at`}
          >
            {issueCount}
          </span>
        )}
        <ChevronRight size={14} aria-hidden className="text-fg-secondary-alt" />
      </span>
    </button>
  );
}
