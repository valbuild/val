import type { AITool } from "../hooks/useAIWebSocket";
import type { ProposalBuildOutcome as Outcome } from "@valbuild/shared/publish";
import { proposalProject, withoutLockfiles } from "@valbuild/shared/publish";
import type { PickedElement } from "@valbuild/shared/internal";
export { proposalProject };
import { formatWithProjectPrettier, type FormatOutcome } from "./formatCode";
import { lintWithValRules, pathsToLint } from "./lintCode";
import { codeModeOffMessage, type CodeModeNow } from "./codeMode";
import {
  markStagedCodeTold,
  stagedCodeNotice,
  type StagedCodeOutcome,
} from "./stagedCode";
import type {
  ProposalJson,
  ProposalsClient,
  ProposalStaged,
  ProposalTypeError,
} from "./proposalsClient";

/** What a build of the proposal came to, with the proposal as content answers it. */
export type ProposalBuildOutcome = Outcome<ProposalJson>;
export {
  buildProposal,
  buildProposalOnServer,
  withoutLockfiles,
  SERVE_POLL_MS,
  SERVE_WAIT_MS,
  type ProposalBuildStep,
  type ServerBuildStep,
} from "@valbuild/shared/publish";
import type {
  ProposalBuildStep as InPageStep,
  ServerBuildStep as OnServerStep,
} from "@valbuild/shared/publish";

/** A step of a proposal's build, made in this page or by Val Build. */
export type StudioBuildStep = InPageStep | OnServerStep;

/**
 * A proposal's CODE: the project's files, changed in a proposal and built for
 * its address. valbuild/home `docs/hosted-publishing.md`, step 7.
 *
 * The Studio's assistant changes them -- that is the one thing that puts files
 * in a proposal (decided 2026-10-14) -- through the tools here, and the
 * proposal's address shows the change once it is built: the Build button, or
 * the assistant's `build_proposal`, which are one function (`buildProposal`).
 *
 * Off a proposal nothing is written. The site's files change when a proposal
 * is merged, never directly, which is what keeps "build only when files are
 * staged" true for the site.
 */

const LIST_FILES_TOOL: AITool = {
  name: "list_files",
  description:
    "List the files of the project's code (not its content: use get_all_schema and get_source for Val modules). " +
    "In a proposal, this is the site's code with the proposal's changes. Paths are relative to the project root, e.g. 'src/components/Hero.tsx'.",
  parameters: {
    type: "object",
    properties: {
      prefix: {
        type: "string",
        description: "Only paths starting with this, e.g. 'src/components/'.",
      },
    },
    required: [],
  },
};

const READ_FILE_TOOL: AITool = {
  name: "read_file",
  description:
    "Read one file of the project's code, as list_files names it. In a proposal, the proposal's version of it. " +
    "With offset and limit, only those lines: the text comes back exactly as it is in the file, without line numbers, so a piece of it can be passed to edit_file as old_string. " +
    "search_code gives the line numbers to start from.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "e.g. 'src/components/Hero.tsx'." },
      offset: {
        type: "number",
        description:
          "The first line to read, counting from 1. Without it, from the start.",
      },
      limit: {
        type: "number",
        description:
          "How many lines to read. Without it, to the end of the file.",
      },
    },
    required: ["path"],
  },
};

const EDIT_FILE_TOOL: AITool = {
  name: "edit_file",
  description:
    "Change part of one file of the project's code: replace old_string with new_string, exactly. " +
    "old_string must be the file's text exactly as read_file gives it, indentation and line breaks included, and must match once: " +
    "add the lines around it until it does, or set replace_all to change every match. " +
    "Use this for every change to a file that exists; use write_files for a new file, a deletion, or rewriting most of a file. " +
    "Only in a proposal, and staged there as write_files stages.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "e.g. 'src/components/Hero.tsx'." },
      old_string: {
        type: "string",
        description: "The text to replace, exactly as it is in the file.",
      },
      new_string: {
        type: "string",
        description: "What replaces it. Empty to delete old_string.",
      },
      replace_all: {
        type: "boolean",
        description:
          "Replace every match of old_string, not just one. Default false.",
      },
      message: {
        type: "string",
        description:
          "What the change does, in a sentence, for the proposal's history.",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
};

const WRITE_FILES_TOOL: AITool = {
  name: "write_files",
  description:
    "Change the project's code: write whole files (the full new text of each), or delete one with null. " +
    "For a change to part of a file that exists, use edit_file: it sends only what changes. " +
    "Only in a proposal -- the site's code is changed by merging a proposal, never directly. " +
    "Content is not code: change Val content with create_patch, not by rewriting a .val.ts. " +
    "A .val.ts IS written here when its schema changes. " +
    "The change is staged in the proposal; build_proposal makes its preview show it.",
  parameters: {
    type: "object",
    properties: {
      files: {
        type: "object",
        description:
          "Path -> the file's whole new text, or null to delete it. At most 50 files.",
        additionalProperties: { type: ["string", "null"] },
      },
      message: {
        type: "string",
        description:
          "What the change does, in a sentence, for the proposal's history.",
      },
    },
    required: ["files"],
  },
};

/** How long `build_proposal` and `wait` wait at most: well inside their timeout. */
const MAX_WAIT_SECONDS = 240;
const DEFAULT_BUILD_WAIT_SECONDS = 90;

const BUILD_PROPOSAL_TOOL: AITool = {
  name: "build_proposal",
  description:
    "Build the proposal's code, so its preview shows the files staged with write_files. " +
    "Nothing is published: the site is unchanged until the proposal is merged. " +
    "Build once the change is complete, never after each edit. " +
    "Answers when the build ends, or after wait_seconds with status 'building' if it is still going: " +
    "then call wait to wait for it, build_status to see where it is, or cancel_build to stop it. " +
    "A build already running is joined, not started again.",
  parameters: {
    type: "object",
    properties: {
      wait_seconds: {
        type: "number",
        description: `How long to wait for the build before answering (default ${DEFAULT_BUILD_WAIT_SECONDS}, at most ${MAX_WAIT_SECONDS}). The build goes on either way.`,
      },
    },
    required: [],
  },
  timeoutMs: 5 * 60_000,
};

const BUILD_STATUS_TOOL: AITool = {
  name: "build_status",
  description:
    "Where the proposal's build is: running (its step, how long it has run, and each step so far with its time), " +
    "or how the last one ended (built, failed with its error, or cancelled) with what each step took, " +
    "and whether the staged files still need a build. Answers at once.",
  parameters: { type: "object", properties: {}, required: [] },
};

const CANCEL_BUILD_TOOL: AITool = {
  name: "cancel_build",
  description:
    "Stop the proposal's running build. The preview keeps the last build that worked, and build_proposal starts a new one. " +
    "Use it when a build is stuck, or to build again after changing files while one runs.",
  parameters: { type: "object", properties: {}, required: [] },
};

const WAIT_TOOL: AITool = {
  name: "wait",
  description:
    "Wait, then answer the build's status (as build_status). Ends early when a running build ends. " +
    `Use it to wait for a build instead of asking again and again. At most ${MAX_WAIT_SECONDS} seconds at a time.`,
  parameters: {
    type: "object",
    properties: {
      seconds: {
        type: "number",
        description: `How long to wait, 1 to ${MAX_WAIT_SECONDS}.`,
      },
    },
    required: ["seconds"],
  },
  timeoutMs: 5 * 60_000,
};

const DEFAULT_SEARCH_RESULTS = 100;
const MAX_SEARCH_RESULTS = 500;

const SEARCH_CODE_TOOL: AITool = {
  name: "search_code",
  description:
    "Search the project's code for text, as grep would: every line that matches, with its file and line number. " +
    "In a proposal, the site's code with the proposal's changes. Use it to find where something is rendered or defined " +
    "before reading whole files.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to find: plain text, or a regular expression with regex: true.",
      },
      regex: {
        type: "boolean",
        description: "Read query as a JavaScript regular expression.",
      },
      ignore_case: { type: "boolean", description: "Match any case." },
      prefix: {
        type: "string",
        description: "Only files whose path starts with this, e.g. 'src/'.",
      },
      max_results: {
        type: "number",
        description: `At most this many matching lines (default ${DEFAULT_SEARCH_RESULTS}, at most ${MAX_SEARCH_RESULTS}).`,
      },
    },
    required: ["query"],
  },
};

