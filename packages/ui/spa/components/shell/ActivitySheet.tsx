import { AlertTriangle, History, Inbox, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { cn } from "../designSystem/cn";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import { NotificationList } from "./NotificationsPanel";
import { SheetRow } from "./PhoneSheet";
import { ActivityList, ValidationErrorList } from "./UtilityPanel";
import {
  ShellActivityEntry,
  ShellBreakpoint,
  ShellChangeActivity,
  ShellNotification,
  ShellValidationError,
} from "./types";

type ActivityTab = "inbox" | "errors" | "history";
type ActivityTabItem = { id: ActivityTab; label: string; count: number };

/**
 * Everything to LOOK AT, on a phone: the sheet behind the bottom bar's bell.
 *
 * Above a phone these are four controls - the bell, the validate shield, the
 * history clock and the recent activity in Quick actions. A phone has room for
 * one, so they are one button with one count, and three tabs behind it. The
 * lists are the panels' own (`NotificationList`, `ValidationErrorList`,
 * `ActivityList`), so a row reads and leads the same way at every width.
 */
export function ActivitySheet({
  breakpoint,
  notifications,
  onSelectNotification,
  onMarkAllRead,
  validationErrors,
  onSelectValidationError,
  onOpenValidate,
  activity,
  onSelectActivity,
  onOpenHistory,
  onClose,
}: {
  breakpoint: ShellBreakpoint;
  /** Absent where there is no notification feed: no Inbox tab then. */
  notifications?: ShellNotification[];
  onSelectNotification: (notification: ShellNotification) => void;
  onMarkAllRead: () => void;
  validationErrors: ShellValidationError[];
  onSelectValidationError: (error: ShellValidationError) => void;
  /** The full errors view. Absent: the list here is all there is. */
  onOpenValidate?: () => void;
  /** Absent while the patch sets are still loading. */
  activity?: ShellActivityEntry[];
  onSelectActivity: (entry: ShellChangeActivity) => void;
  /** The publish history page. Absent where there is no history (fs mode). */
  onOpenHistory?: () => void;
  onClose: () => void;
}) {
  const unread = (notifications ?? []).filter((n) => n.unread).length;
  const errors = validationErrors.reduce((sum, e) => sum + e.count, 0);
  // Opens on whatever is asking for attention, in the order the badge counts
  // it: unread first, then errors, and history when nothing is.
  const [tab, setTab] = useState<ActivityTab>(
    notifications !== undefined && unread > 0
      ? "inbox"
      : errors > 0
        ? "errors"
        : "history",
  );
  const inbox: ActivityTabItem[] =
    notifications !== undefined
      ? [{ id: "inbox", label: "Inbox", count: unread }]
      : [];
  const tabs: ActivityTabItem[] = [
    ...inbox,
    { id: "errors", label: "Errors", count: errors },
    { id: "history", label: "History", count: 0 },
  ];
  const close = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <FloatingPanel
      side="right"
      width={320}
      title="Activity"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      headerAction={
        tab === "inbox" && unread > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="h-7 px-2 rounded-md text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            Mark all read
          </button>
        ) : undefined
      }
      subheader={
        <div
          role="tablist"
          aria-label="Activity"
          className="flex gap-0.5 p-0.5 rounded-md bg-bg-float-raised"
        >
          {tabs.map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded text-xs",
                tab === id
                  ? "bg-bg-float text-fg-primary shadow-sm font-medium"
                  : "text-fg-secondary",
              )}
            >
              {id === "inbox" ? (
                <Inbox size={13} />
              ) : id === "errors" ? (
                <AlertTriangle size={13} />
              ) : (
                <History size={13} />
              )}
              {label}
              {count > 0 && (
                <span className="tabular-nums opacity-70">{count}</span>
              )}
            </button>
          ))}
        </div>
      }
    >
      <div className="pb-4">
        {tab === "inbox" && (
          <NotificationList
            notifications={notifications ?? []}
            onSelect={onSelectNotification}
          />
        )}
        {tab === "errors" &&
          (validationErrors.length === 0 ? (
            <PanelEmptyState>
              No validation errors. Nothing is holding back a publish.
            </PanelEmptyState>
          ) : (
            <div className="pt-2">
              <ValidationErrorList
                validationErrors={validationErrors}
                onSelect={(error) => {
                  onClose();
                  onSelectValidationError(error);
                }}
              />
              {onOpenValidate !== undefined && (
                <SheetRow
                  icon={<ShieldCheck size={16} />}
                  onClick={close(onOpenValidate)}
                >
                  Open every error
                </SheetRow>
              )}
            </div>
          ))}
        {tab === "history" && (
          <div className="pt-2">
            <ActivityList
              activity={activity ?? []}
              onSelect={(entry) => {
                onClose();
                onSelectActivity(entry);
              }}
            />
            {onOpenHistory !== undefined && (
              <SheetRow
                icon={<History size={16} />}
                detail="Every publish, and a way back to any of them"
                onClick={close(onOpenHistory)}
              >
                Published versions
              </SheetRow>
            )}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
