import { AlertTriangle, MessageSquare, RotateCw, Sparkles } from "lucide-react";
import { cn } from "../designSystem/cn";
import type { ProposalPerson } from "./types";

/**
 * The proposal's preview could not be updated with its latest code.
 *
 * Kept OFF Save and Publish on purpose. A code change is almost always made
 * by an assistant -- and often by someone else's, in a chat of theirs -- so
 * the person looking at Save is seldom the person who caused it, and pressing
 * Save again would not fix it. Save says only what Save does; this says what
 * happened to the preview, whose change it followed, and what can be done.
 *
 * It is shown where everything about the proposal itself is: the switcher's
 * menu above a phone and the proposal sheet on one, with a dot on the
 * switcher (or the phone's chip) that never moves anything, and in code mode
 * behind the preview's "Couldn't update".
 */
export type PreviewProblem = {
  /** What went wrong, verbatim: for whoever acts on it, under Details. */
  error: string;
  /** Whose change the failed update followed. `null` when it is not known. */
  cause: {
    who: ProposalPerson;
    /** The person looking: "your assistant". */
    isViewer: boolean;
    /** Made by their assistant, rather than by hand. */
    byAssistant: boolean;
    /** "5 minutes ago". */
    ago: string;
  } | null;
  /** Open this person's assistant, in code mode, asked to fix it. */
  onAskAssistant?: () => void;
  /**
   * Open the chat the change was made in. A proposal's chats are everyone's
   * on it (valbuild/home `docs/proposals.md`, Flow H), so another person's
   * chat can be opened and continued -- often the quickest fix, since that
   * assistant knows what it was doing.
   */
  onOpenChat?: () => void;
  /**
   * Try the update again. Only where that can help -- the update failed for
   * a reason of its own, not because of the code -- since a retry that fails
   * the same way is worse than no button.
   */
  onRetry?: () => void;
};

/** "After Kari Nordmann's assistant changed the code, 5 minutes ago." */
export function previewProblemCause(problem: PreviewProblem): string | null {
  const cause = problem.cause;
  if (cause === null) return null;
  const whose = cause.isViewer
    ? cause.byAssistant
      ? "your assistant"
      : "you"
    : cause.byAssistant
      ? `${cause.who.name}’s assistant`
      : cause.who.name;
  return `After ${whose} changed the code, ${cause.ago}.`;
}

export function PreviewProblemCard({
  problem,
  onAct,
  className,
}: {
  problem: PreviewProblem;
  /** Something was chosen: a menu closes. */
  onAct?: () => void;
  className?: string;
}) {
  const act = (action: () => void) => () => {
    onAct?.();
    action();
  };
  const cause = previewProblemCause(problem);
  const chatOwner =
    problem.cause !== null && !problem.cause.isViewer
      ? problem.cause.who.name.split(" ")[0]
      : null;
  return (
    <div
      role="group"
      aria-label="The preview couldn't be updated"
      className={cn(
        "rounded-md border border-border-error-primary bg-bg-float p-2.5 text-xs",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          className="mt-px shrink-0 text-fg-error-on-surface"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg-primary">
            The preview couldn&rsquo;t be updated
          </p>
          <p className="mt-0.5 leading-relaxed text-fg-secondary">
            {cause !== null && <>{cause} </>}
            It shows the last version that worked, and nothing on the site is
            affected.
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-fg-secondary-alt">
              Details
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[0.6875rem] text-fg-secondary">
              {problem.error}
            </pre>
          </details>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
        {problem.onRetry !== undefined && (
          <button
            type="button"
            onClick={act(problem.onRetry)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <RotateCw size={12} className="shrink-0" />
            Try again
          </button>
        )}
        {problem.onOpenChat !== undefined && chatOwner !== null && (
          <button
            type="button"
            onClick={act(problem.onOpenChat)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-float px-2 text-fg-primary hover:bg-bg-float-raised"
          >
            <MessageSquare size={12} className="shrink-0" />
            {`Open ${chatOwner}’s chat`}
          </button>
        )}
        {problem.onAskAssistant !== undefined && (
          <button
            type="button"
            onClick={act(problem.onAskAssistant)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-bg-proposal px-2 font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
          >
            <Sparkles size={12} className="shrink-0" />
            Ask the assistant to fix it
          </button>
        )}
      </div>
    </div>
  );
}

/** The dot on the switcher and the phone's chip: never takes room. */
export function PreviewProblemDot() {
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-fg-error-on-surface ring-2 ring-bg-float"
    />
  );
}
