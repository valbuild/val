import { Check, ChevronRight, Compass, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import { CLEAR_OF_BOTTOM_BARS } from "../components/shell/MobileChrome";
import { useShellBreakpoint } from "../components/shell/useShellBreakpoint";
import {
  type DemoScript,
  type DemoScriptTour,
  readDemoAudience,
  readDemoToursDone,
  toursFor,
  writeDemoAudience,
} from "./demoScript";

/** Where "Create your own project" goes. */
export const DEMO_CREATE_PROJECT_URL = "https://val.build/docs/create";

/**
 * What the demo IS, always on screen: a card in the corner.
 *
 * Floating rather than a bar across the top, because the shell lays its bars
 * out absolutely and a row above them would push every one of them down. It
 * can be folded away, never closed: someone coming back to the tab after
 * lunch should still be able to tell that nothing they did here was saved
 * anywhere but this tab.
 *
 * With a script (`ValDemoOptions.tours`), the card is also where the tours
 * are: it asks what brought the visitor, then lists the tours for the
 * answer, the first one offered first. Nothing starts by itself.
 */
export function DemoBanner({
  onReset,
  onStartTour,
  script = null,
}: {
  /** Start over: the edits live in memory, so this reloads. */
  onReset: () => void;
  /** Start a tour of the script, by id; or, with no script, the tour. */
  onStartTour: (tourId?: string) => void;
  script?: DemoScript | null;
}) {
  const [folded, setFolded] = useState(false);
  const breakpoint = useShellBreakpoint();
  return (
    <div
      className={cn(
        "fixed z-window max-w-[calc(100vw-2rem)]",
        // Clear of the left rail on desktop, as the status bar is.
        breakpoint === "desktop" ? "left-[4.75rem]" : "left-3",
        CLEAR_OF_BOTTOM_BARS,
      )}
      data-val-tour="demo"
    >
      {folded ? (
        <Button
          size="xs"
          variant="secondary"
          className="rounded-full shadow-md"
          onClick={() => setFolded(false)}
        >
          Demo
        </Button>
      ) : (
        <div
          role="region"
          aria-label="About this demo"
          className={cn(
            "max-w-full rounded-lg border border-border-primary bg-bg-primary p-3 text-sm text-fg-primary shadow-lg",
            script ? "w-[336px]" : "w-[300px]",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">This is a demo of Val</p>
            <button
              type="button"
              aria-label="Fold the demo card"
              className="text-fg-tertiary hover:text-fg-primary"
              onClick={() => setFolded(true)}
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-1 text-fg-secondary">
            Edit anything. Your changes stay in this page: nothing is saved
            anywhere, and reloading starts over.
          </p>
          {script && <DemoScriptList script={script} onStart={onStartTour} />}
          <div className="mt-3 flex flex-wrap gap-2">
            {!script && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => onStartTour()}
              >
                <Compass size={14} className="mr-1" />
                Tour
              </Button>
            )}
            <Button size="xs" variant="secondary" onClick={onReset}>
              <RotateCcw size={14} className="mr-1" />
              Start over
            </Button>
            <Button size="xs" asChild>
              <a
                href={DEMO_CREATE_PROJECT_URL}
                target="_blank"
                rel="noreferrer"
              >
                Create your own project
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "What brings you here?", and then the tours for the answer.
 *
 * The answer and the ticks are read from the tab's storage when this mounts
 * -- the card is not on screen while a tour runs, so it mounts again after
 * each, and the tour that just finished is ticked by then.
 */
function DemoScriptList({
  script,
  onStart,
}: {
  script: DemoScript;
  onStart: (tourId: string) => void;
}) {
  const [audienceId, setAudienceId] = useState(() => {
    const saved = readDemoAudience();
    return script.audiences.some((a) => a.id === saved) ? saved : null;
  });
  const [done] = useState(readDemoToursDone);
  const choose = (id: string | null) => {
    writeDemoAudience(id);
    setAudienceId(id);
  };
  const tours = toursFor(script, audienceId);
  if (tours === null) {
    return (
      <div className="mt-3" data-val-demo-question="">
        <p className="text-xs font-medium text-fg-primary">
          What brings you here?
        </p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {script.audiences.map((audience) => (
            <li key={audience.id}>
              <button
                type="button"
                onClick={() => choose(audience.id)}
                className="flex w-full items-center gap-2 rounded-md border border-border-primary px-2.5 py-2 text-left hover:border-border-brand-secondary hover:bg-bg-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">
                    {audience.title}
                  </span>
                  {audience.description && (
                    <span className="mt-0.5 block text-[0.6875rem] text-fg-secondary">
                      {audience.description}
                    </span>
                  )}
                </span>
                <ChevronRight size={14} className="shrink-0 text-fg-tertiary" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[0.6875rem] text-fg-tertiary">
          You can switch any time.
        </p>
      </div>
    );
  }
  const audience = script.audiences.find((a) => a.id === audienceId);
  const [first, ...rest] = tours;
  return (
    <div className="mt-3" data-val-demo-tours={audienceId ?? ""}>
      {audience && (
        <div className="flex items-center justify-between gap-2 text-[0.6875rem] text-fg-secondary">
          <span className="min-w-0 truncate">
            Showing: <span className="text-fg-primary">{audience.title}</span>
          </span>
          <button
            type="button"
            onClick={() => choose(null)}
            className="shrink-0 underline-offset-2 hover:text-fg-primary hover:underline"
          >
            Change
          </button>
        </div>
      )}
      {first && (
        <div className="mt-1.5 rounded-md border border-border-brand-secondary bg-bg-secondary p-2.5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-xs font-medium">
                {done.includes(first.id) && (
                  <Check
                    size={12}
                    aria-label="Done"
                    className="text-border-brand-secondary"
                  />
                )}
                {first.title}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-fg-secondary">
                {lengthOf(first)}
              </p>
            </div>
            <Button size="xs" onClick={() => onStart(first.id)}>
              Show me
            </Button>
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <ul className="mt-1.5 flex flex-col">
          {rest.map((tour) => (
            <li key={tour.id}>
              <button
                type="button"
                onClick={() => onStart(tour.id)}
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-bg-secondary"
              >
                {done.includes(tour.id) ? (
                  <Check
                    size={12}
                    aria-label="Done"
                    className="shrink-0 text-border-brand-secondary"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full border border-fg-tertiary"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{tour.title}</span>
                {tour.duration && (
                  <span className="shrink-0 text-[0.6875rem] text-fg-tertiary">
                    {tour.duration}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "3 steps, about 30 s". */
function lengthOf(tour: DemoScriptTour): string {
  const steps = `${tour.steps.length} ${tour.steps.length === 1 ? "step" : "steps"}`;
  return tour.duration ? `${steps}, about ${tour.duration}` : steps;
}
