import type { Json } from "@valbuild/core";
import {
  applyPatch,
  JSONOps,
  type JSONValue,
  type Operation,
  type Patch,
} from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from "../components/AIChatToolActivities";
import type { AITool } from "./useAIWebSocket";
import { isJsonArray } from "../utils/isJsonArray";
import { settingsSectionOps } from "../utils/settingsSectionOps";
import { ASSISTANT_FIELDS } from "./assistantFields";

/**
 * `assistant.webSearch` as the project has it: on, off, or not decided.
 *
 * Three states, and the third is what `request_web_search` is for:
 *
 * - `true`: the assistant searches (see `webSearchGate.ts`).
 * - `false`: someone said no. The assistant does not search, and is not
 *   offered a way to ask: a project that decided is not asked again.
 * - `null`: nobody has decided. The assistant cannot search, but may ask the
 *   person to turn it on, and the Studio asks in its own words.
 *
 * Read from the settings module's SOURCE, so anything that is not a boolean
 * is not decided.
 */
export type WebSearchSetting = boolean | null;

export function readWebSearchSetting(
  settingsSource: Json | undefined,
): WebSearchSetting {
  if (
    typeof settingsSource !== "object" ||
    settingsSource === null ||
    isJsonArray(settingsSource)
  ) {
    return null;
  }
  const assistant = settingsSource["assistant"];
  if (
    typeof assistant !== "object" ||
    assistant === null ||
    isJsonArray(assistant)
  ) {
    return null;
  }
  const value = assistant["webSearch"];
  return typeof value === "boolean" ? value : null;
}

export const REQUEST_WEB_SEARCH_TOOL_NAME = "request_web_search";

/**
 * Ask the person to turn on web search for the project. Offered only while
 * nobody has decided (`null`): see {@link WebSearchSetting}.
 */
export const REQUEST_WEB_SEARCH_TOOL: AITool = {
  name: REQUEST_WEB_SEARCH_TOOL_NAME,
  description:
    "Ask the person to turn on web search for this project. You cannot search the web until they do. " +
    "Call it when answering needs something from outside this project: a current fact, a name or term to check, what a source says. " +
    "Do not ask in plain text instead, and do not change the setting any other way: the person sees a card from Val and decides. " +
    "If they turn it on, searching works from their next message. If they do not, answer as well as you can without it.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "What you would look up, in one plain sentence for the person: e.g. 'To check the current opening hours of the museum.'",
      },
    },
    required: ["reason"],
  },
  // Waits on the person, as ask_user_question does.
  timeoutMs: null,
};

/** The assistant's tools, with `request_web_search` only while undecided. */
export function withWebSearchRequest(
  tools: AITool[],
  setting: WebSearchSetting,
): AITool[] {
  return setting === null ? [...tools, REQUEST_WEB_SEARCH_TOOL] : tools;
}

const TURN_ON = "Turn on web search";
const DONT = "Don't turn on";

/**
 * The card. The question is Val's: only the reason is the assistant's, and it
 * is shown as the assistant's.
 */
export function webSearchRequestQuestions(
  reason: string | null,
): AskUserQuestionItem[] {
  return [
    {
      header: "Web search",
      question:
        "The assistant wants to search the web to answer this." +
        (reason ? ` It says: "${reason}"` : "") +
        " Turn on web search for this project?",
      options: [
        {
          label: TURN_ON,
          description:
            "For everyone on this project. Each search is billed to your AI key, and after a search the assistant asks before changing code. You can turn it off in Settings.",
        },
        {
          label: DONT,
          description:
            "The assistant will not ask again. You can turn it on in Settings.",
        },
      ],
    },
  ];
}

export type WebSearchRequestOutcome = {
  /** What to write to `assistant.webSearch`, or `null` to write nothing. */
  write: boolean | null;
  /** The tool's result, for the model. */
  result: { success: boolean; note?: string; error?: string };
};

/**
 * What the person's answer means. The first option turns it on, the second
 * turns it off for good (that is what "will not ask again" means). Closing
 * the card, or only typing an answer, decides nothing: they may be asked
 * another time.
 */
export function webSearchRequestOutcome(
  answers: AskUserQuestionAnswer[] | null,
): WebSearchRequestOutcome {
  const answer = answers?.[0];
  const said = answer?.customAnswer?.trim();
  if (answer !== undefined && answer.selectedOptions.includes(0)) {
    return {
      write: true,
      result: {
        success: true,
        note: "Web search is now on for this project. It works from the person's next message, not in this one: tell them, and that they can send their question again.",
      },
    };
  }
  if (answer !== undefined && answer.selectedOptions.includes(1)) {
    return {
      write: false,
      result: {
        success: false,
        error:
          "The person chose not to turn on web search, and will not be asked again. Answer without it, and say what you could not check.",
      },
    };
  }
  return {
    write: null,
    result: {
      success: false,
      error:
        "The person did not turn on web search" +
        (said ? `, and said: ${said}` : ".") +
        " Answer without it. Do not ask again in this answer.",
    },
  };
}

/** Whether the settings source has an `assistant` section to add a field to. */
export function hasAssistantSection(settingsSource: Json | undefined): boolean {
  if (
    typeof settingsSource !== "object" ||
    settingsSource === null ||
    isJsonArray(settingsSource)
  ) {
    return false;
  }
  const assistant = settingsSource["assistant"];
  return (
    typeof assistant === "object" &&
    assistant !== null &&
    !isJsonArray(assistant)
  );
}

/** The patch that writes the setting, as the Settings panel would. */
export function webSearchSettingOps(
  value: boolean,
  hasAssistantSection: boolean,
): Operation[] {
  return settingsSectionOps(
    "assistant",
    ASSISTANT_FIELDS,
    { webSearch: value },
    hasAssistantSection,
  );
}

/**
 * Whether a write moved `assistant.webSearch`. The assistant's own writes
 * (`create_patch` and the rest) are refused when it does: the setting is the
 * person's to change, through the Settings panel or `request_web_search`'s
 * card, and a model steered by something it read must not be able to turn
 * search on behind them.
 */
export function changesWebSearchSetting(
  before: Json | undefined,
  after: Json | undefined,
): boolean {
  return readWebSearchSetting(before) !== readWebSearchSetting(after);
}

const jsonOps = new JSONOps();

/**
 * Whether applying `patch` to a settings module's source would move
 * `assistant.webSearch`. A patch that does not apply moves nothing: the write
 * fails on its own, with its own error.
 */
export function patchChangesWebSearchSetting(
  settingsSource: Json | undefined,
  patch: Patch,
): boolean {
  if (settingsSource === undefined) {
    return false;
  }
  const copy: JSONValue = JSON.parse(JSON.stringify(settingsSource));
  const applied = applyPatch(
    copy,
    jsonOps,
    // File ops carry bytes, not a value the JSON patch can apply.
    patch.filter((op) => op.op !== "file"),
  );
  if (result.isErr(applied)) {
    return false;
  }
  return changesWebSearchSetting(settingsSource, applied.value);
}

/**
 * What the model is told about asking, while nobody has decided. Nothing when
 * the project has: on, `assistantSettingsPromptSection` says so; off, the
 * assistant is not told there is anything to ask for.
 */
export function webSearchRequestPromptSection(
  setting: WebSearchSetting,
): string {
  if (setting !== null) {
    return "";
  }
  return `\n\n## Web search is not on\nYou cannot search the web in this project. If answering needs something from outside it (a current fact, a name or term to check, what a source says), call ${REQUEST_WEB_SEARCH_TOOL_NAME} once, with what you would look up. Val asks the person. Do not ask in plain text, and do not try to change the setting yourself.`;
}
