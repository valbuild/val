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
 * Before `interact_page` clicks, or presses Enter or Space, in the preview
 * -- and before the page sends what the other actions made it try -- the
 * person is asked.
 *
 * The preview is the real site, and its backend is real: a click can send
 * an email, place an order, delete an account, and from outside the page a
 * harmless click and a harmful one look alike. So:
 *
 * - every click and every Enter or Space is asked about BEFORE it reaches
 *   the page (`ActionApproval`), naming the element as the page shows it;
 *   Allow sends the action back with the element's fingerprint, and the page
 *   asks again if the element changed meanwhile;
 * - what typing and the other actions make the page try to send is held
 *   unsent (`pageRequestGate.ts`), shown -- method, address, an excerpt of
 *   the body -- and Allow sends exactly that (`RequestsApproval`).
 *
 * The same mechanism as the web search gate (`webSearchGate.ts`): the call
 * is held, the Studio shows its OWN question on the tool's row, and the
 * answer runs the call again AS that answer. The question's words are the
 * Studio's, never the model's: a model talked into acting would write a
 * reassuring one. What it quotes from the page -- the element's words, the
 * addresses, the bodies -- is the site's own, checked by the Studio
 * (`trustedApproval`), shortened, and shown in quotes.
 */
export function pageSubmitQuestions(
  approval: PageApproval,
): AskUserQuestionItem[] {
  if (approval.kind === "action") {
    const what =
      approval.action === "click"
        ? "click"
        : `press ${approval.key ?? "a key"} on`;
    const named =
      approval.label !== ""
        ? `the ${approval.role} \u201c${approval.label}\u201d`
        : `a ${approval.role}`;
    return [
      {
        header: "Use the site",
        question:
          `The assistant wants to ${what} ${named} on ${approval.page} in the preview. ` +
          "This is the real site: a click can save, send, buy or delete something. Let it?",
        options: [
          {
            label: ALLOW,
            description:
              "Exactly this, once, on this element. If the page changed meanwhile, you are asked again.",
          },
          {
            label: DONT_ALLOW,
            description:
              "Nothing is done on the page, and the assistant is told you said no.",
          },
        ],
      },
    ];
  }
  const lines = approval.requests.map(
    (request) =>
      `${request.method} ${request.url}${
        request.body !== undefined ? ` \u201c${request.body}\u201d` : ""
      }`,
  );
  const on = approval.label !== "" ? ` on \u201c${approval.label}\u201d` : "";
  return [
    {
      header: "Send to the site",
      question:
        `While the assistant acted${on} on ${approval.page} in the preview, the page tried to send ` +
        `${lines.length === 1 ? "this request" : `these ${lines.length} requests`} to the real site, which may save, send or buy something: ` +
        `${lines.join("; ")}. Nothing has been sent yet. Send ${lines.length === 1 ? "it" : "them"}?`,
      options: [
        {
          label: ALLOW,
          description:
            "Exactly what is shown is sent, once, as the page tried to send it.",
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
      "The person did not allow it" +
      (said !== null ? `, and said: ${said}` : ".") +
      " Nothing was done or sent. Do not do it another way; say what you would have checked, and let them ask.",
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
  // An action not done holds nothing: there is nothing to drop.
  if (interactPage === null || approval.kind !== "requests") return;
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
 * `interact_page` as the Studio runs it: the action -- or, with `answered`,
 * the person's Allow -- and, when the page needs the person, them asked in
 * the Studio's words instead of an answer. What `useAI` calls for every
 * `interact_page`.
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
          "This needs the person's permission, and the chat is not available to ask. Nothing was done or sent.",
      },
      isError: true,
    });
    return;
  }
  deps.ask(pageSubmitQuestions(approval), approval);
}
