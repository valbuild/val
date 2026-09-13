import { ShellDestination, ShellPanel } from "./types";

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
  const steps: TourStep[] = [
    {
      id: "welcome",
      title: "Welcome to the Studio",
      body: "This is where your site's content is edited. Navigation is on the left, the thing you picked opens in the middle, and everything along the top is about getting a change out. About a minute.",
    },
  ];
  if (destinations.includes("pages")) {
    steps.push({
      id: "pages",
      title: "Pages are the pages of your site",
      body: "One row per URL, nested the way your site is. Opening a row shows the content of that page and nothing else, so this is the place to start when you know which page you want to change.",
      target: "pages",
      panel: "pages",
    });
  }
  if (destinations.includes("media")) {
    steps.push({
      id: "media",
      title: "Media is the shared library of images and files",
      body: "Every picture and document that has been uploaded, in one place, so the same logo can be used on twenty pages and replaced once. You upload here; you pick an image from here in the field on the page itself.",
      target: "media",
      panel: "media",
    });
  }
  if (destinations.includes("data")) {
    steps.push({
      id: "data",
      title: "Data is the content that is not on one page",
      body: "Menus, footers, opening hours, shared wording — anything used across the site or in no page at all. Your developers decide what lives here, which is why it is a list of files rather than a list of URLs.",
      target: "data",
      panel: "data",
    });
  }
  steps.push({
    id: "review",
    title: "Review what you changed",
    body: "Every edit is a draft until you send it. Review lists them side by side with what is live now, and it is also where an edit you regret is thrown away.",
    target: "review",
  });
  steps.push({
    id: "preview",
    title: "Preview it on the real page",
    body: "The site as it will look with your drafts in it — beside the editor as a canvas, or in a tab of its own. Nobody else sees any of this yet.",
    target: "preview",
  });
  steps.push(
    mode === "fs"
      ? {
          id: "publish",
          title: "Save writes it to your project",
          body: "Running locally there is no live site to publish to, so this writes your drafts into the project on disk — where the rest of your tooling, and git, can see them.",
          target: "publish",
        }
      : {
          id: "publish",
          title: "Publish sends it live",
          body: "One press ships everything in Review. It stays switched off while there are validation errors to fix, and it tells you which.",
          target: "publish",
        },
  );
  steps.push({
    id: "finish",
    title: "That is the whole thing",
    body: "Quick actions keeps the tour, so you can run it again — or hand it to whoever edits next. Turn the reminder off under Account.",
    target: "utility",
  });
  return steps;
}

/**
 * Whether this browser has been through the tour.
 *
 * Per browser, which is the honest scope of a `localStorage` value: it decides
 * whether to GLOW at someone, and the thing it is guessing at is whether this
 * person has seen the Studio before. Getting it wrong costs a button that
 * shines for one session.
 */
const COMPLETED_KEY = "val:tour:completed";
/** Whether to offer the tour at all. See `readTourEnabled`. */
const ENABLED_KEY = "val:tour:enabled";

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

/**
 * Whether the Studio may prompt for the tour. Defaults to ON.
 *
 * Absent means nobody has answered the question, and a first-time editor is
 * exactly the person who has not — so the default has to be the helpful one.
 * Only an explicit "false" turns it off, which is what makes a storage read
 * that failed (returning null) behave like a fresh browser rather than like a
 * refusal.
 */
export function readTourEnabled(): boolean {
  return read(ENABLED_KEY) !== "false";
}

export function writeTourEnabled(enabled: boolean): void {
  write(ENABLED_KEY, enabled ? "true" : "false");
}
