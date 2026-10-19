import { cn } from "../../designSystem/cn";
import { PlanActionLink } from "./PlanNoticeCard";
import { planStatusParts, type PlanStatus } from "./planStatus";

/**
 * The plan's status, compact: in the top bar on a desktop, above the editor
 * below that (the bar has no room for it there). "Trial · 9 days left · ●●○
 * 1 of 3 publishes · 4% of trial usage  [Add a card]".
 */
export function PlanStatusBar({
  status,
  placement,
  locale,
}: {
  status: PlanStatus;
  placement: "top-bar" | "column";
  locale?: string;
}) {
  const parts = planStatusParts(status, { locale });
  const badge = status.kind === "free" ? "Free" : "Trial";
  const action = status.kind === "trial-with-card" ? null : status.action;
  const summary = `${badge}: ${parts.join(", ")}`;
  return (
    <div
      role="status"
      aria-label={summary}
      title={summary}
      className={cn(
        "flex min-w-0 items-center gap-2 text-xs",
        placement === "column" &&
          "flex-wrap rounded-lg border bg-bg-tertiary px-3 py-2",
      )}
    >
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
          status.kind === "free"
            ? "bg-bg-secondary text-fg-primary"
            : "bg-bg-brand-primary text-fg-brand-primary",
        )}
      >
        {badge}
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-2",
          placement === "top-bar" ? "truncate" : "flex-wrap",
        )}
      >
        {parts.map((part, index) => (
          <span
            key={part}
            className={cn(
              "inline-flex items-center gap-2",
              index === 0 ? "text-fg-primary" : "text-fg-secondary",
              placement === "top-bar" && "whitespace-nowrap",
            )}
          >
            {index > 0 && <span aria-hidden>·</span>}
            {status.kind === "trial" && index === 1 && (
              <PublishDots
                used={status.publishesUsed}
                total={status.publishesTotal}
              />
            )}
            {part}
          </span>
        ))}
      </span>
      {action !== null && (
        <PlanActionLink action={action} primary={false} size="sm" />
      )}
    </div>
  );
}

function PublishDots({ used, total }: { used: number; total: number }) {
  return (
    <span aria-hidden className="inline-flex gap-0.5">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 w-2.5 rounded-full",
            index < used ? "bg-bg-brand-primary" : "bg-bg-secondary",
          )}
        />
      ))}
    </span>
  );
}
