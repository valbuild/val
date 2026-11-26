import { useEffect, useMemo, useRef } from "react";
import { Internal } from "@valbuild/core";
import type {
  AIClientMessage,
  AIModel,
  AIServerMessage,
} from "./useAIWebSocket";
import type { AssistantPage } from "../components/shell/canvas/AssistantPage";
import {
  quickPreviewRunner,
  waitForStagedPreview,
} from "../proposals/quickPreviewControl";
import type { ProposalJson } from "../proposals/proposalsClient";
import type { ProposalsClient } from "../proposals/proposalsClient";
import type { ProjectReadDeps } from "../proposals/proposalCode";
import {
  checksLine,
  noteForMain,
  noteForPageCheck,
  PAGE_CHECK_DEADLINE_MS,
  PAGE_CHECK_MAX_ITERATIONS,
  PAGE_CHECK_SYSTEM_PROMPT,
  PAGE_CHECK_TOOLS,
  pageCheckFailed,
  pageCheckNotShown,
  pageCheckPrompt,
  type PageNotShown,
  pageCheckReported,
  pageCheckStarted,
  runPageCheckTool,
  takeNotesForPageCheck,
} from "../proposals/pageCheck";
import {
  createPageCheckScheduler,
  type PageCheckAsked,
  type PageCheckRequest,
} from "../proposals/pageCheckScheduler";
import { typecheckStatusOf } from "../proposals/useProposalTypecheck";
import { backgroundLintOf } from "../proposals/backgroundLint";
import { randomUUID } from "../utils/randomUUID";

/** What the assistant's side of the Studio tells the page check. */
export type PageCheckSession = {
  /** The assistant changed the proposal's code. */
  codeChanged: () => void;
  /** The assistant's turn ended. */
  turnEnded: () => void;
  /** The person sent a message: the checks it may run start over. */
  personWrote: () => void;
  /** `verify`: check now, with what to look at. */
  verify: (focus: string | null) => PageCheckAsked;
  /**
   * `message_verifier`: a note for a check that runs, read with its next
   * tool answer, or a check started with it.
   */
  message: (text: string) => PageCheckAsked | { status: "sent" };
  /** Whether there is a page to check: a preview is open. */
  canCheck: () => boolean;
  /** Checks left until the person writes again. */
  left: () => number;
};

/**
 * How long a page check waits for the staged files to be in front of the
 * person: Val Build making the quick preview (45 seconds is not unusual),
 * and the page in the preview loading it (`useQuickPreview` gives it 30).
 * Nobody waits on the check, so a long wait costs nothing; the wait ends
 * as soon as the preview says how it went. After it, the page is NOT read:
 * it is the last build, and the change is not on it.
 */
export const PAGE_CHECK_PREVIEW_WAIT_MS = 2 * 60_000;

/** Whether the change is on the page in the preview, once it is known. */
type PageOfChange =
  | { status: "shown"; line: string }
  | { status: "not-shown"; why: PageNotShown };

/**
 * Whether the page in the preview shows the staged files: the page check
 * looks at it only when it does. When the build the preview serves already
 * has them, it does. When it does not, it does once their quick preview is
 * in front -- which starts as the turn ends, when the check does -- so this
 * waits for the preview to say how it went (`waitForStagedPreview`).
 */
async function pageOf(
  staged: ProposalJson["staged"] | null,
): Promise<PageOfChange> {
  const served: PageOfChange = {
    status: "shown",
    line: "The page in the preview is the site's build, which has these files.",
  };
  if (staged === null || staged === undefined || staged.inputs === null) {
    return served;
  }
  if (!staged.buildRequired) return served;
  if (quickPreviewRunner() === null) {
    return { status: "not-shown", why: { reason: "no-quick-preview" } };
  }
  const preview = await waitForStagedPreview(
    staged.inputs,
    PAGE_CHECK_PREVIEW_WAIT_MS,
  );
  switch (preview.status) {
    case "shown":
      return {
        status: "shown",
        line: "The page in the preview is a quick preview of exactly these files: the change is on it.",
      };
    case "served":
      return served;
    case "failed":
      return {
        status: "not-shown",
        why: {
          reason: "failed",
          message: preview.message ?? "It did not say why.",
        },
      };
    case "off":
      return { status: "not-shown", why: { reason: "off" } };
    case "timeout":
      return {
        status: "not-shown",
        why: { reason: "timeout", waitedMs: PAGE_CHECK_PREVIEW_WAIT_MS },
      };
  }
}

