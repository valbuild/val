import {
  AlertTriangle,
  ExternalLink,
  Info,
  Lock,
  Mail,
  PauseCircle,
  X,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import type { PlanAction } from "./planCopy";
import type { PlanNotice } from "./planNotices";

const ICONS = {
  lock: Lock,
  alert: AlertTriangle,
  pause: PauseCircle,
  info: Info,
};

const TONE_TEXT: Record<PlanNotice["tone"], string> = {
  critical: "text-fg-error-on-surface",
  warning: "text-fg-warning-primary",
  info: "text-fg-primary",
};

const TONE_FILL: Record<PlanNotice["tone"], string> = {
  critical: "bg-fg-error-on-surface",
  warning: "bg-fg-warning-primary",
  info: "bg-bg-brand-primary",
};

/** A plan action, as a link that looks like a button. */
export function PlanActionLink({
  action,
  primary,
  size = "md",
}: {
  action: PlanAction;
  primary: boolean;
  size?: "sm" | "md";
}) {
  return (
    <a
      href={action.href}
      target={action.external ? "_blank" : undefined}
      rel={action.external ? "noreferrer" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs font-medium",
        size === "sm" ? "h-6 px-2" : "h-7 px-2.5",
        primary
          ? "border border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover"
          : "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
      )}
    >
      {action.external ? null : <Mail size={12} />}
      {action.label}
      {action.external ? <ExternalLink size={12} /> : null}
    </a>
  );
}

/**
 * One plan notice, above the editor: what happened, and the next step beside
 * it. The same surface as `RemoteFilesCard` and `AccountErrorNotice`, so it
 * reads as part of the Studio rather than as something breaking it; the
 * colour is the icon and the title.
 */
export function PlanNoticeCard({
  notice,
  onDismiss,
}: {
  notice: PlanNotice;
  onDismiss?: () => void;
}) {
  const Icon = ICONS[notice.icon];
  const dismissible = notice.dismiss !== null && onDismiss !== undefined;
  return (
    <section
      role="status"
      aria-label={notice.title}
      className={cn(
        "relative rounded-lg border bg-bg-tertiary p-4",
        dismissible && "pr-10",
      )}
    >
      {dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="absolute right-2 top-2 rounded p-1 text-fg-secondary hover:bg-bg-float-raised"
        >
          <X size={14} />
        </button>
      )}
      <div className="flex gap-3">
        <Icon
          size={16}
          className={cn("mt-0.5 shrink-0", TONE_TEXT[notice.tone])}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", TONE_TEXT[notice.tone])}>
            {notice.title}
          </p>
          <p className="mt-1 text-xs text-fg-secondary">{notice.body}</p>
          {notice.meter !== null && (
            <div
              role="meter"
              aria-label="Used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(notice.meter * 100)}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-secondary"
            >
              <div
                className={cn("h-full rounded-full", TONE_FILL[notice.tone])}
                style={{ width: `${Math.round(notice.meter * 100)}%` }}
              />
            </div>
          )}
          {(notice.action !== null || notice.aside !== null) && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {notice.action !== null && (
                <PlanActionLink
                  action={notice.action}
                  primary={notice.tone !== "critical"}
                />
              )}
              {notice.aside !== null && (
                <span className="text-xs text-fg-secondary">
                  {notice.aside}
                </span>
              )}
            </div>
          )}
          {notice.details !== null && (
            <details className="mt-3 text-xs text-fg-secondary">
              <summary className="cursor-pointer">Details</summary>
              <p className="mt-1 break-words">{notice.details}</p>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