const TYPECHECK_TOOL: AITool = {
  name: "typecheck",
  description:
    "Typecheck the proposal's code: the staged files with the site's, checked with TypeScript. " +
    "Answers the type errors the proposal ADDS -- errors the site already has are not counted. " +
    "The proposal is typechecked by itself in the background after each change, so call this once ALL your edits for a change are done, not after each one: " +
    "it answers at once when the background check of what is staged has finished, and waits for one otherwise. Takes seconds to a minute.",
  parameters: { type: "object", properties: {}, required: [] },
  timeoutMs: 5 * 60_000,
};

const TYPECHECK_STATUS_TOOL: AITool = {
  name: "typecheck_status",
  description:
    "Where the background typecheck of the proposal is, without starting one: scheduled (the files just changed), running, " +
    "done (with the type errors it found, and whether it is of what is staged now) or failed. Answers at once.",
  parameters: { type: "object", properties: {}, required: [] },
};

const FORMAT_FILES_TOOL: AITool = {
  name: "format_files",
  description:
    "Format the proposal's files the way the project formats them -- Prettier, with the project's config -- " +
    "and stage the ones that change. With no paths, every file the proposal stages. Call it after write_files, before typecheck. " +
    "A config it cannot read (JavaScript or YAML, plugins) is reported, not guessed at.",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description:
          "Only these files, e.g. ['src/components/Hero.tsx']. At most 50.",
      },
      write: {
        type: "boolean",
        description:
          "Stage the formatted files (default true). false only reports which would change.",
      },
    },
    required: [],
  },
};

const LINT_TOOL: AITool = {
  name: "lint",
  description:
    "Check the proposal's files with Val's lint rules -- the ones a developer's editor runs: a c.define path that is not the file's own, " +
    "a module missing from val.modules.ts, c.define content that is a variable (it validates, then fails at publish), " +
    "an import a .val file may not make. When one fires, something is wrong: fix it. " +
    "With no paths, every staged code file (and every .val file, when val.modules.ts is staged). Call it after format_files, with typecheck.",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Only these files, e.g. ['src/content/home.val.ts'].",
      },
      fix: {
        type: "boolean",
        description:
          "Stage the fixes the rules can make themselves (default false): a c.define path, for one.",
      },
    },
    required: [],
  },
};

export const CODE_TOOLS: AITool[] = [
  LIST_FILES_TOOL,
  READ_FILE_TOOL,
  SEARCH_CODE_TOOL,
  EDIT_FILE_TOOL,
  WRITE_FILES_TOOL,
  FORMAT_FILES_TOOL,
  LINT_TOOL,
  TYPECHECK_TOOL,
  TYPECHECK_STATUS_TOOL,
  BUILD_PROPOSAL_TOOL,
  BUILD_STATUS_TOOL,
  CANCEL_BUILD_TOOL,
  WAIT_TOOL,
];

/**
 * The assistant asking for code mode: a card in the chat with a button that
 * turns it on (`CodeModeRequestCard`), or on the site opens the `</>` menu to
 * choose a proposal. The turn waits on it, as on a question.
 */
export const REQUEST_CODE_MODE_TOOL: AITool = {
  name: "request_code_mode",
  description:
    "Ask the person to turn on code mode, which lets you change the proposal's code (edit_file, write_files, format_files, lint with fix). " +
    "Call it when a request needs a code change -- a new component, a layout, a field the schema does not have -- and a code tool refused because code mode is off, " +
    "or before you start such a change. The person sees a card with a button; the call answers once they turn it on or say not now. " +
    "On the site the button lets them choose a proposal to open in code mode: the change is made there, not here. Content changes never need it.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "What you want to change in the code, in one or two plain sentences for the person: e.g. 'To add a testimonials section, the page needs a new component.'",
      },
    },
    required: ["reason"],
  },
  // Waits on the person, as ask_user_question does.
  timeoutMs: null,
};

/** One step of a quick preview, and how long it took. */
export type QuickPreviewTiming = { step: string; ms: number };

/** What a quick preview came to: see `useQuickPreview`. */
export type QuickPreviewResult =
  | { status: "shown"; ms: number; timings: QuickPreviewTiming[] }
  /**
   * Started by itself after a change, with nothing to do: Val Build does
   * not make quick previews here (`off`), or what is staged is shown already
   * (`shown`). See `useQuickPreview`.
   */
  | {
      status: "skipped";
      reason: "off" | "shown";
      timings: QuickPreviewTiming[];
    }
  | { status: "failed"; message: string; timings: QuickPreviewTiming[] };

