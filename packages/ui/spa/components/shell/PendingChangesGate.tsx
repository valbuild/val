import { ReactNode, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";

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
 * - **`inert`, not `disabled`.** `disabled` would repaint every control and
 *   change what a click does per widget; `inert` takes the subtree out of the
 *   tab order and swallows events in one place, without touching how anything
 *   looks. (Set via a ref because React 18 does not forward the attribute.)
 * - **Once.** It is the FIRST load that is uncertain. After that the editor
 *   holds real values, and dimming on every patch from another tab would be a
 *   flicker carrying no information.
 *
 * The note says what is happening, because an editor who reaches for a field
 * that will not focus deserves better than guessing.
 */
export function PendingChangesGate({
  ready,
  children,
}: {
  /** Whether the first load's patches have been applied. */
  ready: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    node.inert = !ready;
    return () => {
      node.inert = false;
    };
  }, [ready]);
  return (
    <div ref={ref} className="contents" aria-busy={!ready}>
      {/*
       * The dimming is on an inner wrapper rather than on the `contents` node
       * above, because `display: contents` has no box to style — and the node
       * has to be `contents` so this gate cannot change the editor's layout.
       */}
      {/*
       * No height of its own: this wrapper sits inside whatever layout the
       * editor already has, and imposing `h-full` on it made it a box the
       * column had to size around.
       */}
      <div
        className={cn(
          "transition-opacity duration-200",
          ready ? "opacity-100" : "opacity-60",
        )}
      >
        {children}
      </div>
      {!ready && <LoadingNote />}
    </div>
  );
}

/**
 * Where the note goes: over the editor, out of the way of the content.
 *
 * `absolute` so it cannot push anything — the entire design of this gate is
 * that nothing moves — and low contrast, because it is an explanation rather
 * than a warning.
 */
function LoadingNote() {
  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 z-hover -translate-x-1/2">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border-float bg-bg-float px-2.5 py-1 text-xs text-fg-secondary shadow-sm">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        Loading unpublished changes…
      </span>
    </div>
  );
}
