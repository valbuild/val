import { ShellDestination, ShellPanel } from "./types";
import { TOUR_COPY } from "./tourCopy";

/**
 * One stop on the guided tour.
 *
 * A step is data, not a component: what the tour has to get right is WHICH
 * stops a given project has and what each of them says, and that is a question
 * about the project rather than about the DOM — so it is decided here, where a
 * test can read it, rather than inside the overlay that draws it.
 */
export type TourStep = {
  /** Stable id, so a test can name a step without matching its prose. */
  id: string;
  /** From `tourCopy.ts`, which is the one place the tour's words live. */
  title: string;
  body: string;
  /**
   * The `data-val-tour` value of the control this step is about.
   *
   * Absent, or present but not on screen, leaves the step a card in the middle
   * with no spotlight — which is what happens on a phone, where the rail and
   * half the top bar are not drawn. The words still land; only the arrow is
   * missing. A step must therefore never say "this button here".
   */
  target?: string;
  /**
   * A panel to open while the step is up, so the thing being explained is
   * behind the card rather than described in the abstract.
   */
  panel?: ShellPanel;
};

/**
 * How Val is running, for the one step whose subject is named differently in
 * each. See `PublishButton`: on a local checkout it says "Save".
 */
export type TourMode = "fs" | "http" | "unknown";

/**
 * The tour, for this project.
 *
 * The destination steps are conditional on the project HAVING that destination
 * — the same list the rail is built from — because the fastest way to make
 * someone more confused than they started is to explain a concept their
 * project does not use and then show them an icon that is not there. A project
 * of pure content files gets Data and not Pages; a marketing site gets the
 * other way round.
 *
 * Review, Preview and Publish are unconditional: every project ships changes,
 * and they are in the order the top bar puts them, which is the order they are
 * done in.
 */
export function studioTourSteps(
  destinations: readonly ShellDestination[],
  mode: TourMode = "http",
): TourStep[] {
  const steps: TourStep[] = [{ id: "welcome", ...TOUR_COPY.welcome }];
  if (destinations.includes("pages")) {
    steps.push({
      id: "pages",
      ...TOUR_COPY.pages,
      target: "pages",
      panel: "pages",
    });
  }
  if (destinations.includes("media")) {
    steps.push({
      id: "media",
      ...TOUR_COPY.media,
      target: "media",
      panel: "media",
    });
  }
  if (destinations.includes("data")) {
    steps.push({
      id: "data",
      ...TOUR_COPY.data,
      target: "data",
      panel: "data",
    });
  }
  steps.push({ id: "review", ...TOUR_COPY.review, target: "review" });
  steps.push({ id: "preview", ...TOUR_COPY.preview, target: "preview" });
  // One step, two wordings, and the id stays `publish` either way: it is the
  // same stop, and the control it points at carries one marker.
  steps.push({
    id: "publish",
    ...(mode === "fs" ? TOUR_COPY.save : TOUR_COPY.publish),
    target: "publish",
  });
  steps.push({ id: "finish", ...TOUR_COPY.finish, target: "utility" });
  return steps;
}

/**
 * Whether this browser has been through the tour.
 *
 * The ONLY thing about the tour kept per browser, and it is per browser because
 * it is a fact about one person on one machine rather than a decision: there is
 * nothing for a team to agree about in "have you seen this yet". Whether the
 * tour is offered AT ALL is the project's, in `s.settings()` under `studio.tour`
 * — so a team that finds it noisy turns it off once, for everyone. See
 * `readStudioSettings`.
 *
 * Getting this one wrong costs a button that glows for one session.
 */
const COMPLETED_KEY = "val:tour:completed";

/**
 * Reading and writing storage can throw outright — a private window, a browser
 * set to block site data — and an onboarding nicety is the last thing in the
 * Studio that should be allowed to take it down. Every accessor swallows.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do and nothing worth saying: the tour still runs, it just
    // will not be remembered next time.
  }
}

export function readTourCompleted(): boolean {
  return read(COMPLETED_KEY) === "true";
}

export function writeTourCompleted(completed: boolean): void {
  write(COMPLETED_KEY, completed ? "true" : "false");
}
