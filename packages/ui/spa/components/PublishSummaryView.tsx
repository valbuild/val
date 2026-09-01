import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "./designSystem/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { cn } from "./designSystem/cn";
import { useValPortal } from "./ValPortalProvider";

/**
 * What the AI is doing about this summary, if anything.
 *
 * `off` is a first-class state, not an error: without a key configured there
 * is no AI, and the publish flow is expected to work exactly as well.
 */
export type AiSummaryState =
  | { status: "off" }
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string; sessionId: string | null }
  | { status: "failed"; message: string; canSetUp?: boolean };

export type PublishSummaryViewProps = {
  /** The text that will be committed. Always editable, never blocked. */
  value: string;
  onChange: (value: string) => void;
  ai: AiSummaryState;
  /** Replace the box with the AI's suggestion. */
  onUseAiSummary: () => void;
  /**
   * Open the chat session that wrote the summary, so the user can ask what
   * changed. Absent when there is no session to open.
   */
  onOpenAiSession?: () => void;
  /** Where to send someone who has no AI configured. */
  onSetUpAi?: () => void;
  onPublish: () => void;
  onClose: () => void;
  publishDisabled: boolean;
  isPublishing: boolean;
  /**
   * Publish was pressed while the AI was still writing. Publishing is already
   * committed to happening — this is the short grace period before it goes
   * ahead with whatever is in the box. Pressing Publish again during it skips
   * the wait, so there is no separate escape control.
   */
  waitingForAiSeconds: number | null;
};

/**
 * The publish summary box.
 *
 * The rule the whole component is built around: **the user is never blocked**.
 * The box arrives filled with a summary that needed no network call, the
 * textarea is editable from the first frame, and everything the AI does is an
 * offer on the side rather than a gate in front. Someone fixing a typo should
 * be able to open this and publish without noticing an AI exists.
 */