/**
 * `quick_preview`: the proposal's client code built (by Val Build, or in the
 * tab) and shown in the Studio's preview in seconds, with the server's half
 * still the last build's (`quickPreview.ts` in `@valbuild/shared`). Run
 * through `quickPreviewControl`, where the shell registers it.
 */
export const QUICK_PREVIEW_TOOL: AITool = {
  name: "quick_preview",
  description:
    "Show the proposal's change in the preview in seconds, without a build: its code for the browser is bundled and the page in the preview runs it. " +
    "Where Val Build makes quick previews, one runs by itself after each change, so call this only to see the change now, or when none ran. " +
    "For components, layout and styles. What runs on the server -- loaders, server functions, API routes, the page's first render and head, " +
    "and any new dependency -- stays the last build's, so a change to those needs build_proposal. Nothing is published. " +
    "Answers once the page shows it, with what each step took.",
  parameters: { type: "object", properties: {}, required: [] },
  timeoutMs: 3 * 60_000,
};

export async function runQuickPreviewTool(
  quickPreview: (() => Promise<QuickPreviewResult>) | null,
): Promise<CodeToolAnswer> {
  if (quickPreview === null) {
    return {
      result: {
        success: false,
        error:
          "There is no preview of a proposal open to show it in. Call build_proposal to see the change.",
      },
      isError: true,
    };
  }
  const result = await quickPreview();
  const steps = result.timings.map((t) => ({
    step: t.step,
    seconds: Math.round(t.ms / 100) / 10,
  }));
  if (result.status === "failed") {
    return {
      result: { success: false, error: result.message, steps },
      isError: true,
    };
  }
  if (result.status === "skipped" && result.reason === "off") {
    return {
      result: {
        success: false,
        error:
          "Val Build does not make quick previews for this project, and none was made here. Call build_proposal to see the change.",
      },
      isError: true,
    };
  }
  if (result.status === "skipped") {
    return {
      result: {
        success: true,
        note: "The preview already shows what is staged.",
        next: "No build is needed to see it; build only for what a quick preview cannot show, once, when the request is finished.",
      },
      isError: false,
    };
  }
  return {
    result: {
      success: true,
      seconds: Math.round(result.ms / 100) / 10,
      steps,
      next: "The preview shows it. No build is needed to see it; build only for what a quick preview cannot show, once, when the request is finished.",
    },
    isError: false,
  };
}

/** Where the assistant's code tools act: see {@link codeToolsPromptSection}. */
export type CodeToolsWhere = { kind: "site" } | { kind: "proposal" };

/**
 * What the assistant is told about the code tools: that code changes in a
 * proposal and is built there, and -- on the site -- that it does not change
 * here at all.
 */
export function codeToolsPromptSection(where: CodeToolsWhere): string {
  const here =
    where.kind === "proposal"
      ? "This Studio is in a proposal: changes go into it."
      : "This Studio is on the site, where code is never changed directly. If the person asks for a code change, call edit_file or write_files anyway: it is refused and the person is offered a proposal to make the change in. Then ask them to open it and make the change there.";
  return `

## The project's code
Besides content, you can read the project's code (list_files, read_file, search_code) and, in a proposal, change it (edit_file, write_files), format it (format_files), check it (lint, typecheck) and build it (build_proposal). Change code only when the person asks for something content cannot do: a new component, a layout, a field the schema does not have yet.
- Content is not code: change content with create_patch. Write a .val.ts only to change its schema, and keep the content in it.
- Find before you read: search_code finds where something is defined or rendered, with its line, then read_file the lines around it (offset, limit) rather than the whole file when the file is long.
- Change a file that exists with edit_file: old_string is copied exactly from what read_file gave you, with enough lines around it to match once, and only what changes is sent. Make several edit_file calls for several places. Use write_files for a new file, to delete one (null), or when most of a file changes; it takes each file's WHOLE new text. Read a file before you change it.
- After changing code, call format_files so the files are formatted as the project's are, then lint. Once ALL your edits for a change are done, call typecheck and fix what it reports -- it runs by itself in the background after each change, so do not call it after every edit; typecheck_status says where it is. Tell the person it is in the preview, not on the site: the site changes when the proposal is published.
- The preview: a second after files are staged, the preview shows them as a quick preview by itself -- components, layout, styles and text, in seconds, without a build. Call quick_preview only to see a change now, or when none ran. A quick preview cannot show what runs on the server (loaders, server functions, API routes, a route's first render and head), routes added, removed or renamed, a .val.ts schema, or a new dependency: those need build_proposal. Build once the change is complete, never after each edit; Publish takes the build.
- A tool's answer can carry \`typecheck_errors\`: the background typecheck found type errors in what is staged. Fix them before you build.
- A build that is still going when build_proposal answers goes on: wait for it with wait, never by calling build_proposal again and again. If it makes no progress, build_status says at which step, and cancel_build stops it so you can build again.
- Code mode: in a proposal, the tools that change code (edit_file, write_files, format_files, lint with fix) work only while code mode is on. It is the proposal's, for everyone in it, and turning it on saves every pending content change first; each code write saves the content changes made since, so the .val.ts you read is the current content. When a code tool refuses because code mode is off, or before you start a change that needs code, call request_code_mode with the reason, and wait for the person. Never ask them to find a switch.
- ${here}`;
}

/**
 * The element picked in the preview, as the assistant is told it: one line
 * after the person's message, which the prompt explains (`PAGE_PROMPT_SECTION`
 * in `hooks/pageTools.ts`). Attribute values are escaped, so text on the
 * customer's page cannot close the tag and pass for the person's words.
 */
export function pickedElementPrompt(picked: PickedElement): string {
  const attribute = (name: string, value: string) =>
    ` ${name}="${escapePickedText(value)}"`;
  return `<picked${attribute("tag", picked.tag)}${
    picked.classes.length > 0
      ? attribute("classes", picked.classes.join(" "))
      : ""
  }${attribute("selector", picked.selector)}${
    picked.valPath !== undefined ? attribute("path", picked.valPath) : ""
  }${attribute("text", picked.text)}/>`;
}