/**
 * The page check (`proposals/pageCheck.ts`) as a hidden session on the
 * assistant's socket: one per chat, so it keeps what it learned of the
 * project from one check to the next. Its prompts are its own -- the chat's
 * handler ignores them, as it does the commit summary's -- and its tools are
 * answered here.
 */
export function usePageCheckSession(options: {
  sendWsMessage: (message: AIClientMessage) => boolean;
  subscribeToWsMessages: (
    handler: (message: AIServerMessage) => void,
  ) => () => void;
  /** The proposal the Studio is in. */
  proposalName: () => string | null;
  /** The page in the preview. */
  page: () => AssistantPage | null;
  /** The chat this check belongs to. */
  chatSessionId: () => string | null;
  /** The model it runs on: `pickPageCheckModel`. */
  model: AIModel | null;
  proposals: Pick<ProposalsClient, "files" | "get">;
  siteSource: ProjectReadDeps["siteSource"];
}): PageCheckSession {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** The page check's own session, per chat. */
  const sessionsRef = useRef(new Map<string, string>());
  /** Stops a check that never answers: `PAGE_CHECK_DEADLINE_MS`. */
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef<{
    promptId: string;
    name: string;
    inputs: string | null;
    reported: boolean;
  } | null>(null);

  const scheduler = useMemo(() => {
    /** The running check ended: why, when it did not report. */
    const finish = (failure: { message: string; details?: string } | null) => {
      const running = runningRef.current;
      runningRef.current = null;
      if (deadlineRef.current !== null) clearTimeout(deadlineRef.current);
      deadlineRef.current = null;
      if (running !== null && !running.reported) {
        const why = failure ?? {
          message: "The page check ended without saying what it saw.",
        };
        pageCheckFailed(running.name, why.message, why.details);
      }
      scheduler.finished();
    };
    const start = (request: PageCheckRequest): boolean => {
      const now = optionsRef.current;
      const name = now.proposalName();
      const chat = now.chatSessionId();
      if (
        name === null ||
        chat === null ||
        now.model === null ||
        now.page() === null
      ) {
        // Nothing to check here: not a failure, so nothing is shown, and
        // the check is not counted.
        return false;
      }
      const promptId = randomUUID();
      runningRef.current = { promptId, name, inputs: null, reported: false };
      const model = now.model;
      void now.proposals
        .get(name)
        .then((proposal) => proposal.staged ?? null)
        .catch(() => null)
        .then(async (staged) => ({
          staged,
          page: await pageOf(staged),
        }))
        .then(({ staged, page }) => {
          if (runningRef.current?.promptId !== promptId) return;
          const inputs = staged?.inputs ?? null;
          runningRef.current = { ...runningRef.current, inputs };
          if (page.status === "not-shown") {
            // Said without a model: asked to judge a page the change is not
            // on, one reports the change missing, and the assistant goes
            // back to fix what it already fixed.
            runningRef.current.reported = true;
            pageCheckNotShown(name, inputs, page.why);
            finish(null);
            return;
          }
          pageCheckStarted(name, inputs);
          const typecheck = typecheckStatusOf(name);
          const lint = backgroundLintOf(name);
          let sessionId = sessionsRef.current.get(chat);
          if (sessionId === undefined) {
            sessionId = randomUUID();
            sessionsRef.current.set(chat, sessionId);
          }
          const sent = optionsRef.current.sendWsMessage({
            type: "ai_prompt",
            id: promptId,
            sessionId,
            hidden: true,
            maxIterations: PAGE_CHECK_MAX_ITERATIONS,
            message: pageCheckPrompt(request, {
              stagedFiles: staged?.files ?? [],
              typecheck: checksLine(
                typecheck.status === "done"
                  ? {
                      status: "done",
                      count: typecheck.errors.length,
                      current: typecheck.inputs === inputs,
                    }
                  : typecheck,
                "type errors",
              ),
              lint: checksLine(
                lint.status === "done"
                  ? {
                      status: "done",
                      count: lint.problems.length,
                      current: lint.inputs === inputs,
                    }
                  : lint.status === "idle"
                    ? { status: "none" }
                    : lint,
                "problems",
              ),
              page: page.line,
            }),
            agents: [
              {
                id: "page-check",
                model,
                systemPrompt: PAGE_CHECK_SYSTEM_PROMPT,
                tools: PAGE_CHECK_TOOLS,
              },
            ],
          });
          if (!sent) {
            finish({ message: "Val Build's AI service could not be reached." });
            return;
          }
          // An answer that never comes would leave it running, and every
          // check after it waiting: it is stopped instead.
          deadlineRef.current = setTimeout(() => {
            if (runningRef.current?.promptId !== promptId) return;
            optionsRef.current.sendWsMessage({
              type: "ai_cancel",
              id: promptId,
            });
            finish({
              message: "The page check took too long, and was stopped.",
            });
          }, PAGE_CHECK_DEADLINE_MS);
        });
      return true;
    };
    const scheduler = createPageCheckScheduler(start);
    return Object.assign(scheduler, { finish });
  }, []);

  useEffect(() => {
    const handler = (message: AIServerMessage) => {
      const running = runningRef.current;
      if (running === null || !("id" in message)) return;
      if (message.id !== running.promptId) return;
      if (message.type === "ai_tool_call") {
        const now = optionsRef.current;
        const page = now.page();
        void runPageCheckTool(message.name, message.arguments, {
          readPage: page?.readPage() ?? null,
          readPageLog: page?.readPageLog() ?? null,
          project: {
            proposal: { name: running.name },
            client: now.proposals,
            siteSource: now.siteSource,
          },
          onReport: (report) => {
            running.reported = true;
            pageCheckReported(running.name, running.inputs, report);
          },
          onMessage: (text) => noteForMain(running.name, text),
        }).then(({ result, isError }) => {
          const notes = takeNotesForPageCheck();
          optionsRef.current.sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result:
              notes.length === 0
                ? result
                : { result, messages_from_main: notes },
            ...(isError ? { isError: true } : {}),
          });
        });
      } else if (message.type === "ai_response") {
        scheduler.finish(null);
      } else if (message.type === "ai_error") {
        Internal.log.debug("The page check failed:", message.message);
        scheduler.finish({
          message: "The AI service did not finish the page check.",
          details: message.message,
        });
      } else if (message.type === "ai_cancelled") {
        scheduler.finish({ message: "The page check was stopped." });
      }
    };
    return options.subscribeToWsMessages(handler);
  }, [options.subscribeToWsMessages, scheduler]);

  // Leaving: no timer goes off later, and a check running is stopped.
  useEffect(
    () => () => {
      scheduler.dispose();
      const running = runningRef.current;
      if (running !== null) {
        optionsRef.current.sendWsMessage({
          type: "ai_cancel",
          id: running.promptId,
        });
      }
    },
    [scheduler],
  );

  return useMemo<PageCheckSession>(
    () => ({
      codeChanged: () => scheduler.codeChanged(),
      turnEnded: () => scheduler.turnEnded(),
      personWrote: () => scheduler.personWrote(),
      verify: (focus) => scheduler.checkNow({ reason: "verify", focus }),
      message: (text) => {
        if (runningRef.current !== null) {
          noteForPageCheck(text);
          return { status: "sent" };
        }
        return scheduler.checkNow({ reason: "message", focus: text });
      },
      canCheck: () =>
        optionsRef.current.page() !== null && optionsRef.current.model !== null,
      left: () => scheduler.left(),
    }),
    [scheduler],
  );
}