export function PublishSummaryView({
  value,
  onChange,
  ai,
  onUseAiSummary,
  onOpenAiSession,
  onSetUpAi,
  onPublish,
  onClose,
  publishDisabled,
  isPublishing,
  waitingForAiSeconds,
}: PublishSummaryViewProps) {
  const className = "w-full p-2 border rounded bg-bg-secondary";
  const isWaiting = waitingForAiSeconds !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Summary</span>
        <AiSummaryButton
          ai={ai}
          // Offered whenever it is not already what is in the box. Gating this
          // on "has the user typed" left a gap: a box restored from a previous
          // session is not the default either, and the suggestion was then
          // neither applied nor offered.
          canApply={ai.status === "ready" && ai.text.trim() !== value.trim()}
          onUseAiSummary={onUseAiSummary}
          onOpenAiSession={onOpenAiSession}
          onSetUpAi={onSetUpAi}
        />
      </div>
      <div className="grid text-xs font-light">
        {/* https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas */}
        <div
          aria-hidden
          className={cn(className, "invisible whitespace-pre-wrap")}
          style={{ gridArea: "1 / 1 / 2 / 2" }}
        >
          {/* Note the weird space! Needed to prevent jumpy behavior */}
          {value + " "}
        </div>
        <textarea
          // Never disabled, not even while the AI is writing or during the
          // grace period: waiting for a model is exactly what this flow is
          // designed not to make anyone do.
          className={cn(className, "resize-none overflow-clip")}
          value={value}
          style={{ gridArea: "1 / 1 / 2 / 2" }}
          placeholder="Write a summary of your changes"
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      </div>
      {isWaiting && (
        <div className="flex items-start gap-2 text-xs text-fg-secondary">
          <Loader2 size={12} className="animate-spin mt-0.5 shrink-0" />
          <span>
            Waiting for the AI summary. Publishing in {waitingForAiSeconds}s
            either way — press Publish again to skip the wait.
          </span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={publishDisabled || value.trim() === ""}
          onClick={onPublish}
          variant="default"
          className="flex items-center gap-2"
        >
          <span>{isPublishing ? "Pushing..." : "Publish"}</span>
          <Upload size={16} />
        </Button>
      </div>
    </div>
  );
}

/**
 * The small AI affordance beside the heading.
 *
 * Deliberately small and off to the side: it reports what the AI is up to and
 * offers its result, and at no point does it stand between the user and the
 * publish button.
 */
function AiSummaryButton({
  ai,
  canApply,
  onUseAiSummary,
  onOpenAiSession,
  onSetUpAi,
}: {
  ai: AiSummaryState;
  canApply: boolean;
  onUseAiSummary: () => void;
  onOpenAiSession?: () => void;
  onSetUpAi?: () => void;
}) {
  const portalContainer = useValPortal();

  if (ai.status === "off") {
    if (!onSetUpAi) {
      return null;
    }
    return (
      <AiTooltip
        container={portalContainer}
        text="Val can write your summary for you once an AI key is set up. Publishing works the same either way."
      >
        <button
          type="button"
          onClick={onSetUpAi}
          className="flex items-center gap-1 text-xs text-fg-secondary underline cursor-pointer"
        >
          <Sparkles size={12} />
          <span>Set up AI</span>
        </button>
      </AiTooltip>
    );
  }

  if (ai.status === "idle") {
    return null;
  }

  if (ai.status === "loading") {
    return (
      <AiTooltip
        container={portalContainer}
        text="Writing a summary with AI. You do not have to wait — edit the text or publish whenever you like."
      >
        <span className="flex items-center gap-1 text-xs text-fg-secondary">
          <Loader2 size={12} className="animate-spin" />
          <span>AI is writing…</span>
        </span>
      </AiTooltip>
    );
  }

  if (ai.status === "failed") {
    return (
      <AiTooltip
        container={portalContainer}
        text={`${ai.message} Your summary is unaffected — publish when ready.`}
      >
        {ai.canSetUp && onSetUpAi ? (
          <button
            type="button"
            onClick={onSetUpAi}
            className="flex items-center gap-1 text-xs text-fg-secondary underline cursor-pointer"
          >
            <AlertTriangle size={12} />
            <span>AI unavailable</span>
          </button>
        ) : (
          <span className="flex items-center gap-1 text-xs text-fg-secondary">
            <AlertTriangle size={12} />
            <span>AI unavailable</span>
          </span>
        )}
      </AiTooltip>
    );
  }

  // ready
  return (
    <span className="flex items-center gap-2">
      {canApply && (
        <AiTooltip
          container={portalContainer}
          text="Replace what you have written with the AI's summary."
        >
          <button
            type="button"
            onClick={onUseAiSummary}
            className="flex items-center gap-1 text-xs text-fg-secondary underline cursor-pointer"
          >
            <Sparkles size={12} />
            <span>Use AI summary</span>
          </button>
        </AiTooltip>
      )}
      {onOpenAiSession && (
        <AiTooltip
          container={portalContainer}
          text="Open the chat that wrote this summary to ask what changed."
        >
          <button
            type="button"
            onClick={onOpenAiSession}
            className="flex items-center gap-1 text-xs text-fg-secondary underline cursor-pointer"
          >
            <MessageSquare size={12} />
            <span>Ask what changed</span>
          </button>
        </AiTooltip>
      )}
    </span>
  );
}

function AiTooltip({
  text,
  container,
  children,
}: {
  text: string;
  container: HTMLElement | null;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent container={container} className="max-w-[260px] text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Counts a publish grace period down and then lets publishing proceed.
 *
 * Exported for the container to drive the `waitingForAiSeconds` prop; the view
 * itself stays a pure function of its props so stories can pin any frame of it.
 *
 * Pressing Publish committed to publishing, so the pending publish outlives
 * this component: closing the popover mid-countdown fires it rather than
 * dropping it on the floor.
 */
export function usePublishGrace(totalSeconds: number) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const onElapsed = useRef<(() => void) | null>(null);

  const fire = useCallback(() => {
    const pending = onElapsed.current;
    onElapsed.current = null;
    setRemaining(null);
    pending?.();
  }, []);

  useEffect(() => {
    if (remaining === null) {
      return;
    }
    if (remaining <= 0) {
      fire();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => (r ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, fire]);

  // Escape, or a click outside, unmounts the popover mid-countdown. The user
  // already asked to publish, so honour it instead of silently losing it.
  useEffect(
    () => () => {
      const pending = onElapsed.current;
      onElapsed.current = null;
      pending?.();
    },
    [],
  );

  return {
    remaining,
    isWaiting: remaining !== null,
    /** Ignored while a countdown is already running: a second press skips it. */
    start: (whenElapsed: () => void) => {
      if (onElapsed.current !== null) {
        return;
      }
      onElapsed.current = whenElapsed;
      setRemaining(totalSeconds);
    },
    /** Publish now, without waiting for the rest of the countdown. */
    skip: fire,
    cancel: () => {
      onElapsed.current = null;
      setRemaining(null);
    },
  };
}