function escapePickedText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CODE_TOOL_NAMES = new Set(CODE_TOOLS.map((tool) => tool.name));
export function isCodeTool(name: string): boolean {
  return CODE_TOOL_NAMES.has(name);
}

export type CodeToolDeps = {
  /** The proposal this Studio is open in; `null` on the site. */
  proposal: { name: string } | null;
  client: Pick<ProposalsClient, "files" | "stageFiles">;
  /** The site's source, as its live build was made from it. */
  siteSource: () => Promise<Record<string, string> | null>;
  /** The proposal's build: start or join it, see where it is, stop it. */
  build: ProposalBuildControl;
  /** For tests: waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Typecheck the proposal, and report it: see `typecheckProposal`. */
  typecheck: () => Promise<CodeTypecheck>;
  /** Where the background typecheck is, without starting one: see `typecheckStatusOf`. */
  typecheckStatus?: () => Promise<CodeTypecheckStatus>;
  /** Format one file as the project does; `formatWithProjectPrettier` unless a test says otherwise. */
  formatCode?: (
    text: string,
    path: string,
    project: Record<string, string>,
  ) => Promise<FormatOutcome>;
  /** Lint files of the project with Val's rules; `lintWithValRules` unless a test says otherwise. */
  lintCode?: typeof lintWithValRules;
  /** Offer the person a proposal to make the change in. */
  offerProposal: () => void;
  /**
   * Whether the proposal is in code mode now (`readCodeMode`): the tools
   * that change its code refuse when it is not, naming who turned it off.
   * Absent where code mode does not apply: on the site, where nothing is
   * changed.
   */
  codeMode?: () => Promise<CodeModeNow>;
  /**
   * Evaluate the staged code in this tab and swap its schema in
   * (`runStagedCode`): started after each `write_files`, and its outcome
   * goes with the answer when it is done in time. Absent: nothing is
   * evaluated, and the schema arrives with a build.
   */
  evaluateStaged?: () => Promise<StagedCodeOutcome>;
};

/**
 * How long `write_files` waits for the staged code's evaluation before it
 * answers without it: seconds is normal, and the outcome otherwise reaches
 * the assistant with its next tool answer (`untoldStagedCode`).
 */
const STAGED_CODE_WAIT_SECONDS = 20;

/**
 * The tools that change the proposal's code: refused while code mode is off.
 * Reading it, typechecking it and building what is staged change nothing.
 */
function changesCode(name: string, input: Record<string, unknown>): boolean {
  if (name === "write_files" || name === "edit_file") return true;
  if (name === "format_files") return input["write"] !== false;
  if (name === "lint") return input["fix"] === true;
  return false;
}

/**
 * The proposal's build, as the assistant's tools reach it: `useProposalBuild`'s
 * store, which the Build button and its Cancel share.
 */
export type ProposalBuildControl = {
  /** Start a build, or join the one running. */
  start: () => Promise<ProposalBuildOutcome>;
  /** The running build, to wait for; `null` when none runs. */
  running: () => Promise<ProposalBuildOutcome> | null;
  /** Where it is now: see {@link BuildReport}. */
  report: () => BuildReport;
  /** Stop the running build; whether there was one. */
  cancel: () => boolean;
};

/** A build's steps, as the model reads them: seconds, to one decimal. */
export type BuildStepTimes = Array<{ step: string; seconds: number }>;

/** Where the proposal's build is, for `build_status` and `wait`. */
export type BuildReport =
  | {
      status: "building";
      step: string | null;
      elapsed_seconds: number;
      steps: BuildStepTimes;
    }
  | {
      status: "idle";
      last: {
        status:
          | "built"
          | "already-built"
          | "nothing-staged"
          | "failed"
          | "cancelled";
        error?: string;
        seconds: number;
        steps: BuildStepTimes;
        ended_seconds_ago: number;
      } | null;
    };

/** What the proposal's typecheck came to, for the `typecheck` tool. */
/** `typecheck_status`: the background typecheck, and whether it is of what is staged now. */
export type CodeTypecheckStatus =
  | { status: "none" | "scheduled" }
  | { status: "running"; step: string | null }
  | { status: "done"; errors: ProposalTypeError[]; current: boolean }
  | { status: "failed"; message: string };

export type CodeTypecheck =
  | { status: "done"; errors: ProposalTypeError[] }
  | { status: "nothing-staged" }
  | { status: "failed"; message: string };

/** Lint problems handed to the model at once. */
const MAX_LINT_PROBLEMS = 50;

/** Type errors handed to the model at once: the first of them are the ones to fix. */
const MAX_TYPE_ERRORS = 50;

/** A tool's answer to the model: what it did, or why not. */
export type CodeToolAnswer = { result: unknown; isError: boolean };

const MAX_LISTED = 2000;
const MAX_READ_CHARS = 200_000;
/** Longer than this is minified or generated: not searched. */
const MAX_SEARCHED_CHARS = 1_000_000;
const MAX_MATCH_LINE_CHARS = 300;

