import { Bell, ChevronDown, Sparkles } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { PreviewButton } from "./TopBar";

/**
 * Where a note floating over the bottom of the Studio is anchored, so it
 * clears whichever bar is along the bottom edge.
 *
 * `4rem` - what these notes always sat at, above the status bar - wherever the
 * safe area is under `0.75rem`, which is every desktop. On a phone whose page
 * opts into `viewport-fit=cover` the bottom bar rises with the safe area (see
 * `MobileBottomBar`: `max(0.75rem, safe area)` up, 50px tall), and a fixed
 * `bottom-16` ended up under it. This rises with it, 2px clear.
 */
export const CLEAR_OF_BOTTOM_BARS =
  "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.25rem)]";

/**
 * The floating mobile bottom bar: what you DO, where the thumb is.
 *
 * Four controls whatever is switched on, so it never overflows a 320px phone:
 * the assistant, the activity bell, Preview, and ONE primary action with a
 * caret for the rest of what can be done with the changes (`ChangesSheet`).
 * Where you are is the top bar's job, and so is navigating; the account, the
 * theme and the deploy feed are behind the avatar. Each of those used to have
 * a second way in from here as well (a status button that opened the account
 * sheet, and Quick actions), and the bar overflowed in a proposal with code to
 * build: Preview was covered and Save was pushed off the screen.
 *
 * The assistant is here too, rather than in the top bar. On a phone the top
 * right corner is the furthest point from a thumb. The top bar drops its
 * Sparkles button below the mobile breakpoint, so there is still only one.
 */
export function MobileBottomBar({
  onPreview,
  previewHref,
  primary,
  onOpenChanges,
  isChangesOpen,
  onOpenActivity,
  isActivityOpen,
  activityCount,
  onOpenAI,
  isAIOpen,
  onToggleCanvas,
  isCanvasOpen,
  canvasActionLabel,
  onExitCanvas,
}: {
  onPreview: () => void;
  /** The preview URL, so "Open in a new tab" is a link. See `PreviewButton`. */
  previewHref?: string;
  /**
   * The one action this bar has room for: Publish on the site, and in a
   * proposal whichever of Fix, Save, Build and Publish comes next. See
   * `Shell`'s `mobilePrimary`.
   */
  primary: ReactNode;
  /** The rest of what can be done with the changes. See `ChangesSheet`. */
  onOpenChanges: () => void;
  isChangesOpen?: boolean;
  /** Notifications, validation errors and history. See `ActivitySheet`. */
  onOpenActivity: () => void;
  isActivityOpen?: boolean;
  /** Unread notifications plus validation errors: what is asking to be seen. */
  activityCount: number;
  /**
   * Open the assistant.
   *
   * Absent when the project has no assistant configured — see
   * `ShellProps.aiEnabled` — and the button is then not offered at all, the
   * same rule the top bar's follows.
   */
  onOpenAI?: () => void;
  /** Whether the assistant panel is the one currently open. */
  isAIOpen?: boolean;
  /** Absent when the selection has no route Val can put on a canvas. */
  onToggleCanvas?: () => void;
  isCanvasOpen?: boolean;
  /** What the canvas half does next. See `PreviewButton`. */
  canvasActionLabel?: string;
  /** Leaving the canvas, where that is a separate act. See `PreviewButton`. */
  onExitCanvas?: () => void;
}) {
  return (
    /*
     * Floating, like the top bar, rather than a strip across the bottom edge.
     *
     * Flush with the edge, the bar's left and right ends and its buttons'
     * bottom borders ran into the phone's rounded screen corners and were cut
     * off. Inset on all sides with its own full border, the whole of it is on
     * screen. `max(…, env(safe-area-inset-bottom))` so a page that opts into
     * `viewport-fit=cover` does not put it under the home indicator.
     *
     * `p-1.5` + `rounded-xl` keeps the corners concentric with the buttons'
     * `rounded-md`, and keeps the bar's top edge (12px + 50px) under
     * `CLEAR_OF_BOTTOM_BARS`, where the notes floating above it are anchored.
     */
    <div className="absolute z-full inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-1.5 p-1.5 bg-bg-float border border-border-float rounded-xl shadow-lg">
      {onOpenAI && (
        <BarIconButton
          label="AI assistant"
          onClick={onOpenAI}
          pressed={isAIOpen}
          // The assistant step points here on a phone, where the top bar's
          // button is not drawn. Only one of the two is ever on screen, so the
          // tour's lookup cannot find the wrong one.
          tourTarget="ai"
        >
          <Sparkles size={16} />
        </BarIconButton>
      )}
      <BarIconButton
        label={activityCount > 0 ? `Activity (${activityCount})` : "Activity"}
        onClick={onOpenActivity}
        pressed={isActivityOpen}
      >
        <Bell size={16} />
        {activityCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 grid place-items-center rounded-full bg-fg-primary text-bg-float text-[0.625rem] font-semibold tabular-nums"
          >
            {activityCount > 9 ? "9+" : activityCount}
          </span>
        )}
      </BarIconButton>
      {/*
       * The same control as on desktop, not a second design of it: the main
       * half acts, the caret offers the other way to see the page.
       *
       * Wrapped so the tour has something to point at on a phone, where the top
       * bar's copies of these are not drawn — the same markers `TopBar` puts on
       * its own. Only one bar is ever rendered, so the lookup cannot find both.
       * `flex-1 min-w-0` is on the wrapper, or the control inside it could not
       * give up width: Preview is the one control here that shrinks, and it
       * clips its own label rather than push the primary off the edge.
       */}
      <span data-val-tour="preview" className="flex min-w-0 flex-1">
        <PreviewButton
          onPreview={onPreview}
          previewHref={previewHref}
          onToggleCanvas={onToggleCanvas}
          isCanvasOpen={isCanvasOpen}
          canvasActionLabel={canvasActionLabel}
          onExitCanvas={onExitCanvas}
          menuPlacement="above"
          alwaysShowLabel
          className="h-9 min-w-0 flex-1"
        />
      </span>
      {/*
       * NOT wrapped for the tour, unlike Preview above: the publish control is
       * the app's own (`publishSlot`) and carries a minimum width a wrapper
       * cannot talk it out of. The publish STEP centres its card on a phone,
       * which is what every step does where its control is not drawn.
       */}
      {primary}
      <BarIconButton
        label="More for these changes"
        onClick={onOpenChanges}
        pressed={isChangesOpen}
      >
        <ChevronDown size={16} />
      </BarIconButton>
    </div>
  );
}

function BarIconButton({
  label,
  onClick,
  pressed,
  tourTarget,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  tourTarget?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      data-val-tour={tourTarget}
      className={cn(
        "relative grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-float",
        // The open state is shown the same way the top bar's icon buttons
        // show it, so a panel looks open in the same way everywhere.
        pressed ? "bg-bg-float-raised text-fg-primary" : "text-fg-secondary",
      )}
    >
      {children}
    </button>
  );
}
