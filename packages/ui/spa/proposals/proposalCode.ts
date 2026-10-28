import type { AITool } from "../hooks/useAIWebSocket";
import type { ProposalBuildOutcome as Outcome } from "@valbuild/shared/publish";
import { proposalProject, withoutLockfiles } from "@valbuild/shared/publish";
import type {
  PageScreenshot,
  PageSnapshot,
  PickedElement,
} from "@valbuild/shared/internal";
export { proposalProject };
import { formatWithProjectPrettier, type FormatOutcome } from "./formatCode";
import { lintWithValRules, pathsToLint } from "./lintCode";
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
  withoutLockfiles,
  SERVE_POLL_MS,
  SERVE_WAIT_MS,
  type ProposalBuildStep,
} from "@valbuild/shared/publish";

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
    "Read one file of the project's code, as list_files names it. In a proposal, the proposal's version of it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "e.g. 'src/components/Hero.tsx'." },
    },
    required: ["path"],
  },
};

const WRITE_FILES_TOOL: AITool = {
  name: "write_files",
  description:
    "Change the project's code: write whole files (the full new text of each), or delete one with null. " +
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
    "Call it after write_files, before build_proposal; fix what it reports. Takes seconds to a minute.",
  parameters: { type: "object", properties: {}, required: [] },
  timeoutMs: 5 * 60_000,
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
  WRITE_FILES_TOOL,
  FORMAT_FILES_TOOL,
  LINT_TOOL,
  TYPECHECK_TOOL,
  BUILD_PROPOSAL_TOOL,
  BUILD_STATUS_TOOL,
  CANCEL_BUILD_TOOL,
  WAIT_TOOL,
];

/** One step of a quick preview, and how long it took. */
export type QuickPreviewTiming = { step: string; ms: number };

/** What a quick preview came to: see `useQuickPreview`. */
export type QuickPreviewResult =
  | { status: "shown"; ms: number; timings: QuickPreviewTiming[] }
  | { status: "failed"; message: string; timings: QuickPreviewTiming[] };

/**
 * `quick_preview` in the design tab: the proposal's client code built in the
 * tab and shown in the preview in seconds, with the server's half still the
 * last build's (`quickPreview.ts` in `@valbuild/shared`).
 */
export const DESIGN_QUICK_PREVIEW_TOOL: AITool = {
  name: "quick_preview",
  description:
    "Show the proposal's change in the preview in seconds, without a build: its code for the browser is bundled here and the page in the preview runs it. " +
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
        error: "Only an open proposal can be previewed.",
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
  return {
    result: {
      success: true,
      seconds: Math.round(result.ms / 100) / 10,
      steps,
      next: "The preview shows it. Check it with read_page or screenshot_page; build_proposal before you say it is done, so the server's half is checked too.",
    },
    isError: false,
  };
}

/** The preview's widths, as the design tab names them. */
export type DesignDevice = "desktop" | "tablet" | "mobile";
const DEVICES: readonly DesignDevice[] = ["desktop", "tablet", "mobile"];

/**
 * `read_page` in the design tab: what the preview shows, read by the page
 * itself through the canvas bridge (`readPageSnapshot`), so the assistant can
 * check its change the way the person would look at it.
 */
export const DESIGN_READ_PAGE_TOOL: AITool = {
  name: "read_page",
  description:
    "Read the page the preview shows, to check a change: its headings, text, links, buttons, images (with alt text) and inputs in order, " +
    "each with its box (x, y, width, height in CSS pixels) and a selector. " +
    "With selector -- one from this answer, or from what the person picked -- that element in detail: its computed styles " +
    "(font, size, weight, colour, background, spacing, layout), how many lines its text wraps to, and its children. " +
    "picked: true reads the element the person picked. device switches the preview's width first (desktop, tablet 820px, mobile 390px), " +
    "which the person sees. Reads the build the preview shows: build first, and wait for it, to read a change.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "An element to read in detail, as this tool or <picked/> writes selectors.",
      },
      picked: {
        type: "boolean",
        description: "Read the element the person picked in the preview.",
      },
      device: {
        type: "string",
        enum: [...DEVICES],
        description: "Switch the preview to this width before reading.",
      },
      max_items: {
        type: "number",
        description: "How many items of the outline at most (default 300).",
      },
    },
    required: [],
  },
};

