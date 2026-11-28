import { Check, Compass, XCircle } from "lucide-react";
import type { GuideRequest } from "./shell/assistantGuide";

/**
 * The assistant offering to show the person how to do something
 * (`show_guide`), in the chat.
 *
 * An offer, never a tour that starts by itself: someone who asked a question
 * wanted an answer, and may not want a lesson in the middle of what they
 * were doing. So the assistant says what it would show and how long it is,
 * and the person says yes or no. While the tour runs the card says where it
 * has got to and is the way to stop it; afterwards it says how it went, which
 * is what the assistant was told too.
 *
 * Like a question card the turn waits on it, so it is never folded away with
 * the other tool calls.
 */
export function GuideRequestCard({
  request,
  onStart,
  onDecline,
  onStop,
}: {
  request: GuideRequest;
  onStart: () => void;
  onDecline: () => void;
  onStop: () => void;
}) {
  const { state, title, stepCount } = request;
  if (state.kind === "declined") {
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-xs text-fg-secondary">
        <XCircle className="h-3 w-3" />
        <Compass className="h-3 w-3" />
        <span>Not shown: {title}</span>
      </div>
    );
  }
  if (state.kind === "ended") {
    const { finished, reached, steps } = state.outcome;
    const forThem = steps.filter((how) => how === "done-for-them").length;
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-xs text-fg-secondary">
        {finished ? (
          <Check className="h-3 w-3 text-border-brand-secondary" />
        ) : (
          <XCircle className="h-3 w-3" />
        )}
        <Compass className="h-3 w-3" />
        <span className="min-w-0 truncate">
          {finished ? "Showed you" : "Stopped"}: {title}
          <span className="text-fg-secondary-alt">
            {" · "}
            {finished
              ? doneSummary(stepCount, forThem)
              : `at step ${Math.max(1, reached)} of ${stepCount}`}
          </span>
        </span>
      </div>
    );
  }
  if (state.kind === "showing") {
    return (
      <div
        role="group"
        aria-label={`Showing you: ${title}`}
        className="flex items-center gap-2 rounded-lg border border-border-brand-secondary bg-bg-float px-3 py-2"
      >
        <span className="relative grid h-5 w-5 shrink-0 place-items-center">
          <span className="absolute inset-0 rounded-full bg-border-brand-secondary opacity-30 motion-safe:animate-ping" />
          <Compass className="relative h-3.5 w-3.5 text-border-brand-secondary" />
        </span>
        <span className="min-w-0 flex-1 text-xs">
          <span className="block truncate font-medium text-fg-primary">
            Showing you: {title}
          </span>
          <span className="block tabular-nums text-fg-secondary">
            Step {state.step + 1} of {stepCount}
          </span>
        </span>
        <button
          type="button"
          onClick={onStop}
          className="inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          Stop
        </button>
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label="The assistant offers to show you how"
      className="rounded-lg border border-border-brand-secondary bg-bg-float p-3"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg-brand-primary text-fg-brand-primary">
          <Compass className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 text-sm font-medium text-fg-primary">
          {title}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
        {request.why ??
          "I can show you where to click, so you can do it yourself next time."}
      </p>
      <p className="mt-1 text-xs tabular-nums text-fg-secondary-alt">
        {stepCount === 1 ? "One step" : `${stepCount} steps`}. You can stop at
        any time.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDecline}
          className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          No thanks
        </button>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-brand-primary bg-bg-brand-primary px-3 text-xs font-medium text-fg-brand-primary hover:bg-bg-brand-primary-hover"
        >
          <Compass className="h-3.5 w-3.5" />
          Show me how
        </button>
      </div>
    </div>
  );
}

function doneSummary(stepCount: number, forThem: number): string {
  const all = stepCount === 1 ? "1 step" : `all ${stepCount} steps`;
  return forThem === 0 ? all : `${all}, ${forThem} done for you`;
}
