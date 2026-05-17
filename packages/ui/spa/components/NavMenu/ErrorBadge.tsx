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
  /** Optional element wrapping the badge inside the tooltip trigger, for
   * cases where the badge sits inside a button row. */
  asChild?: boolean;
  /** Optional override className for the badge element. */
  className?: string;
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
}: ErrorBadgeProps) {
  if (count <= 0) return null;
  const label = formatCount(count);
  const tip = buildTooltip({ count, ownCount, firstMessage });
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

function formatCount(count: number): ReactNode {
  if (count > 99) return "99+";
  return count;
}

function buildTooltip({
  count,
  ownCount,
  firstMessage,
}: {
  count: number;
  ownCount: number;
  firstMessage?: string;
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
  return <span>{count === 1 ? "1 error below" : `${count} errors below`}</span>;
}
