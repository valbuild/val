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
  setup: Job.nullable().optional(),
  overlay: Job.nullable().optional(),
  renderCheck: Job.nullable().optional(),
});
export type ProposalJson = z.infer<typeof ProposalJson>;

const ListAnswer = z.object({
  proposals: z.array(ProposalJson),
  siteUrl: z.string().nullable().optional(),
});
const OneAnswer = z.object({ proposal: ProposalJson });

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
  }): Promise<ProposalJson>;
  rename(name: string, displayName: string): Promise<ProposalJson>;
  close(name: string): Promise<ProposalJson>;
  reopen(name: string): Promise<ProposalJson>;
  retrySetup(name: string): Promise<ProposalJson>;
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
