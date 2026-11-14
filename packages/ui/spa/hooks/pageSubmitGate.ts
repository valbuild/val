import type { PageApproval } from "@valbuild/shared/internal";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from "../components/AIChatToolActivities";
import type { PageInteractor } from "../components/shell/canvas/CanvasFrame";
import { runInteractPage, type InteractPageDeps } from "./pageTools";
import {
  ALLOW,
  DONT_ALLOW,
  gateConfirmationOf,
  type GateConfirmation,
} from "./webSearchGate";

/**
 * Before the page in the preview sends anything to the site's server
 * because of `interact_page`, the person is asked.
 *
 * The preview is the real site, and its backend is real: a request can send
 * an email, place an order, delete an account. What the page sends is held
 * unsent while an action runs (`pageRequestGate.ts`), and the page answers
 * `needs-approval` with exactly what it tried -- method and address, as the
 * browser resolved them, and checked by the Studio (`trustedApproval`).
 *
 * The same mechanism as the web search gate (`webSearchGate.ts`): the call
 * is held, the Studio shows its OWN question on the tool's row, and the
 * answer runs the call again -- here not by doing the action again, but by
 * sending or refusing exactly the requests that were shown (`release`). The
 * question's words are the Studio's, never the model's: a model talked into
 * sending would write a reassuring one. What it quotes from the page -- what
 * was clicked, the addresses -- is the site's own, shortened and quoted.
 */
export function pageSubmitQuestions(
  approval: PageApproval,
): AskUserQuestionItem[] {
  const [first, ...more] = approval.requests;
  const what =
    first === undefined
      ? "a request"
      : `${first.method} ${first.url}${
          more.length > 0
            ? ` and ${more.length} more request${more.length === 1 ? "" : "s"}`
            : ""
        }`;
  const on = approval.label !== "" ? ` on “${approval.label}”` : "";
  return [
    {
      header: "Send to the site",
      question:
        `The assistant acted${on} on ${approval.page} in the preview, and the page tried to send ${what} to the real site, which may save, send or buy something. ` +
        "Nothing has been sent yet. Send it?",
      options: [
        {
          label: ALLOW,
          description:
            "Exactly what the page tried is sent, once, as if you had done it.",
        },
        {
          label: DONT_ALLOW,
          description:
            "Nothing is sent: the page is told the request failed, and the assistant that you said no.",
        },
      ],
    },
  ];
}

/** What the person's answer to {@link pageSubmitQuestions} means. */
export function pageSubmitConfirmationOf(
  answers: AskUserQuestionAnswer[] | null,
): GateConfirmation {
  return gateConfirmationOf(
    answers,
    (said) =>
      "The person did not allow what the page tried to send" +
      (said !== null ? `, and said: ${said}` : ".") +
      " Nothing was sent. Do not send it another way; say what you would have checked, and let them ask.",
  );
}

/**
 * Tell the page the person did not allow what it held: it drops it, and the
 * page's request fails as an abort. Best effort -- a page that has gone
 * took what it held with it.
 */
export function refusePageApproval(
  interactPage: PageInteractor | null,
  approval: PageApproval,
): void {
  if (interactPage === null) return;
  void interactPage({
    action: { kind: "release", hold: approval.hold, allow: false },
  }).catch(() => {});
}

/** What {@link runGatedInteractPage} needs from the chat around it. */
export type GatedInteractDeps = InteractPageDeps & {
  /**
   * Ask the person before the call goes on: show these questions on the
   * call's row and hold the call, with the approval to answer. `null` when
   * there is no chat to ask in: then what the page held is refused.
   */
  ask:
    | ((questions: AskUserQuestionItem[], approval: PageApproval) => void)
    | null;
  /** The call's answer, for the model. */
  answer: (answer: { result: unknown; isError: boolean }) => void;
  /**
   * Whether the turn is still the one that made the call: false once the
   * person pressed Stop or left the session. Then nothing is asked or
   * answered, and what the page held is refused.
   */
  isCurrent?: () => boolean;
};

/**
 * `interact_page` as the Studio runs it: the action -- or, with `release`,
 * the person's answer about what it held -- and, when the page tried to
 * send something, the person asked in the Studio's words instead of an
 * answer. What `useAI` calls for every `interact_page`.
 */
export async function runGatedInteractPage(
  args: unknown,
  deps: GatedInteractDeps,
): Promise<void> {
  const { result, isError, approval } = await runInteractPage(args, deps);
  if (deps.isCurrent !== undefined && !deps.isCurrent()) {
    // Stopped while the page was busy: nobody is there to ask or to tell.
    if (approval !== undefined) {
      refusePageApproval(deps.interactPage, approval);
    }
    return;
  }
  if (approval === undefined) {
    deps.answer({ result, isError });
    return;
  }
  if (deps.ask === null) {
    refusePageApproval(deps.interactPage, approval);
    deps.answer({
      result: {
        success: false,
        error:
          "The page tried to send data to the site's server, which needs the person's permission, and the chat is not available to ask. Nothing was sent.",
      },
      isError: true,
    });
    return;
  }
  deps.ask(pageSubmitQuestions(approval), approval);
}
