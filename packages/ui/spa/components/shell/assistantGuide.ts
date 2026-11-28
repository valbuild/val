import { z } from "zod";
import { Internal, type SourcePath } from "@valbuild/core";
import type { AITool } from "../../hooks/useAIWebSocket";
import { isSourcePath } from "../../utils/sourcePath";
import type { TourMoveOn, TourRun, TourStep, TourStepEnd } from "./tourSteps";
import type { ShellTour } from "./shellTour";
import type { ShellPanel } from "./types";

/*
 * The assistant showing someone how to do something in the Studio, rather
 * than doing it for them or describing where it is: `show_guide`.
 *
 * It is the guided tour (`StudioTour`) with steps the assistant wrote. The
 * tour already points at a control, a field or a place on the page, already
 * moves on when the person has done what a step asks, and already has "Do it
 * for me". What this file adds is the translation from what a model can be
 * trusted to write -- a small, closed vocabulary -- into tour steps, and the
 * answer that goes back to it.
 *
 * The person is ASKED first (`GuideRequest`, a card in the chat): someone
 * who wanted an answer did not necessarily want a lesson.
 */

/**
 * The Studio's controls a step can point at, by the name the assistant uses,
 * with what each one is, for the tool's description.
 *
 * The same names as the `data-val-tour` markers, which is the point: a name
 * here is a marker in the DOM, so there is nothing to keep in step. A control
 * the screen does not draw -- the rail on a phone -- falls back to the one
 * drawn for it (the phone's menu button carries `pages media data settings`).
 */
const CONTROL_NAMES = [
  "pages",
  "media",
  "data",
  "settings",
  "new-page",
  "review",
  "preview",
  "publish",
  "locale",
  "canvas",
] as const;
export type GuideControl = (typeof CONTROL_NAMES)[number];
export const GUIDE_CONTROLS: Record<GuideControl, string> = {
  pages: "Pages: every URL of the site. Opens the Pages panel.",
  media: "Media: images and files. Opens the Media panel.",
  data: "Data: content that is not a page (menus, footers, shared text). Opens the Data panel.",
  settings: "Settings: the project's settings. Opens the Settings panel.",
  "new-page": "The + New button in the Pages panel, which adds a page.",
  review: "Review: every unpublished change, side by side with what is live.",
  preview: "Preview: the site itself, with the drafts in it.",
  publish:
    "Publish (Save when running locally): sends the changes to the site.",
  locale: "The language picker, where the project has more than one language.",
  canvas: "The page in the preview, as a whole.",
};

/** How many rows of an open panel the assistant is told about. */
const ROWS_LISTED = 60;

/**
 * What a guide can point at right now, from the tour targets on screen
 * (`tourTargetsOnScreen`), in the terms `show_guide` takes: for
 * `get_current_context`, so the assistant does not point at a control the
 * screen is not showing.
 */
export function guideTargetsOnScreen(names: string[]): {
  controls: GuideControl[];
  pageRows: string[];
  moduleRows: string[];
} {
  const controls = CONTROL_NAMES.filter((name) => names.includes(name));
  const rows = (prefix: string) =>
    names
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .slice(0, ROWS_LISTED);
  return {
    controls,
    pageRows: rows("page:"),
    moduleRows: rows("module:"),
  };
}

/** The panels a step can wait for. Not the assistant: they are in it. */
const GUIDE_PANELS = ["pages", "media", "data", "settings"] as const;

/*
 * A URL or a file path, used as one token of a `data-val-tour` marker: no
 * whitespace (it would be two tokens) and no quote (it would end the selector
 * the tour looks it up with).
 */
