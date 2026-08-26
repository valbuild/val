import {
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  UploadCloud,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import {
  ShellBreakpoint,
  ShellNotification,
  ShellNotificationKind,
} from "./types";

export type NotificationsPanelProps = {
  breakpoint: ShellBreakpoint;
  notifications: ShellNotification[];
  onSelect: (notification: ShellNotification) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
};

const KIND_ICON: Record<ShellNotificationKind, typeof FileText> = {
  content: FileText,
  media: ImageIcon,
  publish: UploadCloud,
  validation: AlertTriangle,
};

/** The notification centre: content changes, uploads, publishes, errors. */
export function NotificationsPanel({
  breakpoint,
  notifications,
  onSelect,
  onMarkAllRead,
  onClose,
}: NotificationsPanelProps) {
  const unread = notifications.filter((n) => n.unread).length;
  return (
    <FloatingPanel
      side="right"
      width={320}
      title="Notifications"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      headerAction={
        unread > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="h-7 px-2 rounded-md text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            Mark all read
          </button>
        ) : undefined
      }
    >
      {notifications.length === 0 ? (
        <PanelEmptyState>Nothing new. You are all caught up.</PanelEmptyState>
      ) : (
        <ul className="divide-y divide-border-float">
          {notifications.map((notification) => {
            const Icon = KIND_ICON[notification.kind];
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => onSelect(notification)}
                  className="flex gap-2.5 w-full px-4 py-2.5 text-left hover:bg-bg-float-raised"
                >
                  <span
                    className={cn(
                      "grid place-items-center w-6 h-6 mt-0.5 shrink-0 rounded-md",
                      notification.kind === "validation"
                        ? "bg-bg-error-primary text-fg-error-primary"
                        : "bg-bg-float-raised text-fg-secondary",
                    )}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-fg-primary">
                      {notification.title}
                    </span>
                    <span className="block text-[0.6875rem] text-fg-secondary-alt">
                      {notification.timestamp}
                    </span>
                  </span>
                  {notification.unread && (
                    <span
                      aria-label="Unread"
                      className="w-1.5 h-1.5 mt-1.5 shrink-0 rounded-full bg-fg-secondary"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </FloatingPanel>
  );
}
