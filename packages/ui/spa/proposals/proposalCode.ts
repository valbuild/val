import type { AITool } from "../hooks/useAIWebSocket";
import type { StudioDeployResult } from "../publish/runStudioDeploy";
import type { BuildTargetResponse } from "@valbuild/shared/internal";
import {
  ProposalsApiError,
  type ProposalJson,
  type ProposalsClient,
  type ProposalStaged,
} from "./proposalsClient";

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

/** The proposal's project: the site's source, with what the proposal changed laid over it. */
export function proposalProject(
  site: Record<string, string>,
  own: Record<string, string | null>,
): Record<string, string> {
  const out = { ...site };
  for (const [path, text] of Object.entries(own)) {
    if (text === null) delete out[path];
    else out[path] = text;
  }
  return out;
}

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

const BUILD_PROPOSAL_TOOL: AITool = {
  name: "build_proposal",
  description:
    "Build the proposal's code, so its preview shows the files staged with write_files. " +
    "Takes from a few seconds to a minute. Nothing is published: the site is unchanged until the proposal is merged.",
  parameters: { type: "object", properties: {}, required: [] },
  // A build is seconds to a minute; the server's default wait is 30 s.
  timeoutMs: 5 * 60_000,
};

export const CODE_TOOLS: AITool[] = [
  LIST_FILES_TOOL,
  READ_FILE_TOOL,
  WRITE_FILES_TOOL,
  BUILD_PROPOSAL_TOOL,
];

/**
 * What the assistant is told about the code tools: that code changes in a
 * proposal and is built there, and -- on the site -- that it does not change
 * here at all.
 */
export function codeToolsPromptSection(inProposal: boolean): string {
  return `

## The project's code
Besides content, you can read the project's code (list_files, read_file) and, in a proposal, change it (write_files) and build it (build_proposal). Change code only when the person asks for something content cannot do: a new component, a layout, a field the schema does not have yet.
- Content is not code: change content with create_patch. Write a .val.ts only to change its schema, and keep the content in it.
- write_files takes each file's WHOLE new text. Read a file before you change it.
- After the change is complete, call build_proposal so the proposal's preview shows it, and tell the person it is in the preview, not on the site: the site changes when the proposal is published.
- ${
    inProposal
      ? "This Studio is in a proposal: changes go into it."
      : "This Studio is on the site, where code is never changed directly. If the person asks for a code change, call write_files anyway: it is refused and the person is offered a proposal to make the change in. Then ask them to open it and make the change there."
  }`;
}

const CODE_TOOL_NAMES = new Set(CODE_TOOLS.map((tool) => tool.name));
export function isCodeTool(name: string): boolean {
  return CODE_TOOL_NAMES.has(name);
}

/** What a build of the proposal came to. */
export type ProposalBuildOutcome =
  | { status: "built"; hash: string | null; proposal: ProposalJson }
  | { status: "nothing-staged" }
  | { status: "already-built"; hash: string | null }
  | { status: "failed"; message: string };

/**
 * Where a build of the proposal is, around the deploy: the deploy's own steps
 * are the Studio's deploy state (`useStudioDeployState`), and these are the
 * parts before and after it.
 *
 * - `reading`: the proposal's files and the target to build them on.
 * - `deploying`: the deploy is running; its state says which step.
 * - `serving`: content is putting the build up at the proposal's address.
 * - `waiting`: that request did not come back -- a gateway gave up on it --
 *   and content is asked until it says the proposal is built.
 */
export type ProposalBuildStep =
  | { kind: "reading" }
  | { kind: "deploying" }
  | { kind: "serving"; since: number }
  | { kind: "waiting"; since: number };

/**
 * Files that never go into a build: lockfiles, at any depth. The same list as
 * content's `NEVER_SHIPPED` (valbuild/home `content/src/val/dependencyFiles.ts`).
 *
 * A merge builds from the site's source with the proposal's files over it,
 * without these (`shippedFiles` there). The proposal's own build has to be
 * made of the same files, or the two are named differently: a merge then
 * never finds the proposal's build held, and builds the whole site again --
 * which is every upgrade, since an upgrade stages a `pnpm-lock.yaml`.
 */