export async function runCodeTool(
  name: string,
  args: unknown,
  deps: CodeToolDeps,
): Promise<CodeToolAnswer> {
  const fail = (error: string): CodeToolAnswer => ({
    result: { success: false, error },
    isError: true,
  });
  const input = isRecord(args) ? args : {};
  try {
    if (
      deps.proposal !== null &&
      deps.codeMode !== undefined &&
      changesCode(name, input)
    ) {
      const mode = await deps.codeMode();
      if (!mode.on) return fail(codeModeOffMessage(mode));
    }
    const within = <T>(work: Promise<T>, seconds: number) =>
      withinSeconds(deps.sleep, work, seconds);
    if (
      deps.proposal === null &&
      (name === "write_files" || name === "edit_file")
    ) {
      deps.offerProposal();
      return fail(
        "The site's code is changed in a proposal, never directly, and this Studio is on the site. " +
          "The person has been offered to open a proposal: ask them to, and make the change there.",
      );
    }
    if (name === "edit_file" && deps.proposal !== null) {
      const path = input["path"];
      const oldString = input["old_string"];
      const newString = input["new_string"];
      const replaceAll = input["replace_all"];
      if (typeof path !== "string" || path === "") {
        return fail("path must be the file's path, as list_files names it.");
      }
      if (typeof oldString !== "string" || typeof newString !== "string") {
        return fail("old_string and new_string must both be text.");
      }
      if (replaceAll !== undefined && typeof replaceAll !== "boolean") {
        return fail("replace_all must be true or false.");
      }
      const { project } = await readProject(deps);
      const filePath = path.replace(/^\/+/, "");
      const text = project[filePath];
      if (text === undefined) {
        return fail(
          `There is no file ${path}. edit_file changes a file that exists: create a new one with write_files, or find the right path with list_files.`,
        );
      }
      const edit = editText(text, oldString, newString, replaceAll === true);
      if (edit.status !== "edited") return fail(edit.message);
      const message =
        typeof input["message"] === "string" ? input["message"] : undefined;
      const answer = await stageCode(
        deps,
        deps.proposal.name,
        { [filePath]: edit.text },
        message,
      );
      return isRecord(answer.result)
        ? {
            ...answer,
            result: {
              ...answer.result,
              replaced: edit.replaced,
              line: edit.line,
            },
          }
        : answer;
    }
    if (name === "write_files" && deps.proposal !== null) {
      const files = input["files"];
      if (!isRecord(files) || Object.keys(files).length === 0) {
        return fail(
          "files must be an object of path -> text (or null to delete).",
        );
      }
      const written: Record<string, string | null> = {};
      for (const [path, text] of Object.entries(files)) {
        if (text !== null && typeof text !== "string") {
          return fail(
            `files[${JSON.stringify(path)}] must be the file's text, or null.`,
          );
        }
        written[path] = text;
      }
      const message =
        typeof input["message"] === "string" ? input["message"] : undefined;
      // Awaited here, so a refused staging is answered by the catch below
      return await stageCode(deps, deps.proposal.name, written, message);
    }
    if (name === "typecheck_status") {
      if (deps.proposal === null || deps.typecheckStatus === undefined) {
        return fail(
          "Only a proposal's code is typechecked here: on the site, nothing is staged.",
        );
      }
      const status = await deps.typecheckStatus();
      if (status.status !== "done") return { result: status, isError: false };
      return {
        result: {
          status: "done",
          current: status.current,
          newErrors: status.errors.length,
          errors: status.errors.slice(0, MAX_TYPE_ERRORS),
          ...(status.current
            ? {}
            : {
                note: "This check is of files staged before the last change: call typecheck once your edits are done.",
              }),
        },
        isError: false,
      };
    }
    if (name === "typecheck") {
      if (deps.proposal === null) {
        return fail(
          "Only a proposal's code is typechecked here: on the site, nothing is staged.",
        );
      }
      const outcome = await deps.typecheck();
      if (outcome.status === "failed") return fail(outcome.message);
      if (outcome.status === "nothing-staged") {
        return {
          result: {
            success: true,
            newErrors: 0,
            note: "Nothing is staged: the proposal runs the site's code, so it adds no type errors.",
          },
          isError: false,
        };
      }
      return {
        result: {
          success: true,
          newErrors: outcome.errors.length,
          errors: outcome.errors.slice(0, MAX_TYPE_ERRORS),
          ...(outcome.errors.length > MAX_TYPE_ERRORS
            ? { truncated: `${outcome.errors.length - MAX_TYPE_ERRORS} more` }
            : {}),
          next:
            outcome.errors.length === 0
              ? "No new type errors. Call build_proposal when the change is complete."
              : "Fix these in the files, then typecheck again.",
        },
        isError: false,
      };
    }
    if (name === "build_proposal") {
      if (deps.proposal === null) {
        deps.offerProposal();
        return fail(
          "Only a proposal is built here, and this Studio is on the site. The person has been offered to open one.",
        );
      }
      const seconds = waitSeconds(
        input["wait_seconds"],
        DEFAULT_BUILD_WAIT_SECONDS,
      );
      const outcome = await within(deps.build.start(), seconds);
      if (outcome === null) {
        return {
          result: {
            success: true,
            ...deps.build.report(),
            next: "Still building. Call wait to wait for it, build_status to see where it is, or cancel_build if it is stuck.",
          },
          isError: false,
        };
      }
      return buildAnswer(outcome, deps.build.report());
    }
    if (name === "build_status") {
      return { result: deps.build.report(), isError: false };
    }
    if (name === "cancel_build") {
      const cancelled = deps.build.cancel();
      return {
        result: cancelled
          ? {
              cancelled: true,
              next: "The build was stopped. Call build_proposal to build again.",
            }
          : { cancelled: false, reason: "No build was running." },
        isError: false,
      };
    }
    if (name === "wait") {
      const seconds = waitSeconds(input["seconds"], null);
      if (seconds === null) {
        return fail(`seconds must be a number from 1 to ${MAX_WAIT_SECONDS}.`);
      }
      const started = Date.now();
      const running = deps.build.running();
      // Nothing to end it early: the whole wait.
      await within(running ?? new Promise<never>(() => {}), seconds);
      return {
        result: {
          waited_seconds: Math.round((Date.now() - started) / 100) / 10,
          build: deps.build.report(),
        },
        isError: false,
      };
    }
    const { project, staged } = await readProject(deps);
    if (name === "list_files") {
      const prefix = typeof input["prefix"] === "string" ? input["prefix"] : "";
      const paths = Object.keys(project)
        .filter((path) => path.startsWith(prefix))
        .sort();
      return {
        result: {
          files: paths.slice(0, MAX_LISTED),
          ...(paths.length > MAX_LISTED
            ? {
                truncated: `${paths.length - MAX_LISTED} more: narrow with prefix`,
              }
            : {}),
          ...(staged !== null ? { staged: staged.files } : {}),
        },
        isError: false,
      };
    }
    if (name === "format_files") {
      if (deps.proposal === null) {
        return fail(
          "Only a proposal's files are formatted here: the site's code is changed by merging a proposal.",
        );
      }
      const asked = input["paths"];
      if (
        asked !== undefined &&
        (!Array.isArray(asked) || !asked.every((p) => typeof p === "string"))
      ) {
        return fail("paths must be a list of file paths.");
      }
      const paths = (asked ?? staged?.files ?? []).map((path) =>
        path.replace(/^\/+/, ""),
      );
      const formatCode = deps.formatCode ?? formatWithProjectPrettier;
      const files: Array<{ path: string; status: string; message?: string }> =
        [];
      const changed: Record<string, string> = {};
      for (const path of paths) {
        const text = project[path];
        if (text === undefined) {
          files.push({ path, status: "missing" });
          continue;
        }
        const outcome = await formatCode(text, path, project);
        if (outcome.status !== "formatted") {
          files.push({
            path,
            status: outcome.status,
            message: outcome.message,
          });
        } else if (outcome.text === text) {
          files.push({ path, status: "unchanged" });
        } else {
          changed[path] = outcome.text;
          files.push({ path, status: "changed" });
        }
      }
      const write = input["write"] !== false;
      if (write && Object.keys(changed).length > 0) {
        await deps.client.stageFiles(deps.proposal.name, changed, "Format");
      }
      const failed = files.some((f) => f.status === "failed");
      return {
        result: {
          success: true,
          files,
          next: failed
            ? "Some files could not be formatted: that is usually a syntax error. Fix them, then format again."
            : Object.keys(changed).length === 0
              ? "Everything is formatted already."
              : write
                ? "The changed files are staged, formatted."
                : "Call format_files again with write: true to stage these formatted.",
        },
        isError: false,
      };
    }
    if (name === "lint") {
      if (deps.proposal === null) {
        return fail(
          "Only a proposal's files are linted here: the site's code is changed by merging a proposal.",
        );
      }
      const asked = input["paths"];
      if (
        asked !== undefined &&
        (!Array.isArray(asked) || !asked.every((p) => typeof p === "string"))
      ) {
        return fail("paths must be a list of file paths.");
      }
      const paths =
        asked !== undefined
          ? asked.map((path) => path.replace(/^\/+/, ""))
          : pathsToLint(project, staged?.files ?? []);
      const fix = input["fix"] === true;
      const lintCode = deps.lintCode ?? lintWithValRules;
      const { messages, fixed } = await lintCode(project, paths, { fix });
      if (Object.keys(fixed).length > 0) {
        await deps.client.stageFiles(deps.proposal.name, fixed, "Lint fixes");
      }
      return {
        result: {
          success: true,
          linted: paths.length,
          problems: messages.slice(0, MAX_LINT_PROBLEMS),
          ...(messages.length > MAX_LINT_PROBLEMS
            ? { truncated: `${messages.length - MAX_LINT_PROBLEMS} more` }
            : {}),
          ...(Object.keys(fixed).length > 0
            ? { fixedAndStaged: Object.keys(fixed) }
            : {}),
          next:
            messages.length === 0
              ? "No problems."
              : messages.some((m) => m.fixable) && !fix
                ? "Fix these: the fixable ones with lint and fix: true, the rest in the files. Then lint again."
                : "Fix these in the files, then lint again.",
        },
        isError: false,
      };
    }
    if (name === "search_code") {
      const query = input["query"];
      if (typeof query !== "string" || query === "") {
        return fail("query must be the text to find.");
      }
      const found = searchProject(project, {
        query,
        regex: input["regex"] === true,
        ignoreCase: input["ignore_case"] === true,
        prefix: typeof input["prefix"] === "string" ? input["prefix"] : "",
        limit:
          typeof input["max_results"] === "number"
            ? input["max_results"]
            : DEFAULT_SEARCH_RESULTS,
      });
      if (found.status === "invalid") return fail(found.message);
      return {
        result: {
          matches: found.matches,
          total: found.total,
          ...(found.total > found.matches.length
            ? {
                truncated: `${found.total - found.matches.length} more: narrow with prefix or a longer query`,
              }
            : {}),
        },
        isError: false,
      };
    }
    if (name === "read_file") {
      const path = input["path"];
      if (typeof path !== "string") return fail("path must be a string.");
      const text = project[path.replace(/^\/+/, "")];
      if (text === undefined) {
        return fail(
          `There is no file ${path}. list_files names the files there are.`,
        );
      }
      const offset = input["offset"];
      const limit = input["limit"];
      const isStaged =
        staged !== null ? { staged: staged.files.includes(path) } : {};
      if (offset === undefined && limit === undefined) {
        if (text.length <= MAX_READ_CHARS) {
          return { result: { path, text, ...isStaged }, isError: false };
        }
        const part = readLines(text, 1, null);
        if (part.status === "read") {
          return {
            result: {
              path,
              text: part.text,
              ...(part.truncated !== undefined
                ? { truncated: part.truncated }
                : {}),
              ...isStaged,
            },
            isError: false,
          };
        }
      }
      if (
        (offset !== undefined && !isPositiveInteger(offset)) ||
        (limit !== undefined && !isPositiveInteger(limit))
      ) {
        return fail(
          "offset and limit must be whole numbers from 1: offset is the first line to read, limit how many lines.",
        );
      }
      const part = readLines(
        text,
        typeof offset === "number" ? offset : 1,
        typeof limit === "number" ? limit : null,
      );
      if (part.status === "past-the-end") {
        return fail(
          `${path} has ${part.totalLines} lines, so there is no line ${String(offset)}.`,
        );
      }
      return {
        result: {
          path,
          text: part.text,
          startLine: part.startLine,
          endLine: part.endLine,
          totalLines: part.totalLines,
          ...(part.truncated !== undefined
            ? { truncated: part.truncated }
            : {}),
          ...isStaged,
        },
        isError: false,
      };
    }
    return fail(`Unknown code tool ${name}.`);
  } catch (error) {
    return fail(messageOf(error));
  }
}

