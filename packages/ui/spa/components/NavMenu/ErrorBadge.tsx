import { ReactNode } from "react";
import { cn } from "../designSystem/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";

export type ErrorBadgeProps = {
  /** Total error count to display in the badge. */
  count: number;
  /** Number that resolve to this row itself (vs. descendants). Drives the
   * tooltip wording. */
  ownCount: number;
  /** First error message — shown verbatim when ownCount > 0. */
  firstMessage?: string;
  /** Force the badge to render with smaller height (used in nested rows). */
  size?: "sm" | "md";
  /** Optional override className for the badge element. */
  className?: string;
  /**
   * Where the aggregated errors are, relative to this badge. Only used when
   * every error belongs to a descendant rather than to the badge's own row.
   *
   * A row badge sits above the rows that carry the errors, so "below" is right
   * there. A SECTION header badge sits above a whole collapsed section, and its
   * errors are inside it, not below it - `"in this section"` says that.
   */
  aggregateLocation?: string;
};

/**
 * The red pill used everywhere in the nav menu to indicate validation
 * errors. Tooltip on hover/focus shows the first error message (for own
 * errors) or an aggregate hint (for descendants).
 *
 * Relies on the TooltipProvider mounted in `ValProvider`.
 */
export function ErrorBadge({
  count,
  ownCount,
  firstMessage,
  size = "sm",
  className,
  aggregateLocation = "below",
}: ErrorBadgeProps) {
  if (count <= 0) return null;
  const label = formatCount(count);
  const tip = buildTooltip({
    count,
    ownCount,
    firstMessage,
    aggregateLocation,
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "shrink-0 inline-flex items-center justify-center rounded-full",
            "bg-bg-error-secondary text-fg-error-secondary",
            "font-sans tabular-nums font-medium",
            size === "sm"
              ? "min-w-[16px] h-[16px] px-1 text-[10px] leading-none"
              : "min-w-[18px] h-[18px] px-1.5 text-[11px] leading-none",
            className,
          )}
          aria-label={`${count} validation error${count === 1 ? "" : "s"}`}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="max-w-[280px] text-xs"
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Wording for the aggregate-only tooltip - every error belongs to something
 * other than this badge's own row.
 *
 * Exported because it is the part worth testing: `packages/ui` has no
 * `jest-environment-jsdom`, so the badge itself cannot be rendered in this
 * suite, and the wording is what the review was about.
 */
export function aggregateTooltipText(
  count: number,
  aggregateLocation: string,
): string {
  return count === 1
    ? `1 error ${aggregateLocation}`
    : `${count} errors ${aggregateLocation}`;
}

function formatCount(count: number): ReactNode {
  if (count > 99) return "99+";
  return count;
}

function buildTooltip({
  count,
  ownCount,
  firstMessage,
  aggregateLocation,
}: {
  count: number;
  ownCount: number;
  firstMessage?: string;
  aggregateLocation: string;
}): ReactNode {
  if (ownCount > 0 && firstMessage) {
    if (ownCount === 1 && count === 1) {
      return <span>{firstMessage}</span>;
    }
    return (
      <span>
        <span className="block">{firstMessage}</span>
        <span className="block text-fg-secondary mt-1">
          {count === 1
            ? "1 error"
            : ownCount === count
              ? `${count} errors`
              : `${count} errors total (${ownCount} here)`}
        </span>
      </span>
    );
  }
  // Aggregate-only: descendants carry the errors.
  return <span>{aggregateTooltipText(count, aggregateLocation)}</span>;
}