const markerToken = z
  .string()
  .min(1)
  .regex(/^[^\s"\\]+$/, "No spaces or quotes.");

const PointAt = z.union([
  z.object({ control: z.enum(CONTROL_NAMES) }).strict(),
  z.object({ page_row: markerToken }).strict(),
  z.object({ module_row: markerToken }).strict(),
  z.object({ field: z.string() }).strict(),
  z.object({ on_page: z.string() }).strict(),
]);

const DoneWhen = z.union([
  z.object({ panel_open: z.enum(GUIDE_PANELS) }).strict(),
  z.object({ opened: z.string() }).strict(),
  z.object({ changed: z.literal(true) }).strict(),
  z.object({ page_added: z.string() }).strict(),
  z.object({ language_changed: z.literal(true) }).strict(),
]);

export const ShowGuideArgs = z.object({
  title: z.string().min(1),
  why: z.string().optional(),
  steps: z
    .array(
      z.object({
        point_at: PointAt.optional(),
        title: z.string().min(1),
        text: z.string().min(1),
        done_when: DoneWhen.optional(),
      }),
    )
    .min(1)
    .max(8),
});
export type ShowGuideArgs = z.infer<typeof ShowGuideArgs>;

/** The card in the chat, through its life. See `GuideRequestCard`. */
export type GuideRequest = {
  title: string;
  /** Why the assistant offers it, in its own words. */
  why?: string;
  stepCount: number;
  state:
    | { kind: "offered" }
    | { kind: "showing"; step: number }
    | { kind: "declined" }
    | { kind: "ended"; outcome: GuideOutcome };
};

/** How the tour went, which is what the assistant is told. */
export type GuideOutcome = {
  /** The last step was done, rather than the tour left part way. */
  finished: boolean;
  /** How many steps were shown: one more than were left, when stopped. */
  reached: number;
  /** How each step that was left was left, in order. */
  steps: TourStepEnd[];
  /**
   * Left from the phone's "Back to chat" rather than the X or Escape: they
   * want to talk, not to stop.
   */
  backToChat?: boolean;
};

/**
 * The assistant's steps, as tour steps -- or what was wrong with them, said
 * so the model can fix it.
 *
 * Every content path is checked to BE one here: the tour takes a
 * `SourcePath`, and a malformed one would otherwise be a ring around nothing
 * and a step that can never be done.
 */
export function guideTourSteps(
  args: ShowGuideArgs,
): { steps: TourStep[] } | { error: string } {
  const steps: TourStep[] = [];
  for (const [index, step] of args.steps.entries()) {
    const where = `steps[${index}]`;
    const tourStep: TourStep = {
      id: `guide-${index}`,
      title: step.title,
      body: step.text,
    };
    const point = step.point_at;
    if (point !== undefined) {
      if ("control" in point) {
        tourStep.target = point.control;
      } else if ("page_row" in point) {
        tourStep.target = `page:${point.page_row}`;
      } else if ("module_row" in point) {
        tourStep.target = `module:${point.module_row}`;
      } else if ("field" in point) {
        const field = sourcePathOf(point.field);
        if (field === null) {
          return { error: `${where}.point_at.field is not a source path.` };
        }
        tourStep.field = field;
      } else {
        const onPage = sourcePathOf(point.on_page);
        if (onPage === null) {
          return { error: `${where}.point_at.on_page is not a source path.` };
        }
        // The page outlines it itself, and the ring goes round the page.
        tourStep.page = onPage;
        tourStep.target = "canvas";
      }
    }
    if (step.done_when !== undefined) {
      const moveOn = moveOnOf(step.done_when);
      if ("error" in moveOn) {
        return { error: `${where}.done_when: ${moveOn.error}` };
      }
      tourStep.moveOn = moveOn;
    }
    steps.push(tourStep);
  }
  return { steps };
}

function moveOnOf(
  doneWhen: z.infer<typeof DoneWhen>,
): TourMoveOn | { error: string } {
  if ("panel_open" in doneWhen) {
    const panel: ShellPanel = doneWhen.panel_open;
    return { type: "panel", panel };
  }
  if ("opened" in doneWhen) {
    const path = sourcePathOf(doneWhen.opened);
    if (path === null) return { error: "opened is not a source path." };
    return { type: "open", path };
  }
  if ("page_added" in doneWhen) {
    const path = sourcePathOf(doneWhen.page_added);
    if (path === null) {
      return {
        error:
          "page_added is not a source path: the page router's module with the new page's key, e.g. /app/blog/[slug]/page.val.ts?p=\"/blog/my-post\".",
      };
    }
    return { type: "newPage", path };
  }
  if ("language_changed" in doneWhen) return { type: "locale" };
  // Nothing to write: the person makes the change, and the assistant can
  // write it with create_patch if they would rather it did.
  return { type: "edit" };
}

/**
 * `value` as a source path, or null when it is not one -- including one whose
 * `?p=` part the core parser refuses (`?p="title`, an unclosed quote), which
 * `isSourcePath` alone lets through and which would throw later, when "Do it
 * for me" opened or added it.
 */
function sourcePathOf(value: string): SourcePath | null {
  if (!isSourcePath(value)) return null;
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(value);
  try {
    Internal.splitModulePath(modulePath);
  } catch {
    return null;
  }
  return value;
}

/** What the assistant is told when the card is answered or the tour ends. */
export function guideResult(request: GuideRequest): Record<string, unknown> {
  switch (request.state.kind) {
    case "offered":
    case "showing":
      return { status: request.state.kind };
    case "declined":
      return {
        status: "declined",
        note: "They did not want to be shown. Answer in words instead, or do it for them if they ask.",
      };
    case "ended": {
      const { finished, reached, steps, backToChat } = request.state.outcome;
      return {
        status: finished ? "finished" : "stopped",
        stepsTotal: request.stepCount,
        stepsReached: reached,
        steps,
        ...(backToChat
          ? {
              note: "They went back to the chat part way: they probably have a question.",
            }
          : {}),
      };
    }
  }
}

export const SHOW_GUIDE_TOOL: AITool = {
  name: "show_guide",
  description:
    "Offer to SHOW the person how to do something in the Studio, step by step, so they learn where it is and can do it themselves next time. " +
    "The person sees a card in the chat with 'Show me how' and 'No thanks'; nothing happens until they choose. " +
    "When they choose to be shown, each step draws a box around one thing in the Studio with a short card beside it, and the Studio stays usable. " +
    "A step with done_when moves on by itself when the person does it, and offers 'Do it for me'; one without has a Next button. " +
    "A guide with one step is a single pointer, for 'where is…' questions. " +
    "The call answers when they decline, finish, or stop: { status: 'declined' | 'finished' | 'stopped', steps: ['did-it' | 'done-for-them' | 'skipped' | 'read', ...] }. " +
    "Use it when someone asks how to do something, or where something is, in the Studio. Do not use it to make changes they asked YOU to make. " +
    "Point only at things that exist: get_current_context lists what is on screen (guideTargets).",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "What they will learn, as a short task: 'Add a blog post', 'Change the footer'. Shown on the card.",
      },
      why: {
        type: "string",
        description:
          "Optional one sentence for the card, e.g. 'It takes three taps, and you can do each one yourself.'",
      },
      steps: {
        type: "array",
        description: "1-8 steps, in the order they are done.",
        items: {
          type: "object",
          properties: {
            point_at: {
              type: "object",
              description:
                "What to draw the box around. Exactly one of: " +
                `{ control: ${CONTROL_NAMES.map((name) => `'${name}'`).join(" | ")} }; ` +
                "{ page_row: '/blog' } for a row in the Pages panel, by its URL (the panel must be open); " +
                "{ module_row: '/content/footer.val.ts' } for a row in the Data or Media panel (the panel must be open); " +
                "{ field: '<source path>' } for a field in the editor (it must be open); " +
                "{ on_page: '<source path>' } for something on the page in the preview. " +
                "Leave it out for a step with nothing to point at. " +
                "Controls: " +
                CONTROL_NAMES.map(
                  (name) => `${name} -- ${GUIDE_CONTROLS[name]}`,
                ).join(" "),
            },
            title: {
              type: "string",
              description:
                "What to do, as an instruction of a few words: 'Open Pages', 'Tap + New'.",
            },
            text: {
              type: "string",
              description:
                "One or two plain sentences. Name the thing so it can be found without the box: on a phone it may be behind the menu.",
            },
            done_when: {
              type: "object",
              description:
                "What moves the step on by itself. Exactly one of: " +
                "{ panel_open: 'pages' | 'media' | 'data' | 'settings' }; " +
                "{ opened: '<source path>' } when that field, or anything inside it, is opened; " +
                "{ changed: true } when they make any change; " +
                "{ page_added: '<router module path>?p=\"<new key>\"' } when that page is added; " +
                "{ language_changed: true }. " +
                "Leave it out for a step that is only read.",
            },
          },
          required: ["title", "text"],
        },
      },
    },
    required: ["title", "steps"],
  },
  // Waits on the person: first for their answer, then for the tour.
  timeoutMs: null,
};

