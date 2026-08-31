import { ReactNode, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  ChainProgress,
  describePendingChangesStall,
} from "../../utils/describePendingChangesStall";
import { PendingWriteHoldProvider } from "../PendingWriteHold";

/**
 * How long to wait before the note becomes a report.
 *
 * The wait is unbounded by nature: a `GET /patches` that never answers leaves
 * the chain unsettled for as long as the tab is open. A spinner is then a lie
 * told forever — which is what happened, and the only recovery anyone found was
 * to delete every patch on the server.
 */
export const PENDING_CHANGES_DEADLINE_MS = 60_000;

/**
 * Hold the fields until the server's pending changes have been applied.
 *
 * On the first paint a field can be showing PUBLISHED content while a change to
 * it is still on its way from the server. That is not a cosmetic flash: it reads
 * as a stale value, so an editor "fixes" it — and the real value lands
 * underneath the fix a moment later. Now their edit is on top of an edit they
 * never saw, and nothing on screen ever said the field was not ready.
 *
 * So the fields are held. Deliberately quiet about it:
 *
 * - **Opacity, not a skeleton.** A placeholder that becomes a field changes
 *   every height on the page, and the whole point is to avoid the content
 *   appearing to move. Dimming takes up exactly the same space.
 * - **Editing, not the editor.** The hold used to be `inert` on this whole
 *   subtree, which took out everything in it — including the links. A record's
 *   rows, the scope trail in the header, a reference: all navigation, none of it
 *   able to write anything, and all of it dead while waiting. What has to be
 *   held is the WRITE, so the hold is now a flag the fields read and turn into
 *   the readonly they already implement (see `PendingWriteHold` and
 *   `ReadonlyGuard`), and everything that only navigates keeps working.
 * - **Once.** It is the FIRST load that is uncertain. After that the editor
 *   holds real values, and dimming on every patch from another tab would be a
 *   flicker carrying no information.
 * - **Never forever.** Past {@link PENDING_CHANGES_DEADLINE_MS} the note becomes
 *   a report naming what did not arrive, and the hold is released: at that point
 *   refusing to let someone work is a worse answer than letting them work with a
 *   warning. It can also be dismissed at any time, for the same reason.
 */
export function PendingChangesGate({
  ready,
  progress,
  fetchError,
  children,
}: {
  /** Whether the first load's patches have been applied. */
  ready: boolean;
  /**
   * What is outstanding, read when the deadline passes.
   *
   * A function rather than a value: it is only needed in the failure case, and
   * as a prop it would re-render the whole editor on every chain change.
   */
  progress: () => ChainProgress;
  /** The last error from fetching patches, if there was one. */
  fetchError: string | null;
  children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [stalled, setStalled] = useState<ReturnType<
    typeof describePendingChangesStall
  > | null>(null);

  /*
   * The deadline is armed once, and reads the diagnostics when it fires.
   *
   * `progress` and `fetchError` are held in refs — assigned in an effect, not
   * during render — precisely so they are NOT dependencies of the timer. As
   * dependencies they would re-arm it on every chain change, and a chain that
   * moves every few seconds would push the deadline out forever, which is the
   * unbounded wait this is here to end.
   */
  const latest = useRef({ progress, fetchError });
  useEffect(() => {
    latest.current = { progress, fetchError };
  });
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => {
      const { progress: read, fetchError: lastError } = latest.current;
      setStalled(describePendingChangesStall(read(), lastError));
    }, PENDING_CHANGES_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const held = !ready && !dismissed && stalled === null;

  return (
    <PendingWriteHoldProvider held={held}>
      {/*
       * `display: contents` so this gate cannot change the editor's layout, and
       * the dimming on an inner wrapper because a `contents` node has no box to
       * style.
       */}
      <div className="contents" aria-busy={held}>
        {/*
         * No height of its own: this wrapper sits inside whatever layout the
         * editor already has, and imposing `h-full` on it made it a box the
         * column had to size around.
         */}
        <div
          className={cn(
            "transition-opacity duration-200",
            held ? "opacity-60" : "opacity-100",
          )}
        >
          {children}
        </div>
        {held && <LoadingNote onDismiss={() => setDismissed(true)} />}
        {!ready && stalled !== null && !dismissed && (
          <StallReport
            summary={stalled.summary}
            detail={stalled.detail}
            onDismiss={() => setDismissed(true)}
          />
        )}
      </div>
    </PendingWriteHoldProvider>
  );
}

/**
 * Where the note goes: over the editor, out of the way of the content.
 *
 * `absolute` so it cannot push anything — the entire design of this gate is
 * that nothing moves — and low contrast, because it is an explanation rather
 * than a warning. The dismiss is part of it because a wait with no way out is
 * the failure this is recovering from; `pointer-events` come back for the button
 * alone, so the note still cannot swallow a click meant for a field.
 */
function LoadingNote({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 z-hover -translate-x-1/2">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border-float bg-bg-float px-2.5 py-1 text-xs text-fg-secondary shadow-sm">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        Loading unpublished changes…
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Stop waiting for unpublished changes"
          className="pointer-events-auto -mr-1 ml-0.5 grid size-4 place-items-center rounded text-fg-tertiary hover:bg-bg-float-raised hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <X size={11} aria-hidden />
        </button>
      </span>
    </div>
  );
}

/**
 * The same corner, once waiting has stopped being reasonable.
 *
 * Warning-toned rather than error-red: nothing is broken for the editor, and
 * they can carry on — what they need to know is that some changes are missing
 * and that editing now may lose them. The diagnostics are folded into a `details`
 * for the same reason the canvas's setup instructions are: the person reading
 * this is usually not the person who can fix it.
 */
function StallReport({
  summary,
  detail,
  onDismiss,
}: {
  summary: string;
  detail: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="absolute bottom-16 left-1/2 z-hover w-[min(28rem,calc(100%-2rem))] -translate-x-1/2"
    >
      <div className="rounded-md border border-border-float bg-bg-float p-3 shadow-md">
        <div className="flex items-start gap-2">
          <TriangleAlert
            size={14}
            className="mt-0.5 shrink-0 text-fg-warning-primary-alt"
            aria-hidden
          />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-primary">
            {summary}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 grid size-5 shrink-0 place-items-center rounded text-fg-tertiary hover:bg-bg-float-raised hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-xs text-fg-secondary-alt hover:text-fg-primary [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1">
              <ChevronRight
                size={12}
                className="transition-transform group-open:rotate-90"
                aria-hidden
              />
              Diagnostics
            </span>
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border-float bg-bg-secondary p-3 font-mono text-[0.6875rem] leading-relaxed text-fg-secondary">
            {detail}
          </div>
        </details>
      </div>
    </div>
  );
}
