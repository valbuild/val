import { useEffect, useMemo, useRef } from "react";
import { Internal } from "@valbuild/core";
import type {
  AIClientMessage,
  AIModel,
  AIServerMessage,
} from "./useAIWebSocket";
import type { AssistantPage } from "../components/shell/canvas/AssistantPage";
import type { ProposalsClient } from "../proposals/proposalsClient";
import type { ProjectReadDeps } from "../proposals/proposalCode";
import {
  checksLine,
  noteForMain,
  noteForPageCheck,
  PAGE_CHECK_MAX_ITERATIONS,
  PAGE_CHECK_SYSTEM_PROMPT,
  PAGE_CHECK_TOOLS,
  pageCheckFailed,
  pageCheckPrompt,
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
  const runningRef = useRef<{
    promptId: string;
    name: string;
    inputs: string | null;
    reported: boolean;
  } | null>(null);

  const scheduler = useMemo(() => {
    const finish = (message: string | null) => {
      const running = runningRef.current;
      runningRef.current = null;
      if (running !== null && !running.reported) {
        pageCheckFailed(
          running.name,
          message ?? "The page check ended without saying what it saw.",
        );
      }
      scheduler.finished();
    };
    const start = (request: PageCheckRequest) => {
      const now = optionsRef.current;
      const name = now.proposalName();
      const chat = now.chatSessionId();
      if (
        name === null ||
        chat === null ||
        now.model === null ||
        now.page() === null
      ) {
        // Nothing to check here: not a failure, so nothing is shown.
        scheduler.finished();
        return;
      }
      const promptId = randomUUID();
      runningRef.current = { promptId, name, inputs: null, reported: false };
      const model = now.model;
      void now.proposals
        .get(name)
        .then((proposal) => proposal.staged ?? null)
        .catch(() => null)
        .then((staged) => {
          if (runningRef.current?.promptId !== promptId) return;
          const inputs = staged?.inputs ?? null;
          runningRef.current = { ...runningRef.current, inputs };
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
          if (!sent) finish("The AI service could not be reached.");
        });
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
        scheduler.finish(message.message);
      } else if (message.type === "ai_cancelled") {
        scheduler.finish("The page check was stopped.");
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