/**
 * One `show_guide` call, from the offer to the answer: what the chat's card
 * shows at each point, and the one answer the assistant gets.
 *
 * Kept out of `useAI` so the lifecycle has one implementation a test can
 * drive: the hook only says where the card and the answer go.
 */
export type GuideCall = {
  request: () => GuideRequest;
  /** "Show me how": the tour starts at its first step. */
  start: (tour: ShellTour) => void;
  /** "No thanks". */
  decline: () => void;
  /** The card's Stop: the tour closes, and the assistant is told. */
  stop: (tour: ShellTour) => void;
  /**
   * The call is no longer the assistant's to answer -- its turn was stopped,
   * or the conversation went away: close the tour, settle the card, and
   * answer nothing, since there is nobody waiting. It cannot be started
   * after this.
   */
  retire: (tour: ShellTour | null) => void;
};

export function createGuideCall({
  title,
  why,
  steps,
  onChange,
  onAnswer,
}: {
  title: string;
  why?: string;
  steps: TourStep[];
  /** The card moved on. */
  onChange: (request: GuideRequest) => void;
  /** Declined or ended: once, and the card has moved on already. */
  onAnswer: (request: GuideRequest) => void;
}): GuideCall {
  let request: GuideRequest = {
    title,
    ...(why !== undefined ? { why } : {}),
    stepCount: steps.length,
    state: { kind: "offered" },
  };
  let run: TourRun | null = null;
  let answered = false;
  const ends: TourStepEnd[] = [];
  let reached = 0;
  let finished = false;
  const move = (state: GuideRequest["state"]) => {
    request = { ...request, state };
    onChange(request);
  };
  const answer = (state: GuideRequest["state"]) => {
    if (answered) return;
    answered = true;
    move(state);
    onAnswer(request);
  };
  return {
    request: () => request,
    start(tour) {
      if (answered || request.state.kind !== "offered") return;
      run = {
        steps,
        from: "assistant",
        onStepChange: (index) => {
          reached = Math.max(reached, index + 1);
          if (!answered) move({ kind: "showing", step: index });
        },
        onStepEnd: (index, how) => {
          ends[index] = how;
        },
        onFinish: () => {
          finished = true;
        },
        onClose: ({ backToChat }) =>
          answer({
            kind: "ended",
            outcome: {
              finished,
              reached,
              steps: ends.slice(),
              ...(backToChat ? { backToChat } : {}),
            },
          }),
      };
      move({ kind: "showing", step: 0 });
      tour.start(run);
    },
    decline() {
      if (request.state.kind !== "offered") return;
      answer({ kind: "declined" });
    },
    stop(tour) {
      if (run !== null) tour.stop(run);
    },
    retire(tour) {
      if (answered) return;
      answered = true;
      if (run !== null) tour?.stop(run);
      move(
        request.state.kind === "offered"
          ? { kind: "declined" }
          : {
              kind: "ended",
              outcome: { finished, reached, steps: ends.slice() },
            },
      );
    },
  };
}
