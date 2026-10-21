import type { SourcePath } from "@valbuild/core";
import type { ValDemoAudience, ValDemoTour } from "@valbuild/shared/internal";
import { isSourcePath } from "../utils/sourcePath";
import type { TourStep } from "../components/shell/tourSteps";
import { demoTourStepsFromSite } from "./demoTour";

/*
 * THE DEMO SCRIPT: short tours a visitor picks from on the demo card, after
 * saying what brought them (`ValDemoOptions.tours` and `.audiences`).
 *
 * Why a script rather than one tour: tours of three or four steps are
 * finished about three times as often as ones of seven, and tours people
 * start themselves about twice as often as ones that start on their own. So
 * nothing opens by itself; the card asks, and lists what there is.
 */

export type DemoScriptTour = {
  id: string;
  title: string;
  duration: string | null;
  /** The page it starts on. See `ValDemoTour.start`. */
  start: SourcePath | null;
  steps: TourStep[];
};

export type DemoScriptAudience = {
  id: string;
  title: string;
  description: string | null;
  /** Tour ids, in order; every one names a tour of the script. */
  tours: string[];
};

export type DemoScript = {
  tours: DemoScriptTour[];
  /**
   * The answers to "What brings you here?", with "Show me everything" last
   * when there are two or more. Empty: there is no question, and the card
   * lists every tour.
   */
  audiences: DemoScriptAudience[];
};

/** The id of the answer the Studio adds: every tour, once each. */
export const EVERYTHING = "everything";

/**
 * The site's script, as the card shows it, or null when the site wrote none.
 *
 * Like the steps (`demoTourStepsFromSite`), it comes from a page that may not
 * be TypeScript, so what cannot be used is dropped rather than failing the
 * card: a tour with no usable step, an answer naming no tour that exists.
 */
export function demoScriptFromSite(
  tours: readonly ValDemoTour[] | undefined,
  audiences: readonly ValDemoAudience[] | undefined,
): DemoScript | null {
  if (!Array.isArray(tours)) return null;
  const out: DemoScriptTour[] = [];
  for (const tour of tours) {
    if (typeof tour?.id !== "string" || typeof tour.title !== "string") {
      continue;
    }
    if (out.some((other) => other.id === tour.id)) continue;
    const steps = Array.isArray(tour.steps)
      ? demoTourStepsFromSite(tour.steps)
      : [];
    if (steps.length === 0) continue;
    out.push({
      id: tour.id,
      title: tour.title,
      duration: typeof tour.duration === "string" ? tour.duration : null,
      start:
        typeof tour.start === "string" && isSourcePath(tour.start)
          ? tour.start
          : null,
      steps,
    });
  }
  if (out.length === 0) return null;
  const ids = new Set(out.map((tour) => tour.id));
  const answers: DemoScriptAudience[] = [];
  for (const audience of Array.isArray(audiences) ? audiences : []) {
    if (
      typeof audience?.id !== "string" ||
      typeof audience.title !== "string" ||
      audience.id === EVERYTHING ||
      !Array.isArray(audience.tours)
    ) {
      continue;
    }
    // Widened, not trusted: the site's page may not be TypeScript.
    const named: readonly unknown[] = audience.tours;
    const list: string[] = [];
    for (const id of named) {
      if (typeof id === "string" && ids.has(id) && !list.includes(id)) {
        list.push(id);
      }
    }
    if (list.length === 0) continue;
    answers.push({
      id: audience.id,
      title: audience.title,
      description:
        typeof audience.description === "string" ? audience.description : null,
      tours: list,
    });
  }
  if (answers.length >= 2) {
    // Each answer's tours in turn, a tour on two lists listed once: the
    // shared opener stays on top.
    const all: string[] = [];
    for (const answer of answers) {
      for (const id of answer.tours) if (!all.includes(id)) all.push(id);
    }
    answers.push({
      id: EVERYTHING,
      title: "Show me everything",
      description: null,
      tours: all,
    });
  }
  return { tours: out, audiences: answers };
}

/**
 * The tours to list, for an answer -- or for no question at all, every one.
 * Null while there is a question nobody has answered.
 */
export function toursFor(
  script: DemoScript,
  audienceId: string | null,
): DemoScriptTour[] | null {
  if (script.audiences.length === 0) return script.tours;
  const audience = script.audiences.find((a) => a.id === audienceId);
  if (!audience) return null;
  return audience.tours.flatMap((id) => {
    const tour = script.tours.find((t) => t.id === id);
    return tour ? [tour] : [];
  });
}

/*
 * What the visitor said and did, per tab -- like the demo's edits, a new tab
 * is a new visitor. Storage can throw (blocked site data): then nothing is
 * remembered, and the card asks again next load, which is the cheap mistake.
 */
const AUDIENCE_KEY = "val-demo:audience";
const DONE_KEY = "val-demo:tours-done";

export function readDemoAudience(): string | null {
  try {
    return window.sessionStorage.getItem(AUDIENCE_KEY);
  } catch {
    return null;
  }
}

export function writeDemoAudience(id: string | null): void {
  try {
    if (id === null) window.sessionStorage.removeItem(AUDIENCE_KEY);
    else window.sessionStorage.setItem(AUDIENCE_KEY, id);
  } catch {
    // Nowhere to remember it: the card asks again next load.
  }
}

export function readDemoToursDone(): string[] {
  try {
    const raw: unknown = JSON.parse(
      window.sessionStorage.getItem(DONE_KEY) ?? "[]",
    );
    return Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function markDemoTourDone(id: string): void {
  const done = readDemoToursDone();
  if (done.includes(id)) return;
  try {
    window.sessionStorage.setItem(DONE_KEY, JSON.stringify([...done, id]));
  } catch {
    // Not ticked off; it can be taken again.
  }
}
