import { Info, PanelRight, Sparkles } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { PreviewButton, PublishButton } from "./TopBar";

/**
 * The sticky mobile bottom bar. Preview and Publish are always reachable
 * here; auto save, dev mode and branch move behind the status button rather
 * than taking a permanent row.
 *
 * The assistant is here too, rather than in the top bar. On a phone the top
 * right corner is the furthest point from a thumb, and it was sharing that
 * corner with navigation, notifications and the account avatar - four icons in
 * the row you reach for least. The top bar drops its Sparkles button below the
 * mobile breakpoint, so there is still only one.
 */
export function MobileBottomBar({
  pendingChanges,
  onPreview,
  previewHref,
  onPublish,
  publishSlot,
  onOpenStatus,
  onOpenQuickActions,
  onOpenAI,
  isAIOpen,
  onToggleCanvas,
  isCanvasOpen,
  canvasActionLabel,
  onExitCanvas,
}: {
  pendingChanges: number;
  onPreview: () => void;
  /** The preview URL, so "Open in a new tab" is a link. See `PreviewButton`. */
  previewHref?: string;
  onPublish: () => void;
  /** The real publish control, when there is one. See `TopBarProps`. */
  publishSlot?: ReactNode;
  onOpenStatus: () => void;
  /**
   * Quick actions — the same panel the top bar opens above the mobile
   * breakpoint. It holds the validation errors, Review changes, New page and
   * Upload media, none of which were reachable on a phone at all.
   */
  onOpenQuickActions?: () => void;
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
    <div className="absolute z-full bottom-0 inset-x-0 flex items-center gap-2 px-3 py-2.5 bg-bg-float border-t border-border-float">
      <button
        type="button"
        onClick={onOpenStatus}
        aria-label="Status and settings"
        className="grid place-items-center w-9 h-9 shrink-0 rounded-md text-fg-secondary border border-border-float"
      >
        <Info size={16} />
      </button>
      {onOpenQuickActions && (
        <button
          type="button"
          onClick={onOpenQuickActions}
          aria-label="Quick actions"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-float text-fg-secondary"
        >
          <PanelRight size={16} />
        </button>
      )}
      {onOpenAI && (
        <button
          type="button"
          onClick={onOpenAI}
          aria-label="AI assistant"
          aria-pressed={isAIOpen}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-float",
            // The open state is shown the same way the top bar's icon buttons
            // show it, so the assistant looks open in the same way everywhere.
            isAIOpen
              ? "bg-bg-float-raised text-fg-primary"
              : "text-fg-secondary",
          )}
        >
          <Sparkles size={16} />
        </button>
      )}
      {/*
       * The same control as on desktop, not a second design of it.
       *
       * A phone had a canvas icon and a Preview button side by side, which made
       * "show me the page" a choice about chrome rather than about the page —
       * the exact thing the split button was built to stop. It also meant the
       * two behaviours drifted: the desktop menu explains what each one does and
       * the phone's pair of icons explained nothing.
       */}
      {/*
       * `min-w-0` on both, because a flex item's default minimum is its own
       * content: without it neither of these can shrink below its label, and
       * the row - three 36px icons, two labelled controls and the gaps between
       * them - overflows a 320px phone and takes Publish off the edge. With it
       * they give up width in step, and each clips its own label (the Preview
       * split button is already `overflow-hidden`; Publish truncates).
       */}
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
      {publishSlot ?? (
        <PublishButton
          pendingChanges={pendingChanges}
          onPublish={onPublish}
          className="h-9 min-w-0 flex-1"
        />
      )}
    </div>
  );
}
