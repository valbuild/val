import { z } from "zod";
import type {
  ProposalJobState,
  ProposalPerson,
  ProposalSummary,
} from "../components/proposals/types";

/**
 * Proposals, as a Studio tab speaks them: through this deployment's
 * `/proposals-api`, which checks the session and carries content's answer
 * back unread (`ValOpsHttp.proposalsApi`). valbuild/home `docs/proposals.md`,
 * Flow B.
 *
 * Only what the Studio reads is parsed, and leniently where content may be
 * older than this Studio: an `address` or a `changes` it does not send yet is
 * "no address" and "no count", not a failure to list.
 */

const Job = z.object({
  status: z.enum(["pending", "running", "succeeded", "failed"]),
  lastError: z.string().nullable().optional(),
});

const ProposalJson = z.object({
  name: z.string(),
  branch: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  status: z.enum([
    "open",
    "updating",
    "needs-resolution",
    "merging",
    "merged",
    "closed",
  ]),
  updatedAt: z.string(),
  closedBy: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  changes: z.number().optional(),
  /** Merged, and what was written during the merge has gone where it goes. */
  carriedOver: z.boolean().optional(),
  /** The proposal what was written during its merge continues in. */
  continuedIn: z.string().nullable().optional(),
  setup: Job.nullable().optional(),
  overlay: Job.nullable().optional(),
  renderCheck: Job.nullable().optional(),
  /** Its own build, once one is made: the address serves it. */
  built: z
    .object({ hash: z.string(), inputs: z.string() })
    .nullable()
    .optional(),
  /** What it holds of the project's code. Only on a read of one. */
  staged: z
    .object({
      files: z.array(z.string()),
      inputs: z.string().nullable(),
      buildRequired: z.boolean(),
    })
    .optional(),
});
export type ProposalJson = z.infer<typeof ProposalJson>;

const Staged = z.object({
  files: z.array(z.string()),
  inputs: z.string().nullable(),
  buildRequired: z.boolean(),
});
/** A proposal's staged files, and whether its address needs a build of them. */
export type ProposalStaged = z.infer<typeof Staged>;
const FilesAnswer = z.object({
  files: z.record(z.string(), z.string().nullable()),
  staged: Staged,
});
const StagedAnswer = z.object({ commit: z.string(), staged: Staged });

const ListAnswer = z.object({
  proposals: z.array(ProposalJson),
  siteUrl: z.string().nullable().optional(),
});
const OneAnswer = z.object({ proposal: ProposalJson });
const MergeCheck = z.object({
  id: z.string(),
  ok: z.boolean(),
  message: z.string(),
  /** What clears it, when something here does. Unknown actions are none. */
  action: z
    .string()
    .optional()
    .transform((action) =>
      action === "update-from-site" ? action : undefined,
    ),
});
export type MergeCheckJson = z.infer<typeof MergeCheck>;
const MergeChecksAnswer = z.object({
  checks: z.array(MergeCheck),
  canMerge: z.boolean(),
});

/** An answer that was not a success: content's status and its words. */
export class ProposalsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ProposalsApiError";
  }

  /**
   * The proposal content named when it refused to create one that exists:
   * a 409 carries it in `details.proposal`.
   */
  existing(): ProposalJson | null {
    if (this.status !== 409) return null;
    const parsed = z
      .object({ details: z.object({ proposal: ProposalJson }) })
      .safeParse(this.body);
    return parsed.success ? parsed.data.details.proposal : null;
  }
}

export type ProposalsClient = {
  list(): Promise<{ proposals: ProposalJson[]; siteUrl: string | null }>;
  get(name: string): Promise<ProposalJson>;
  create(input: {
    displayName: string;
    description?: string;
    /**
     * The create's own id, one per New proposal: sent again, it answers the
     * proposal the first one made rather than making a second.
     */
    requestId: string;
    /**
     * Pending changes on the site to move into it as it is made: all of them,
     * or the create is refused. A restore on the site opens a proposal this
     * way (valbuild/home `docs/hosted-publishing.md`, step 9).
     */
    patchIds?: string[];
  }): Promise<ProposalJson>;
  rename(name: string, displayName: string): Promise<ProposalJson>;
  close(name: string): Promise<ProposalJson>;
  reopen(name: string): Promise<ProposalJson>;
  retrySetup(name: string): Promise<ProposalJson>;
  /** Whether it may be merged into the site now, and if not, who to ask. */
  mergeChecks(
    name: string,
  ): Promise<{ checks: MergeCheckJson[]; canMerge: boolean }>;
  /**
   * What it holds of the project's files -- every path its saves and
   * stagings wrote, `null` for a delete -- and what is staged. Over the
   * site's source, the proposal's project. valbuild/home
   * `docs/hosted-publishing.md`, step 7.
   */
  files(name: string): Promise<z.infer<typeof FilesAnswer>>;
  /** Stage files in it: change the project's code there. `null` deletes. */
  stageFiles(
    name: string,
    files: Record<string, string | null>,
    message?: string,
  ): Promise<z.infer<typeof StagedAnswer>>;
  /**
   * Onto the site as it is now: its base build becomes the site's, and its
   * staged code needs building again. The site-code check's action.
   */
  updateFromSite(name: string): Promise<ProposalJson>;
  /**
   * "Go back to this point" with the code: the files of the build the site
   * served at `commit` (a commit of the site's history) staged in it, and that
   * build served at its address. valbuild/home `docs/hosted-publishing.md`,
   * step 9.
   */
  restoreCode(name: string, commit: string): Promise<ProposalJson>;
  /** Serve a build of its staged files, uploaded as `publishId`, at its address. */
  serveBuild(
    name: string,
    build: { publishId: string; inputs: string },
  ): Promise<ProposalJson>;
};