/** `work`, or `null` once `seconds` have passed without it. */
async function withinSeconds<T>(
  sleep: CodeToolDeps["sleep"],
  work: Promise<T>,
  seconds: number,
): Promise<T | null> {
  let clear = () => {};
  const timeout =
    sleep !== undefined
      ? sleep(seconds * 1000).then(() => null)
      : new Promise<null>((resolve) => {
          // Cleared when the work wins: a wait left behind would hold
          // the page for minutes after it is answered.
          const timer = setTimeout(() => resolve(null), seconds * 1000);
          clear = () => clearTimeout(timer);
        });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clear();
  }
}

/**
 * Stage files the assistant wrote in the proposal, and answer with what
 * that did: the one way code is written, whether it came whole
 * (`write_files`) or as a replacement in a file (`edit_file`).
 */
async function stageCode(
  deps: CodeToolDeps,
  proposalName: string,
  written: Record<string, string | null>,
  message: string | undefined,
): Promise<CodeToolAnswer> {
  const staged = await deps.client.stageFiles(proposalName, written, message);
  // The tab evaluates `val.modules` as the staging left it, and swaps the
  // schema in: what moved, or why it does not run, goes with this answer
  // when it is done in time, else with the next one.
  const evaluation = deps.evaluateStaged?.();
  const evaluated =
    evaluation === undefined
      ? undefined
      : await withinSeconds(deps.sleep, evaluation, STAGED_CODE_WAIT_SECONDS);
  if (evaluated !== undefined && evaluated !== null) {
    markStagedCodeTold(evaluated);
  }
  return {
    result: {
      success: true,
      staged: staged.staged.files,
      buildRequired: staged.staged.buildRequired,
      next: !staged.staged.buildRequired
        ? "The preview already shows these files."
        : "The preview shows them as a quick preview by itself in a moment. Call build_proposal once the change is complete.",
      ...(evaluated === undefined
        ? {}
        : {
            valModules:
              evaluated === null
                ? {
                    status: "evaluating",
                    note: "The Studio is still reading val.modules; what it finds comes with your next tool answer.",
                  }
                : stagedCodeNotice(evaluated),
          }),
    },
    isError: false,
  };
}

