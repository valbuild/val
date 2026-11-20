import type { JSONValue } from "@valbuild/core/patch";
import type {
  ValDemoTourMoveOn,
  ValDemoTourPanel,
  ValDemoTourStep,
} from "@valbuild/shared/internal";
import type { TourMoveOn, TourStep } from "../components/shell/tourSteps";
import type { ShellDestination, ShellPanel } from "../components/shell/types";
import { isSourcePath } from "../utils/sourcePath";

/*
 * THE DEMO'S GUIDED TOUR: its stops and its words.
 *
 * The same machinery as the Studio's own tour (`StudioTour`, `tourSteps.ts`),
 * with stops written for someone who has never seen Val and has no project of
 * their own yet. The rules in `tourCopy.ts` hold here too -- above all, never
 * "this button here": a step whose target is not on screen (the rail on a
 * phone) is a card in the middle, and the words have to stand without it.
 *
 * Expected to be rewritten as the demo is tried on people. Nothing outside
 * this file decides what the tour says.
 */

export type DemoTourProject = {
  /** The destinations the rail offers. See `availableDestinations`. */
  destinations: readonly ShellDestination[];
  /**
   * Whether this browser can upload in the demo (`ValDemoRuntime.uploads`).
   * The Media step invites an upload only where one can be made.
   */
  uploads: boolean;
};

export function demoTourSteps({
  destinations,
  uploads,
}: DemoTourProject): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "demo-welcome",
      title: "Welcome to Val",
      body: "This is Val's real Studio, editing a real site — running entirely in your browser. Nothing you do here leaves this tab, so try anything.",
    },
    {
      id: "demo-canvas",
      title: "Click the page to edit it",
      body: "The site you are editing is right here. Click any text or image on it, and the field behind it opens beside the page. Change it, and the page follows as you type.",
      target: "canvas",
    },
  ];
  if (destinations.includes("pages")) {
    steps.push({
      id: "demo-pages",
      title: "Pages — every URL on the site",
      body: "Every page, as the site's own routes. Open one to edit it, or add a new one: it gets a URL straight away.",
      target: "pages",
      panel: "pages",
    });
  }
  if (destinations.includes("media")) {
    steps.push({
      id: "demo-media",
      title: "Media — images and video in one place",
      body: uploads
        ? "Images and videos live in galleries, and a page picks from them. Upload your own — a photo from your phone works too. Images are converted and scaled down before they are sent, and a video becomes a stream, all in your browser."
        : "Images and videos live in galleries, and a page picks from them. Pick another one for any image on the page. In your own project, you upload new ones here too.",
      target: "media",
      panel: "media",
    });
  }
  if (destinations.includes("data")) {
    steps.push({
      id: "demo-data",
      title: "Data — content that is not a page",
      body: "Authors, settings, anything shared between pages. Each is a typed schema in code, so the Studio knows what every field accepts.",
      target: "data",
      panel: "data",
    });
  }
  steps.push(
    {
      id: "demo-review",
      title: "Review before it goes out",
      body: "Every change you have made, side by side with what was there before. Discard what you did not mean.",
      target: "review",
    },
    {
      id: "demo-publish",
      title: "Publish is a commit",
      body: "In your own project, Publish turns your changes into a commit in Git, and the site rebuilds. Content is code, and the Studio is how people who do not write code change it.",
      target: "publish",
    },
    {
      id: "demo-finish",
      title: "Your turn",
      body: "Edit something on the page. The demo card has Start over, and the way to create a project of your own.",
      target: "demo",
    },
  );
  return steps;
}

/**
 * The tour the site wrote (`<ValApp demo={{ tour }}>`), as the Studio's steps.
 *
 * The site's steps arrive at run time from a page that may not be TypeScript,
 * so nothing here is trusted to be the shape its type says. What cannot be
 * used is dropped, as narrowly as possible, rather than failing the tour: a
 * step with no words is left out, a target or panel the Studio does not have
 * is ignored (the card stands on its own, as it does on a phone), and a
 * `moveOn` whose path is not a source path makes it a step with Next -- the
 * visitor can always get past it.
 */
export function demoTourStepsFromSite(
  steps: readonly ValDemoTourStep[],
): TourStep[] {
  const out: TourStep[] = [];
  for (const step of steps) {
    if (typeof step.title !== "string" || typeof step.body !== "string") {
      continue;
    }
    const panel = panelOf(step.panel);
    const moveOn = moveOnOf(step.moveOn);
    const code = codeOf(step.code);
    out.push({
      id: typeof step.id === "string" ? step.id : `step-${out.length}`,
      title: step.title,
      body: step.body,
      ...(typeof step.target === "string" ? { target: step.target } : {}),
      ...(panel ? { panel } : {}),
      ...(typeof step.field === "string" && isSourcePath(step.field)
        ? { field: step.field }
        : {}),
      ...(typeof step.page === "string" && isSourcePath(step.page)
        ? { page: step.page }
        : {}),
      ...(moveOn ? { moveOn } : {}),
      ...(code ? { code } : {}),
    });
  }
  return out;
}

const PANELS: Record<ValDemoTourPanel, ShellPanel> = {
  pages: "pages",
  media: "media",
  data: "data",
  settings: "settings",
  ai: "ai",
};

function panelOf(panel: unknown): ShellPanel | null {
  if (typeof panel !== "string") return null;
  for (const [name, shellPanel] of Object.entries(PANELS)) {
    if (name === panel) return shellPanel;
  }
  return null;
}

function moveOnOf(moveOn: ValDemoTourMoveOn | undefined): TourMoveOn | null {
  if (typeof moveOn !== "object" || moveOn === null) return null;
  if ("open" in moveOn) {
    return typeof moveOn.open === "string" && isSourcePath(moveOn.open)
      ? { type: "open", path: moveOn.open }
      : null;
  }
  if ("edit" in moveOn) {
    const { path, value, add } = moveOn;
    return typeof path === "string" && isSourcePath(path) && isJson(value)
      ? {
          type: "edit",
          write: { path, value, ...(add === true ? { add: true } : {}) },
        }
      : { type: "edit" };
  }
  if ("newPage" in moveOn) {
    return typeof moveOn.newPage === "string" && isSourcePath(moveOn.newPage)
      ? { type: "newPage", path: moveOn.newPage }
      : null;
  }
  if ("panel" in moveOn) {
    const panel = panelOf(moveOn.panel);
    return panel ? { type: "panel", panel } : null;
  }
  if ("locale" in moveOn) return { type: "locale" };
  return null;
}

function codeOf(code: unknown): TourStep["code"] | null {
  if (typeof code !== "object" || code === null) return null;
  if (!("file" in code) || !("text" in code)) return null;
  const { file, text } = code;
  return typeof file === "string" && typeof text === "string"
    ? { file, text }
    : null;
}

/** A value a patch can write: what JSON can say, and nothing else. */
function isJson(value: unknown): value is JSONValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      return Array.isArray(value)
        ? value.every(isJson)
        : Object.values(value).every(isJson);
    default:
      return false;
  }
}

/**
 * Whether the tour has been seen in THIS TAB.
 *
 * Per tab, like the demo's edits: a new tab is a new visitor as far as the
 * demo knows, and they should get the tour. Storage can throw (blocked site
 * data); the tour then simply opens every time, which is the cheap mistake.
 */
const SEEN_KEY = "val-demo:tour-seen";

export function readDemoTourSeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeDemoTourSeen(): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, "true");
  } catch {
    // Nowhere to remember it: the tour opens again next load.
  }
}
