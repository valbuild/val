import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../designSystem/cn";

/**
 * A notice that pops up from below rather than sitting above the editor:
 * where the Studio is (an upgrade proposal, an upgrade under way, a code
 * restore) rather than about the field in front of you, so it should not push
 * that field down the page. It stays until it is dismissed, and a dismissed
 * one folds into the status bar, from which it comes back.
 *
 * Plain data, like the rest of what the shell is handed: what to show, and
 * what to call it once folded.
 */
export type FloatingNoticeItem = {
  /**
   * Which notice this is, and which version of it. A notice whose words
   * change (an upgrade that finishes being worked out, a restore that
   * fails) gets a new id, so it comes back even if the old one was
   * dismissed: it is news again.
   */
  id: string;
  /** Its name in the status bar once dismissed: "About this upgrade". */
  label: string;
  /** Small, for the status bar chip. */
  icon: ReactNode;
  content: ReactNode;
};

/**
 * The open notices, bottom right above the status bar, newest at the
 * bottom. Under the panels (`z-window`, below their `z-full`): a panel
 * opened over one covers it rather than the other way round.
 */
export function FloatingNotices({
  notices,
  onDismiss,
  className,
}: {
  notices: FloatingNoticeItem[];
  onDismiss: (id: string) => void;
  className?: string;
}) {
  if (notices.length === 0) return null;
  return (
    <div
      className={cn(
        "absolute z-window flex w-[28rem] max-w-[calc(100%-1.5rem)] flex-col gap-2",
        className,
      )}
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            "relative rounded-lg bg-bg-float shadow-xl",
            "animate-in fade-in-0 slide-in-from-bottom-4 duration-300",
            // Room for the dismiss button in the notice's own heading.
            "[&>section]:pr-10",
          )}
        >
          {notice.content}
          <button
            type="button"
            aria-label={`Dismiss: ${notice.label}`}
            title="Dismiss. It stays in the status bar."
            onClick={() => onDismiss(notice.id)}
            className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A dismissed notice, folded into the status bar: pressing it brings it back. */
export function FoldedNoticeChip({
  notice,
  onOpen,
}: {
  notice: FloatingNoticeItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Show it again"
      className="inline-flex items-center gap-1.5 text-fg-proposal hover:underline"
    >
      {notice.icon}
      {notice.label}
    </button>
  );
}