/** What `read_page` needs of the design tab. */
export type ReadPageDeps = {
  /** Reads the page in front; `null` while no page is there to read. */
  readPage:
    | ((options: {
        selector?: string;
        maxItems?: number;
      }) => Promise<PageSnapshot>)
    | null;
  /** What the person picked, if anything. */
  pointedAt: PickedElement | null;
  /** Switch the preview's width, and wait for the page to take it. */
  setDevice?: (device: DesignDevice) => Promise<void>;
};

export async function runReadPage(
  args: unknown,
  deps: ReadPageDeps,
): Promise<CodeToolAnswer> {
  const fail = (error: string): CodeToolAnswer => ({
    result: { success: false, error },
    isError: true,
  });
  const input = isRecord(args) ? args : {};
  if (deps.readPage === null) {
    return fail(
      "No page is showing in the preview yet. Build the proposal, or wait for its page to load, and read it again.",
    );
  }
  let selector =
    typeof input["selector"] === "string" ? input["selector"] : undefined;
  if (input["picked"] === true) {
    if (deps.pointedAt === null) {
      return fail(
        "Nothing is picked in the preview. Read the whole page, or ask the person to pick the element.",
      );
    }
    selector = deps.pointedAt.selector;
  }
  if (input["device"] !== undefined) {
    const device = DEVICES.find((known) => known === input["device"]);
    if (device === undefined) {
      return fail(`device must be one of ${DEVICES.join(", ")}.`);
    }
    await deps.setDevice?.(device);
  }
  const maxItems =
    typeof input["max_items"] === "number" && input["max_items"] > 0
      ? Math.min(input["max_items"], 1000)
      : undefined;
  try {
    const snapshot = await deps.readPage({
      ...(selector !== undefined ? { selector } : {}),
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    return { result: { success: true, ...snapshot }, isError: false };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * `screenshot_page` in the design tab: a picture of what the preview shows,
 * drawn by the page itself (`screenshotPage`), uploaded as an image of the
 * chat and handed to the model with the answer. `read_page` gives the words
 * and boxes; this is for what they cannot say -- a colour, an overlap, a
 * button that wrapped.
 */
export const DESIGN_SCREENSHOT_TOOL: AITool = {
  name: "screenshot_page",
  description:
    "See the page the preview shows: a picture of it, as the person sees it, attached to the answer. " +
    "What is on screen, or full_page: true for the whole page from the top (cut off below 4000px). " +
    "device switches the preview's width first (desktop, tablet 820px, mobile 390px), which the person sees. " +
    "It is drawn from the page's HTML and CSS, so images from other sites, videos, canvases and embeds may come out blank: " +
    "that is the picture, not the page. Use read_page for exact text, sizes and styles. Reads the build the preview shows.",
  parameters: {
    type: "object",
    properties: {
      full_page: {
        type: "boolean",
        description: "The whole page from the top, not only what is on screen.",
      },
      device: {
        type: "string",
        enum: [...DEVICES],
        description: "Switch the preview to this width first.",
      },
    },
    required: [],
  },
  timeoutMs: 2 * 60_000,
};

/** What `screenshot_page` needs of the design tab and the chat. */
export type ScreenshotPageDeps = {
  /** Pictures the page in front; `null` while no page is there. */
  screenshotPage:
    | ((options: { fullPage?: boolean }) => Promise<PageScreenshot>)
    | null;
  /** Switch the preview's width, and wait for the page to take it. */
  setDevice?: (device: DesignDevice) => Promise<void>;
  /** Upload the picture as an image of the chat: its key. */
  uploadImage: (file: File) => Promise<{ key: string }>;
};

/** A tool's answer with images for the model: their keys, as uploaded. */
export type CodeToolAnswerWithImages = CodeToolAnswer & { images?: string[] };

export async function runScreenshotPage(
  args: unknown,
  deps: ScreenshotPageDeps,
): Promise<CodeToolAnswerWithImages> {
  const fail = (error: string): CodeToolAnswer => ({
    result: { success: false, error },
    isError: true,
  });
  const input = isRecord(args) ? args : {};
  if (deps.screenshotPage === null) {
    return fail(
      "No page is showing in the preview yet. Build the proposal, or wait for its page to load, and try again.",
    );
  }
  if (input["device"] !== undefined) {
    const device = DEVICES.find((known) => known === input["device"]);
    if (device === undefined) {
      return fail(`device must be one of ${DEVICES.join(", ")}.`);
    }
    await deps.setDevice?.(device);
  }
  try {
    const shot = await deps.screenshotPage({
      fullPage: input["full_page"] === true,
    });
    // Decoded here rather than fetched: a page's policy may refuse `data:`.
    const base64 = shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const { key } = await deps.uploadImage(
      new File([bytes], "page.jpg", { type: "image/jpeg" }),
    );
    return {
      result: {
        success: true,
        width: shot.width,
        height: shot.height,
        full_page: shot.fullPage,
        ...(shot.clipped
          ? { note: "The page goes on below the picture." }
          : {}),
        image: "attached",
      },
      isError: false,
      images: [key],
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * `create_patch` in the design tab: content written into the module's FILE in
 * the proposal, and staged there with the code (valbuild/home
 * `docs/design-tab.md`). The tab changes code, so a field the assistant adds
 * is filled in the same change and built with it. The same arguments as the
 * Studio's `create_patch`, so what the model knows of patches holds.
 */
export const DESIGN_CREATE_PATCH_TOOL: AITool = {
  name: "create_patch",
  description:
    "Change content in the proposal: JSON Patch operations, written into the module's file (its .val.ts) and staged " +
    "with the proposal's code, like write_files -- build_proposal makes the preview show it. " +
    "Supported ops: 'replace', 'add', 'remove'. The 'path' is a JSON Pointer AS AN ARRAY (e.g. ['title'], ['items', '0', 'name']); " +
    "a record key that is a URL ('/foo/bar') is ONE segment: ['/foo/bar']. " +
    "Use it for content of a module the proposal changes as well as any other: a field you just added to a schema is filled here. " +
    "Images and files cannot be uploaded here. Entries of a .jsonValues() record live in .val.json files: write those with write_files.",
  parameters: {
    type: "object",
    properties: {
      module_file_path: {
        type: "string",
        description: "The module's file path, e.g. '/content/home.val.ts'.",
      },
      patch: {
        type: "array",
        description: "The JSON Patch operations.",
        items: { type: "object" },
      },
      message: {
        type: "string",
        description:
          "What the change does, in a sentence, for the proposal's history.",
      },
    },
    required: ["module_file_path", "patch"],
  },
};

/** Where the assistant's code tools act: see {@link codeToolsPromptSection}. */
export type CodeToolsWhere =
  | { kind: "site" }
  | { kind: "proposal" }
  /**
   * The design tab: served by the site's build, acting on a proposal it names
   * (valbuild/home `docs/design-tab.md`).
   */
  | { kind: "design"; displayName: string };

/**
 * What the assistant is told about the code tools: that code changes in a
 * proposal and is built there, and -- on the site -- that it does not change
 * here at all.
 */
export function codeToolsPromptSection(where: CodeToolsWhere): string {
  const here =
    where.kind === "proposal"
      ? "This Studio is in a proposal: changes go into it."
      : where.kind === "design"
        ? `This is the design tab of the proposal "${where.displayName}": code changes go into it, and the person sees its preview beside you. Content is changed here with create_patch, which writes it into the module's file in the proposal, staged with the code. get_source and search_content read the SITE's content: read a module the proposal changed with read_file. When a build fails, or the preview does not render, read the error, fix the files, and build again.`
        : "This Studio is on the site, where code is never changed directly. If the person asks for a code change, call write_files anyway: it is refused and the person is offered a proposal to make the change in. Then ask them to open it and make the change there.";
  return `

## The project's code
Besides content, you can read the project's code (list_files, read_file, search_code) and, in a proposal, change it (write_files), format it (format_files), check it (lint, typecheck) and build it (build_proposal). Change code only when the person asks for something content cannot do: a new component, a layout, a field the schema does not have yet.
- Content is not code: change content with create_patch. Write a .val.ts only to change its schema, and keep the content in it.
- Find before you read: search_code finds where something is defined or rendered, then read_file the files it names.
- write_files takes each file's WHOLE new text. Read a file before you change it.
- After changing code, call format_files so the files are formatted as the project's are, then lint and typecheck, and fix what they report; then build_proposal, so the proposal's preview shows it. Tell the person it is in the preview, not on the site: the site changes when the proposal is published.
- A build that is still going when build_proposal answers goes on: wait for it with wait, never by calling build_proposal again and again. If it makes no progress, build_status says at which step, and cancel_build stops it so you can build again.
- ${here}`;
}

/**
 * What the assistant is in the design tab (valbuild/home `docs/design-tab.md`):
 * someone changing a proposal's code, with its preview beside the chat. Not
 * the Studio's prompt, which is for content editors and names tools the tab
 * does not offer.
 */
export function designSystemPrompt(displayName: string): string {
  return `You are a helpful assistant embedded in Val's design tab. You change the code of a proposal -- a copy of the site, published only when someone publishes it -- and the person sees the proposal's preview beside you.

## Who you are talking to
Whoever opened the design tab wants the site's code changed: a component, a layout, a page, a field the schema does not have yet. Say plainly what you changed, and name the files.

## What you can do here
- Find and read the project's code (search_code, list_files, read_file), change it (write_files), format it (format_files), check it (lint, typecheck) and build it (build_proposal), so the preview shows it.
- Change content with create_patch: it is written into the module's file in the proposal and staged with the code, so a field you add to a schema can be filled in the same change.
- Read content to see what the code renders (get_all_schema, get_source, search_content, count_entries, get_record_keys). These read the SITE's content: a module the proposal changed is read with read_file.
- Ask when a request is ambiguous (ask_user_question), and name the session once the topic is clear (set_session_name).

## What the person points at
- <picked .../> at the end of a message is the element the person picked on the page in the preview, and "this" or "here" in the message means it. It names the element's tag, its classes, a selector from the page's body, and the text in it; \`path\`, when present, is the Val source path of the content it shows (a module file path, and the field in it). Find the code that renders it: follow \`path\` from the module to the component that shows that field, or search the components for the classes and the text, and change that.
- <field path="..."/> is a field the person mentioned: the Val source path of some content, found the same way.

## Working
- Keep each change small enough to check: write it, format it, lint and typecheck it and fix what they report, then build.
- A build that fails, or a page that does not render, is not served: the preview keeps the last build that worked, and build_proposal answers with the error. Read it, fix the files, and build again.
- A build still going when build_proposal answers goes on: wait for it with wait. If it is stuck at one step, cancel_build and build again; if it sticks at the same step twice, tell the person which step.
- To see a change to components, layout or styles quickly, call quick_preview after typecheck: the preview shows it in seconds. Its server half (loaders, server functions, API routes, the first render) is the last build's, so build_proposal when you change those, and before you say a change is done.
- Check a change with read_page once its build is served, or once quick_preview has shown it: the text, the order, and -- with a selector -- the computed styles and how many lines a heading wraps to. Read the phone width too (device: "mobile") when the change is about layout.
- When how it LOOKS is the question -- a colour, spacing, an overlap, a layout on a phone -- look at it with screenshot_page: you get a picture of the preview. read_page is for the exact text and sizes.
- When the preview shows the change, say so, and that the site changes only when the proposal is published.${codeToolsPromptSection({ kind: "design", displayName })}`;
}

/**
 * The element picked in the design tab's preview, as the assistant is told
 * it: one line after the person's message, which the design prompt explains
 * ("What the person points at"). Attribute values are escaped, so text on the
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
  client: Pick<ProposalsClient, "files" | "stageFiles" | "patchFile">;
  /** The site's source, as its live build was made from it. */
  siteSource: () => Promise<Record<string, string> | null>;
  /** The proposal's build: start or join it, see where it is, stop it. */
  build: ProposalBuildControl;
  /** For tests: waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Typecheck the proposal, and report it: see `typecheckProposal`. */
  typecheck: () => Promise<CodeTypecheck>;
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
};

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
    if (name === "write_files") {
      if (deps.proposal === null) {
        deps.offerProposal();
        return fail(
          "The site's code is changed in a proposal, never directly, and this Studio is on the site. " +
            "The person has been offered to open a proposal: ask them to, and make the change there.",
        );
      }
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
      const staged = await deps.client.stageFiles(
        deps.proposal.name,
        written,
        message,
      );
      return {
        result: {
          success: true,
          staged: staged.staged.files,
          buildRequired: staged.staged.buildRequired,
          next: staged.staged.buildRequired
            ? "Call build_proposal when the change is complete, so the preview shows it."
            : "The preview already shows these files.",
        },
        isError: false,
      };
    }
    if (name === "create_patch") {
      if (deps.proposal === null) {
        deps.offerProposal();
        return fail(
          "Content is written into a proposal's files only in its design tab.",
        );
      }
      const moduleFilePath = input["module_file_path"];
      const patch = input["patch"];
      if (typeof moduleFilePath !== "string") {
        return fail("module_file_path must be a string.");
      }
      if (!Array.isArray(patch) || patch.length === 0) {
        return fail("patch must be a non-empty array of operations.");
      }
      const message =
        typeof input["message"] === "string" ? input["message"] : undefined;
      const staged = await deps.client.patchFile(
        deps.proposal.name,
        moduleFilePath,
        patch,
        message,
      );
      return {
        result: {
          success: true,
          staged: staged.staged.files,
          buildRequired: staged.staged.buildRequired,
          next: "Written into the module's file and staged. Call build_proposal when the change is complete, so the preview shows it.",
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
    /** `work`, or `null` once `seconds` have passed without it. */
    const within = async <T>(
      work: Promise<T>,
      seconds: number,
    ): Promise<T | null> => {
      let clear = () => {};
      const timeout =
        deps.sleep !== undefined
          ? deps.sleep(seconds * 1000).then(() => null)
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
    };
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
    // Reading: the proposal's project, or the site's.
    const site = (await deps.siteSource()) ?? {};
    let own: Record<string, string | null> = {};
    let staged: ProposalStaged | null = null;
    if (deps.proposal !== null) {
      const read = await deps.client.files(deps.proposal.name);
      own = read.files;
      staged = read.staged;
    }
    const project = proposalProject(site, own);
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
      return {
        result: {
          path,
          text:
            text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) : text,
          ...(text.length > MAX_READ_CHARS ? { truncated: true } : {}),
          ...(staged !== null ? { staged: staged.files.includes(path) } : {}),
        },
        isError: false,
      };
    }
    return fail(`Unknown code tool ${name}.`);
  } catch (error) {
    return fail(messageOf(error));
  }
}

/** One line that matched, where it is. */
export type CodeSearchMatch = { path: string; line: number; text: string };

/**
 * `search_code`: every line of the project that matches, as grep would.
 * A scan of the files in memory, since that is where they are already
 * (valbuild/home `docs/design-tab.md`, "Searching it is a scan in memory"):
 * a project's own code is small. Lockfiles, and anything long enough to be
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
