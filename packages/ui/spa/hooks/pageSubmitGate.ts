import type { SubmitApproval } from "@valbuild/shared/internal";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from "../components/AIChatToolActivities";
import { runInteractPage, type InteractPageDeps } from "./pageTools";
import {
  ALLOW,
  DONT_ALLOW,
  gateConfirmationOf,
  type GateConfirmation,
} from "./webSearchGate";

/**
 * Before `interact_page` submits a form, the assistant asks the person.
 *
 * The preview is the real site, and its forms reach the real backend: a
 * submit can send an email, place an order, delete an account. From inside
 * the page a search box and a checkout look alike, so every submit waits --
 * a submit button clicked, or Enter in a form's field -- and the page answers
 * `needs-approval` without doing it (`pageInteraction.ts`). Everything else
 * the tool does is the page's own business and does not ask.
 *
 * The same mechanism as the web search gate (`webSearchGate.ts`): the call is
 * held, the Studio shows its OWN question on the tool's row, and an Allow
 * runs the call again, this time allowed. The question's words are the
 * Studio's, never the model's: a model talked into submitting would write a
 * reassuring one. What it quotes from the page -- the button's label, the
 * form's address -- is the site's own, shown as a quote.
 */
export function pageSubmitQuestions(
  approval: SubmitApproval,
): AskUserQuestionItem[] {
  const button =
    approval.label !== "" ? ` with its “${approval.label}” button` : "";
  const how =
    approval.via === "press" ? "by pressing Enter in it" : "by clicking";
  return [
    {
      header: "Submit a form",
      question:
        `The assistant wants to submit a form on ${approval.page}${button}, ${how}. ` +
        `It sends a ${approval.method} to ${approval.action} on the real site, which may save, send or buy something. Let it?`,
      options: [
        {
          label: ALLOW,
          description: "The form is submitted once, as if you had.",
        },
        {
          label: DONT_ALLOW,
          description: "Nothing is sent. The assistant is told you said no.",
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
      "The person did not allow the form to be submitted" +
      (said !== null ? `, and said: ${said}` : ".") +
      " Nothing was sent. Do not submit it another way; say what you would have checked, and let them ask.",
  );
}

/** What {@link runGatedInteractPage} needs from the chat around it. */
export type GatedInteractDeps = InteractPageDeps & {
  /**
   * Ask the person before the call goes on: show these questions on the
   * call's row and hold the call, to run again allowed. `null` when there is
   * no chat to ask in, and then the submit is refused.
   */
  ask: ((questions: AskUserQuestionItem[]) => void) | null;
  /** The call's answer, for the model. */
  answer: (answer: { result: unknown; isError: boolean }) => void;
};

/**
 * `interact_page` as the Studio runs it: the action, and -- when the page
 * says it would submit a form -- the person asked first, in the Studio's
 * words, instead of an answer. What `useAI` calls for every `interact_page`,
 * the first time and again once the person allowed it (`allowSubmit`).
 */
export async function runGatedInteractPage(
  args: unknown,
  deps: GatedInteractDeps,
): Promise<void> {
  const { result, isError, approval } = await runInteractPage(args, deps);
  if (approval === undefined) {
    deps.answer({ result, isError });
    return;
  }
  if (deps.ask === null) {
    deps.answer({
      result: {
        success: false,
        error:
          "Submitting this form needs the person's permission, and the chat is not available to ask. Nothing was sent; do not submit it.",
      },
      isError: true,
    });
    return;
  }
  deps.ask(pageSubmitQuestions(approval));
}
