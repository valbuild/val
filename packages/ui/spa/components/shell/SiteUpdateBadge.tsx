import { Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";
import { badgeText, type SiteUpdateIndicator } from "./siteUpdateIndicator";

/**
 * The site update's mark: on the corner of the Quick actions button (top bar
 * and phone bar), and inline at the end of the Show updates row, so the button
 * and the row it leads to carry the same thing.
 *
 * In the brand colour rather than the bell's neutral one: the bell counts
 * things to read, this counts something to do. Decorative -- the button's and
 * the row's labels say the same in words (see `siteUpdateActionLabel`).
 */
export function SiteUpdateBadge({
  indicator,
  placement,
}: {
  indicator: SiteUpdateIndicator;
  /** `corner` sits over an icon button's top right; `inline` is in a row. */
  placement: "corner" | "inline";
}) {
  const position =
    placement === "corner" ? "absolute -top-0.5 -right-0.5" : "shrink-0";
  switch (indicator.kind) {
    case "count":
      return (
        <span
          aria-hidden
          data-testid="site-update-badge"
          className={cn(
            position,
            "min-w-[1rem] h-4 px-1 grid place-items-center rounded-full bg-bg-brand-primary text-fg-brand-primary text-[0.625rem] font-semibold tabular-nums",
          )}
        >
          {badgeText(indicator.count)}
        </span>
      );
    case "dot":
    case "attention":
      return (
        <span
          aria-hidden
          data-testid="site-update-badge"
          className={cn(
            position,
            placement === "corner" ? "top-0 right-0" : "",
            "w-2 h-2 rounded-full",
            indicator.kind === "dot"
              ? "bg-bg-brand-primary"
              : "bg-bg-error-primary",
          )}
        />
      );
    case "busy":
      return (
        <Loader2
          aria-hidden
          data-testid="site-update-badge"
          size={placement === "corner" ? 10 : 13}
          className={cn(
            position,
            "animate-spin text-fg-secondary",
            placement === "corner" ? "top-0 right-0" : "",
          )}
        />
      );
  }
}
