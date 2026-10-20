import type { TourStep } from "../components/shell/tourSteps";
import type { ShellDestination } from "../components/shell/types";

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