const NEVER_SHIPPED = new Set([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

export function withoutLockfiles<T>(
  files: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(files).filter(
      ([path]) => !NEVER_SHIPPED.has(path.slice(path.lastIndexOf("/") + 1)),
    ),
  );
}

/**
 * Whether serving got no answer from content rather than a refusal: the
 * connection failed, or a gateway stopped waiting -- Cloudflare's 52x (524 is
 * "no answer in 100 seconds"), and the 502-504 of anything else in between.
 * Content goes on with the request either way, so the build may well be
 * served.
 */
function gatewayGaveUp(error: unknown): boolean {
  // No answer at all: `fetch` rejects with a TypeError when the connection
  // fails or is cut. Anything else is a failure with words of its own.
  if (error instanceof TypeError) return true;
  if (!(error instanceof ProposalsApiError)) return false;
  return (
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    (error.status >= 520 && error.status <= 527)
  );
}

/** How long, and how often, content is asked whether it served the build. */
export const SERVE_WAIT_MS = 4 * 60_000;
export const SERVE_POLL_MS = 5_000;

/**
 * Build the proposal's staged files and serve the build at its address.
 *
 * The files and what they are for (`inputs`) come in one answer, so the build
 * names exactly what it was made of; content refuses it if they were staged
 * again meanwhile. The tab builds as for a publish and stops once the build is
 * uploaded -- nothing goes live -- and content hands it to the platform.
 *
 * Serving can take longer than a gateway waits for an answer, and content
 * finishes it all the same. So a gateway that gives up is not a failure: the
 * proposal is read until it says it is built from these inputs, and served
 * once more only if it never does.
 */
export async function buildProposal(deps: {
  name: string;
  client: Pick<ProposalsClient, "files" | "serveBuild" | "buildTarget" | "get">;
  /**
   * `target`: the proposal's own, when it changed the dependencies and builds
   * on the layer content had built for it; `undefined` builds on the site's,
   * as every build of a proposal did before.
   */
  deploy: (
    files: Record<string, string | null>,
    target: BuildTargetResponse | undefined,
  ) => Promise<StudioDeployResult>;
  /**
   * Whether this document can build at all (`canBuildHere`): Safari cannot,
   * and a proposal's build has no builder tab to hand off to yet.
   */
  canBuildHere: () => boolean;
  onStep?: (step: ProposalBuildStep) => void;
  /** For tests: the clock, and waiting on it. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ProposalBuildOutcome> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const step = deps.onStep ?? (() => {});
  if (!deps.canBuildHere()) {
    return {
      status: "failed",
      message:
        "This browser cannot build in this tab. Open the proposal in Chrome, Edge or Firefox and build it there",
    };
  }
  step({ kind: "reading" });
  let read;
  try {
    read = await deps.client.files(deps.name);
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  const { files, staged } = read;
  if (staged.inputs === null) return { status: "nothing-staged" };
  if (!staged.buildRequired) return { status: "already-built", hash: null };
  const inputs = staged.inputs;
  let target: BuildTargetResponse | undefined;
  try {
    const asked = await deps.client.buildTarget(deps.name);
    target = asked.layer === "own" ? asked.target : undefined;
  } catch (error) {
    // A content service from before proposals had targets of their own:
    // every proposal builds on the site's layer there, as it always did.
    if (!(error instanceof ProposalsApiError && error.status === 404)) {
      // Content's words: the dependencies are being built, or why they
      // could not be.
      return { status: "failed", message: messageOf(error) };
    }
  }
  step({ kind: "deploying" });
  const built = await deps.deploy(withoutLockfiles(files), target);
  if (built.status !== "uploaded") {
    return {
      status: "failed",
      message:
        built.status === "failed"
          ? built.message
          : "The build went live instead of stopping once uploaded.",
    };
  }
  const serve = async () => {
    step({ kind: "serving", since: now() });
    return deps.client.serveBuild(deps.name, {
      publishId: built.publishId,
      inputs,
    });
  };
  const servedNow = async (): Promise<ProposalJson | null> => {
    try {
      const proposal = await deps.client.get(deps.name);
      return proposal.staged?.inputs === inputs &&
        proposal.staged.buildRequired === false &&
        proposal.built?.hash
        ? proposal
        : null;
    } catch {
      return null;
    }
  };
  const builtOf = (proposal: ProposalJson): ProposalBuildOutcome => ({
    status: "built",
    hash: proposal.built?.hash ?? null,
    proposal,
  });
  try {
    return builtOf(await serve());
  } catch (error) {
    if (!gatewayGaveUp(error)) {
      return { status: "failed", message: messageOf(error) };
    }
    const since = now();
    step({ kind: "waiting", since });
    while (now() - since < SERVE_WAIT_MS) {
      await sleep(SERVE_POLL_MS);
      const served = await servedNow();
      if (served !== null) return builtOf(served);
    }
    // Content never said: ask once more, and take its answer.
    try {
      return builtOf(await serve());
    } catch (again) {
      return { status: "failed", message: messageOf(again) };
    }
  }
}

export type CodeToolDeps = {
  /** The proposal this Studio is open in; `null` on the site. */
  proposal: { name: string } | null;
  client: Pick<ProposalsClient, "files" | "stageFiles">;
  /** The site's source, as its live build was made from it. */
  siteSource: () => Promise<Record<string, string> | null>;
  build: () => Promise<ProposalBuildOutcome>;
  /** Offer the person a proposal to make the change in. */
  offerProposal: () => void;
};

/** A tool's answer to the model: what it did, or why not. */
export type CodeToolAnswer = { result: unknown; isError: boolean };

const MAX_LISTED = 2000;
const MAX_READ_CHARS = 200_000;

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
    if (name === "build_proposal") {
      if (deps.proposal === null) {
        deps.offerProposal();
        return fail(
          "Only a proposal is built here, and this Studio is on the site. The person has been offered to open one.",
        );
      }
      const outcome = await deps.build();
      if (outcome.status === "failed") return fail(outcome.message);
      return {
        result: { success: true, ...withoutProposal(outcome) },
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

function withoutProposal(
  outcome: Exclude<ProposalBuildOutcome, { status: "failed" }>,
) {
  if (outcome.status !== "built") return outcome;
  return { status: outcome.status, hash: outcome.hash };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