/** What the code tools read the project through. */
export type ProjectReadDeps = Pick<CodeToolDeps, "proposal" | "siteSource"> & {
  client: Pick<ProposalsClient, "files">;
};

/**
 * The project the code tools read: the proposal's (the site's files with
 * the proposal's laid over), or the site's on the site. Paths are relative
 * to the project root.
 */
export async function readProject(deps: ProjectReadDeps): Promise<{
  project: Record<string, string>;
  staged: ProposalStaged | null;
}> {
  const site = (await deps.siteSource()) ?? {};
  let own: Record<string, string | null> = {};
  let staged: ProposalStaged | null = null;
  if (deps.proposal !== null) {
    const read = await deps.client.files(deps.proposal.name);
    own = read.files;
    staged = read.staged;
  }
  return { project: proposalProject(site, own), staged };
}

/** What `edit_file` made of a file, or why it did not. */
export type TextEdit =
  | { status: "edited"; text: string; replaced: number; line: number }
  | { status: "refused"; message: string };

/**
 * `edit_file`'s replacement: `oldString` must be in `text` exactly, once
 * unless `replaceAll`. A refusal says what to do instead, since the model
 * reads it and tries again.
 *
 * A file with Windows line breaks is matched with them: the model writes
 * `\n`, and would otherwise never match such a file at all.
 */
export function editText(
  text: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): TextEdit {
  if (oldString === "") {
    return {
      status: "refused",
      message:
        "old_string is empty: give the text to replace. To write a new file, or a whole file, use write_files.",
    };
  }
  if (oldString === newString) {
    return {
      status: "refused",
      message: "old_string and new_string are the same: nothing would change.",
    };
  }
  let from = oldString;
  let to = newString;
  let at = matchesOf(text, from);
  if (
    at.length === 0 &&
    text.includes("\r\n") &&
    !oldString.includes("\r\n") &&
    oldString.includes("\n")
  ) {
    from = oldString.replace(/\n/g, "\r\n");
    to = newString.replace(/\r?\n/g, "\r\n");
    at = matchesOf(text, from);
  }
  if (at.length === 0) {
    const firstLine = oldString
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "");
    const near =
      firstLine === undefined
        ? []
        : text
            .split("\n")
            .flatMap((line, index) =>
              line.includes(firstLine) ? [index + 1] : [],
            )
            .slice(0, 5);
    return {
      status: "refused",
      message:
        "old_string is not in the file. It has to match exactly, indentation, quotes and line breaks included: read_file the lines you are changing and copy old_string from that text." +
        (near.length > 0
          ? ` Its first line is on ${near.length === 1 ? "line" : "lines"} ${near.join(", ")}, so what follows it differs: read from there.`
          : ""),
    };
  }
  if (at.length > 1 && !replaceAll) {
    const lines = at.slice(0, 10).map((index) => lineOf(text, index));
    return {
      status: "refused",
      message:
        `old_string matches ${at.length} times (${lines.length < at.length ? "first on lines" : "lines"} ${lines.join(", ")}), so it is not clear which to change. ` +
        "Add lines around it to old_string until it matches once, or set replace_all: true to change every match.",
    };
  }
  const replacing = replaceAll ? at : at.slice(0, 1);
  let edited = "";
  let previous = 0;
  for (const index of replacing) {
    edited += text.slice(previous, index) + to;
    previous = index + from.length;
  }
  edited += text.slice(previous);
  return {
    status: "edited",
    text: edited,
    replaced: replacing.length,
    line: lineOf(text, replacing[0]),
  };
}

/** Where `search` starts in `text`, each time, not overlapping. */
function matchesOf(text: string, search: string): number[] {
  const at: number[] = [];
  let index = text.indexOf(search);
  while (index !== -1) {
    at.push(index);
    index = text.indexOf(search, index + search.length);
  }
  return at;
}

/** The line, from 1, that the character at `index` is on. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; ) {
    line++;
    i = text.indexOf("\n", i + 1);
  }
  return line;
}

/** Lines of a file, as `read_file` answers them. */
export type ReadLines =
  | {
      status: "read";
      /** Exactly as in the file: its line breaks, and no line numbers. */
      text: string;
      startLine: number;
      endLine: number;
      totalLines: number;
      /** Set when not all that was asked for fits in one answer. */
      truncated?: string;
    }
  | { status: "past-the-end"; totalLines: number };

/**
 * Lines `start` to `start + limit - 1` of `text` (to the end when `limit`
 * is `null`), cut at a line's end to fit `MAX_READ_CHARS`. The text is the
 * file's own, so any part of it can be given back to `edit_file`.
 */
