import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from "../components/AIChatToolActivities";
import type { AITool } from "./useAIWebSocket";

/**
 * After a web search, the assistant asks the person before it changes code.
 *
 * A search puts text a stranger wrote in front of the model, and a model can
 * follow instructions it reads there. Code is where following them does the
 * most harm: it can fetch, it can leak, and a build ships it. So once a turn
 * has searched (the server says so with `ai_web_search`), the tools here wait
 * for the person, the rest of that turn. Their next message starts clean: it
 * is a new instruction from them.
 *
 * The question is the Studio's, never the model's. If the model wrote it, a
 * model steered by a page would write a reassuring one.
 *
 * Content edits are not gated: they are drafts in a proposal already, seen and
 * reverted like any other. `request_code_mode` is not either: it is a card the
 * person answers already. See `docs/plans/assistant-web-search.md` in
 * valbuild/home.
 */
export const WEB_GATED_TOOLS: ReadonlySet<string> = new Set([
  "write_files",
  "build_proposal",
]);

/**
 * The tools as sent, when the agent may search: a gated tool can wait on the
 * person, so it waits as long as a question does (`timeoutMs: null`). Without
 * this the server gives up on `write_files` after its default 30 seconds,
 * while the card is still on screen.
 */
export function withWebSearchWaits(
  tools: AITool[],
  webSearch: boolean,
): AITool[] {
  if (!webSearch) {
    return tools;
  }
  return tools.map((tool) =>
    WEB_GATED_TOOLS.has(tool.name) ? { ...tool, timeoutMs: null } : tool,
  );
}

/** Does this call wait for the person, given what the turn has done? */
export function needsWebSearchConfirmation(
  toolName: string,
  turnSearchedTheWeb: boolean,
): boolean {
  return turnSearchedTheWeb && WEB_GATED_TOOLS.has(toolName);
}

const ALLOW = "Allow";
const DONT_ALLOW = "Don't allow";

/** The card shown in place of the tool's own row while it waits. */
export function webSearchConfirmationQuestions(
  toolName: string,
): AskUserQuestionItem[] {
  return [
    {
      header: "After a web search",
      question:
        toolName === "build_proposal"
          ? "The assistant read web pages in this answer and now wants to build the site. Pages can contain instructions meant for it. Build anyway?"
          : "The assistant read web pages in this answer and now wants to change the site's code. Pages can contain instructions meant for it. Let it?",
      options: [
        {
          label: ALLOW,
          description: "You can review the change before it is published.",
        },
        {
          label: DONT_ALLOW,
          description: "The assistant is told you said no.",
        },
      ],
    },
  ];
}

export type WebSearchConfirmation =
  | { allow: true }
  | { allow: false; result: { success: false; error: string } };

/**
 * What the person's answer means. Only the first option is a yes: an answer
 * typed into "Other" is something to tell the model, not a permission.
 */
export function webSearchConfirmationOf(
  answers: AskUserQuestionAnswer[] | null,
): WebSearchConfirmation {
  const answer = answers?.[0];
  if (answer !== undefined && answer.selectedOptions.includes(0)) {
    return { allow: true };
  }
  const said = answer?.customAnswer?.trim();
  return {
    allow: false,
    result: {
      success: false,
      error:
        "The person did not allow this after your web search" +
        (said ? `, and said: ${said}` : ".") +
        " Do not try again in this answer. Say what you would have changed, and let them ask.",
    },
  };
}