export function createProposalsClient(options: {
  /** This deployment's Val API, e.g. `/api/val`. */
  api: string;
  fetchImpl?: typeof fetch;
}): ProposalsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.api.replace(/\/+$/, "")}/proposals-api`;
  const call = async (
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
  ): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      // The session cookie is the whole credential this end has.
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      throw new ProposalsApiError(res.status, messageOf(parsed, res), parsed);
    }
    return parsed;
  };
  const one = async (
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
  ) => OneAnswer.parse(await call(path, method, body)).proposal;
  const at = (name: string) => `/${encodeURIComponent(name)}`;
  return {
    list: async () => {
      const answer = ListAnswer.parse(await call("", "GET"));
      return { proposals: answer.proposals, siteUrl: answer.siteUrl ?? null };
    },
    get: (name) => one(at(name), "GET"),
    create: (input) => one("", "POST", input),
    rename: (name, displayName) => one(at(name), "PATCH", { displayName }),
    close: (name) => one(`${at(name)}/close`, "POST", {}),
    reopen: (name) => one(`${at(name)}/reopen`, "POST", {}),
    retrySetup: (name) => one(`${at(name)}/setup/retry`, "POST", {}),
    mergeChecks: async (name) =>
      MergeChecksAnswer.parse(await call(`${at(name)}/merge-checks`, "GET")),
    files: async (name) =>
      FilesAnswer.parse(await call(`${at(name)}/files`, "GET")),
    stageFiles: async (name, files, message) =>
      StagedAnswer.parse(
        await call(`${at(name)}/files`, "POST", {
          files,
          ...(message !== undefined ? { message } : {}),
        }),
      ),
    serveBuild: (name, build) => one(`${at(name)}/build`, "POST", build),
    updateFromSite: (name) => one(`${at(name)}/update-from-site`, "POST", {}),
    restoreCode: (name, commit) =>
      one(`${at(name)}/restore-code`, "POST", { commit }),
  };
}

function messageOf(parsed: unknown, res: Response): string {
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "message" in parsed &&
    typeof parsed.message === "string"
  ) {
    return parsed.message;
  }
  return `The proposals API answered ${res.status}.`;
}

/**
 * Whether an answer means "this project has no proposals here" rather than
 * "something went wrong": proposals turned off (404), a server with no
 * content service (501). A server too old to know the route is a 404 too.
 */
export function meansNoProposals(error: unknown): boolean {
  return (
    error instanceof ProposalsApiError &&
    (error.status === 404 || error.status === 501)
  );
}

/** A job as the bar and the list show it. */
export function jobState(
  job: z.infer<typeof Job> | null | undefined,
): ProposalJobState | null {
  if (!job) return null;
  if (job.status === "failed") {
    return { status: "failed", error: job.lastError ?? null };
  }
  return { status: job.status };
}

/**
 * A proposal as the screens show it. `viewer` is the profile id of the person
 * looking, so lists can say "You"; `people` names the rest.
 */
export function toSummary(
  json: ProposalJson,
  viewer: string | null,
  people: (id: string) => ProposalPerson | null,
): ProposalSummary {
  const owner = json.ownerId ? people(json.ownerId) : null;
  return {
    name: json.name,
    displayName: json.displayName,
    description: json.description ? json.description : null,
    /*
     * The screens know three states. Updating, needing resolution and
     * merging are all still OPEN -- the work going on in them arrives with
     * merging and with the git sessions, which will say so in their own words.
     */
    status:
      json.status === "merged" || json.status === "closed"
        ? json.status
        : "open",
    owner,
    ownedByViewer: viewer !== null && json.ownerId === viewer,
    changes: json.changes ?? 0,
    updatedAt: json.updatedAt,
    ...(json.setup !== undefined ? { setup: jobState(json.setup) } : {}),
    ...(json.closedBy ? { closedBy: people(json.closedBy) } : {}),
  };
}

/**
 * Where to send the browser to be in a proposal -- or on the site -- on the
 * same Studio page it is on now: the proposal is a copy of the site, so the
 * page this editor is looking at is there too.
 */
export function sameStudioPageAt(
  origin: string,
  here: Pick<Location, "pathname" | "search" | "hash">,
): string {
  return new URL(`${here.pathname}${here.search}${here.hash}`, origin).href;
}