export function readLines(
  text: string,
  start: number,
  limit: number | null,
): ReadLines {
  const lines = text.split("\n");
  const totalLines =
    text === "" ? 0 : text.endsWith("\n") ? lines.length - 1 : lines.length;
  if (start > Math.max(totalLines, 1)) {
    return { status: "past-the-end", totalLines };
  }
  // starts[i]: where line i + 1 starts.
  const starts: number[] = [];
  let position = 0;
  for (const line of lines) {
    starts.push(position);
    position += line.length + 1;
  }
  /** Where line `n` ends, its line break included. */
  const endOf = (n: number) => (n < lines.length ? starts[n] : text.length);
  const from = starts[start - 1] ?? 0;
  const wanted =
    limit === null ? totalLines : Math.min(totalLines, start + limit - 1);
  let end = Math.max(wanted, start);
  if (endOf(end) - from <= MAX_READ_CHARS || totalLines === 0) {
    return {
      status: "read",
      text: text.slice(from, endOf(end)),
      startLine: start,
      endLine: Math.min(end, totalLines),
      totalLines,
    };
  }
  while (end > start && endOf(end) - from > MAX_READ_CHARS) end--;
  if (endOf(end) - from > MAX_READ_CHARS) {
    // One line longer than an answer: minified or generated.
    return {
      status: "read",
      text: text.slice(from, from + MAX_READ_CHARS),
      startLine: start,
      endLine: start,
      totalLines,
      truncated: `Line ${start} alone is longer than ${MAX_READ_CHARS} characters, so only its start is here: the file is probably minified or generated, and not one to edit.`,
    };
  }
  return {
    status: "read",
    text: text.slice(from, endOf(end)),
    startLine: start,
    endLine: end,
    totalLines,
    truncated:
      `Lines ${start}-${end} of ${totalLines} are what fits in one answer (${MAX_READ_CHARS} characters). ` +
      `Read on with offset: ${end + 1}${end + 1 <= wanted ? `, limit: ${wanted - end}` : ""}, or search_code for the part you need.`,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * The project's own instructions for anyone changing its code, at the root:
 * read in this order, each one that exists.
 */
export const PROJECT_INSTRUCTION_FILES: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/CLAUDE.md",
];

/** At most this much of the project's instructions goes in the prompt. */
export const MAX_PROJECT_INSTRUCTIONS_CHARS = 20_000;

/**
 * The project's instructions (`PROJECT_INSTRUCTION_FILES`), read as
 * `read_file` reads them, cut to `MAX_PROJECT_INSTRUCTIONS_CHARS`. `null`
 * when there are none: most projects have none, and that is not worth a
 * word.
 */
export async function readProjectInstructions(
  deps: ProjectReadDeps,
): Promise<string | null> {
  const { project } = await readProject(deps);
  const found = PROJECT_INSTRUCTION_FILES.flatMap((path) => {
    const text = project[path];
    return text === undefined || text.trim() === ""
      ? []
      : [{ path, text: text.trim() }];
  });
  if (found.length === 0) return null;
  let budget = MAX_PROJECT_INSTRUCTIONS_CHARS;
  const parts: string[] = [];
  for (const { path, text } of found) {
    if (budget <= 0) {
      parts.push(`### ${path}\n(Not included: read_file ${path} to read it.)`);
      continue;
    }
    const fits = text.length <= budget;
    parts.push(
      `### ${path}\n${fits ? text : text.slice(0, budget)}${
        fits
          ? ""
          : `\n(Cut here: the rest is ${text.length - budget} more characters. read_file ${path} for it.)`
      }`,
    );
    budget -= text.length;
  }
  return parts.join("\n\n");
}

/**
 * The project's instructions, as the prompt carries them: under a heading
 * that says whose they are, so they are not taken for Val's.
 */
export function projectInstructionsPromptSection(
  instructions: string | null,
): string {
  if (instructions === null) return "";
  return `

## The project's own instructions
The project's repository has these instructions for anyone working on its code. They are the project's, written by its developers, not Val's: follow them when you change its code, unless they conflict with what the person asks or with the rules above.

${instructions}`;
}

/** One line that matched, where it is. */
export type CodeSearchMatch = { path: string; line: number; text: string };

/**
 * `search_code`: every line of the project that matches, as grep would.
 * A scan of the files in memory, since that is where they are already: a
 * project's own code is small. Lockfiles, and anything long enough to be
 * minified or generated, are not searched.
 */
export function searchProject(
  project: Record<string, string>,
  query: {
    query: string;
    regex: boolean;
    ignoreCase: boolean;
    prefix: string;
    limit: number;
  },
):
  | { status: "found"; matches: CodeSearchMatch[]; total: number }
  | { status: "invalid"; message: string } {
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      query.regex ? query.query : escapeRegExp(query.query),
      query.ignoreCase ? "i" : "",
    );
  } catch (error) {
    return {
      status: "invalid",
      message: `query is not a regular expression: ${messageOf(error)}`,
    };
  }
  const limit = Math.max(
    1,
    Math.min(MAX_SEARCH_RESULTS, Math.floor(query.limit)),
  );
  const matches: CodeSearchMatch[] = [];
  let total = 0;
  const paths = Object.keys(withoutLockfiles(project))
    .filter((path) => path.startsWith(query.prefix))
    .sort();
  for (const path of paths) {
    const text = project[path];
    if (text.length > MAX_SEARCHED_CHARS) continue;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!pattern.test(lines[index])) continue;
      total++;
      if (matches.length < limit) {
        const line = lines[index].trim();
        matches.push({
          path,
          line: index + 1,
          text:
            line.length > MAX_MATCH_LINE_CHARS
              ? `${line.slice(0, MAX_MATCH_LINE_CHARS)}…`
              : line,
        });
      }
    }
  }
  return { status: "found", matches, total };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutProposal(
  outcome: Exclude<ProposalBuildOutcome, { status: "failed" }>,
) {
  if (outcome.status !== "built") return outcome;
  return { status: outcome.status, hash: outcome.hash };
}

/** How a build ended, as `build_proposal` answers it: with what each step took. */
function buildAnswer(
  outcome: ProposalBuildOutcome,
  report: BuildReport,
): CodeToolAnswer {
  const last = report.status === "idle" ? report.last : null;
  const timing =
    last !== null ? { seconds: last.seconds, steps: last.steps } : {};
  if (outcome.status === "failed") {
    return {
      result: {
        success: false,
        error: outcome.message,
        ...(outcome.cancelled ? { cancelled: true } : {}),
        ...timing,
      },
      isError: true,
    };
  }
  return {
    result: { success: true, ...withoutProposal(outcome), ...timing },
    isError: false,
  };
}

/** A tool's seconds argument, within bounds; `fallback` when it gave none. */
function waitSeconds<F extends number | null>(
  value: unknown,
  fallback: F,
): number | F {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, MAX_WAIT_SECONDS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
