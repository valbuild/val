import { z } from "zod";
import type { SerializedSchema } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import {
  JSONValue as JSONValueSchema,
  parseBuildTarget,
  type BuildTargetResponse,
  type SchemaError,
} from "@valbuild/shared/internal";
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

/**
 * What a proposal builds on (valbuild/home `docs/adept.md`, step 6): the
 * site's dependencies; its own, built (`own`), being built (`pending`) or
 * not (`failed`); or none yet, because they changed without a lockfile to
 * match (`lockfile`), which {@link ProposalsClient.computeLockfile} computes.
 * A state this Studio does not know reads as the site's.
 */
const Dependencies = z
  .union([
    z.object({ state: z.enum(["site", "own", "pending"]) }),
    z.object({ state: z.literal("failed"), error: z.string().nullable() }),
    z.object({
      state: z.literal("lockfile"),
      computing: z.boolean(),
      error: z.string().nullable(),
    }),
  ])
  .catch({ state: "site" });
export type ProposalDependencies = z.infer<typeof Dependencies>;

/**
 * An upgrade proposal's upgrade (valbuild/home `docs/adept.md`, step 7):
 * `computing` while adept works it out, `staged` once its files are, or
 * `nothing` to upgrade, or `failed` and why.
 */
const UpgradeJson = z.object({
  path: z.enum(["cves", "latest", "majors"]),
  state: z.enum(["computing", "staged", "nothing", "failed"]),
  changes: z.array(
    z.object({
      name: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      kind: z.enum(["major", "minor", "patch"]).nullable().catch(null),
    }),
  ),
  vulnerableBefore: z.number().nullable(),
  vulnerableAfter: z.number().nullable(),
  error: z.string().nullable(),
});
export type ProposalUpgrade = z.infer<typeof UpgradeJson>;

const TypeErrorJson = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
  code: z.number(),
  message: z.string(),
});
/** A type error the base does not have (decision 20). */
export type ProposalTypeError = z.infer<typeof TypeErrorJson>;

/**
 * The typecheck reported for a proposal: of which staged inputs, how many
 * new errors in all, and the first of them.
 */
const TypecheckJson = z.object({
  inputs: z.string(),
  newErrors: z.number(),
  errors: z.array(TypeErrorJson),
  checkedAt: z.string(),
});
export type ProposalTypecheck = z.infer<typeof TypecheckJson>;

const ProposalJson = z.object({
  name: z.string(),
  branch: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  /**
   * Everyone who owns it, `ownerId` first: the authors of changes moved into
   * it together own it together (step 8.2). Absent from older content.
   */
  ownerIds: z.array(z.string()).optional(),
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
  /** What it builds on. Only on a read of one, and absent from older content. */
  dependencies: Dependencies.optional(),
  /** How it was started. A kind this Studio does not know is an editor's. */
  kind: z.string().optional(),
  /** An upgrade proposal's upgrade: what it moves, and where it is. */
  upgrade: UpgradeJson.optional(),
  /** The last typecheck reported for it. Only on a read of one. */
  typecheck: TypecheckJson.nullable().optional(),
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
const LockfileAnswer = z.object({ dependencies: Dependencies });
const TypecheckAnswer = z.object({ typecheck: TypecheckJson });
const MergeCheck = z.object({
  id: z.string(),
  ok: z.boolean(),
  message: z.string(),
  /** What clears it, when something here does. Unknown actions are none. */
  action: z
    .enum(["update-from-site", "compute-lockfile", "typecheck"])
    .optional()
    .catch(undefined),
});
export type MergeCheckJson = z.infer<typeof MergeCheck>;
const MergeChecksAnswer = z.object({
  checks: z.array(MergeCheck),
  canMerge: z.boolean(),
});

/**
 * Something the site and the proposal both changed since it started, as Val's
 * merge reports it (valbuild/home `docs/hosted-publishing.md`, step 8.2).
 * `invalid`: content the merge combined that its schema does not allow.
 */
const UpdateConflict = z.union([
  z.object({
    kind: z.literal("field"),
    moduleFilePath: z.string(),
    path: z.array(z.string()),
    base: z.unknown(),
    site: z.unknown(),
    proposal: z.unknown(),
  }),
  z.object({
    kind: z.literal("invalid"),
    moduleFilePath: z.string(),
    path: z.array(z.string()),
    value: z.unknown(),
    message: z.string(),
  }),
  /** A file both sides changed: a component, or a `.val.ts`'s schema. */
  z.object({
    kind: z.literal("code"),
    file: z.string(),
    base: z.string().nullable(),
    site: z.string().nullable(),
    proposal: z.string().nullable(),
  }),
]);
export type UpdateConflict = z.infer<typeof UpdateConflict>;
const UpdateContentAnswer = z.union([
  z.object({ status: z.literal("updated"), commit: z.string() }),
  z.object({ status: z.literal("up-to-date") }),
  z.object({
    status: z.literal("conflicts"),
    conflicts: z.array(UpdateConflict),
    /** Where the site and the proposal were: sent back with the decisions. */
    siteHead: z.string().nullable(),
    proposalHead: z.string().nullable(),
  }),
]);
export type UpdateContentAnswer = z.infer<typeof UpdateContentAnswer>;
/** A decision about one conflict: which side's value the proposal keeps. */
export type UpdateResolution = {
  moduleFilePath: string;
  path: string[];
  keep: "site" | "proposal";
};
/** The same for a file: which side's code the proposal keeps. */
export type CodeResolution = { file: string; keep: "site" | "proposal" };
/** Where the site and the proposal were when content conflicts were found. */
export type ContentHeads = {
  siteHead: string | null;
  proposalHead: string | null;
};

/** Content's trees, for the builder tab to evaluate: see `MergeTrees`. */
const MergeTreesAnswer = z.object({
  base: z.string().nullable(),
  siteHead: z.string().nullable(),
  proposalHead: z.string().nullable(),
  upToDate: z.boolean(),
  builds: z.object({ base: z.string(), site: z.string() }),
  trees: z.object({
    site: z.record(z.string(), z.string()),
    base: z.record(z.string(), z.string().nullable()),
    proposal: z.record(z.string(), z.string().nullable()),
  }),
  modules: z.record(
    z.string(),
    z.object({
      base: z.string().nullable(),
      site: z.string().nullable(),
      proposal: z.string().nullable(),
    }),
  ),
  sources: z.record(z.string(), JSONValueSchema),
});
const UpdateCodeAnswer = z.union([
  z.object({
    status: z.literal("updated"),
    commit: z.string(),
    proposal: ProposalJson,
  }),
  z.object({ status: z.literal("up-to-date") }),
  z.object({
    status: z.literal("conflicts"),
    conflicts: z.array(UpdateConflict),
  }),
  z.object({
    status: z.literal("evaluate"),
    id: z.string(),
    files: z.record(z.string(), z.string().nullable()),
    sources: z.record(z.string(), JSONValueSchema.nullable()),
  }),
]);
export type UpdateCodeAnswer = z.infer<typeof UpdateCodeAnswer>;
/** A module as evaluating its tree gave it: see `EvaluatedModule`. */
export type EvaluatedModules = Record<
  string,
  {
    schema: SerializedSchema;
    written: JSONValue;
    errors: SchemaError[];
  }
>;
export type UpdateCodeRequest = {
  siteHead: string | null;
  proposalHead: string | null;
  builds: { base: string; site: string };
  evaluated: Record<"base" | "site" | "proposal", EvaluatedModules>;
  resolutions: (UpdateResolution | CodeResolution)[];
  merged?: { id: string; evaluated: EvaluatedModules };
};

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

/**
 * Whether a refused content-only update is one the update with code makes:
 * Val's server says the proposal or the site changed code (`needs-build`), or
 * changed a `.jsonValues()` record in a way only the full merge reads
 * (`needs-full-merge`).
 */
export function needsCodeUpdate(error: unknown): boolean {
  return (
    error instanceof ProposalsApiError &&
    error.status === 409 &&
    z
      .object({ status: z.enum(["needs-build", "needs-full-merge"]) })
      .safeParse(error.body).success
  );
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
    /**
     * An upgrade proposal (valbuild/home `docs/adept.md`, step 7): content
     * has adept compute the upgrade and stages it. `skip`: for majors, the
     * packages not to move.
     */
    kind?: "upgrade";
    upgrade?: { path: "cves" | "latest" | "majors"; skip?: string[] };
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
   * Update from the site for a proposal that changes only content: the
   * site's published changes merged into it, at its own address. Conflicts
   * come back for a person; the same call with their `resolutions`, and the
   * heads the conflicts answer named, merges -- unless the site or the
   * proposal moved since, when the conflicts come back as they are now.
   * The published-since check's action.
   */
  updateContent(
    name: string,
    resolutions: UpdateResolution[],
    heads?: ContentHeads,
  ): Promise<UpdateContentAnswer>;
  /**
   * Update from the site with code: content's three trees, for the builder
   * tab to evaluate (valbuild/home `docs/hosted-publishing.md`, step 8.2).
   */
  mergeTrees(name: string): Promise<z.infer<typeof MergeTreesAnswer>>;
  /**
   * The merge of those trees, at the proposal's own address: first the merge
   * for the tab to evaluate (`evaluate`), then -- sent again with that
   * evaluation as `merged` -- committed.
   */
  updateCode(name: string, body: UpdateCodeRequest): Promise<UpdateCodeAnswer>;
  /**
   * "Go back to this point" with the code: the files of the build the site
   * served at `commit` (a commit of the site's history) staged in it, and that
   * build served at its address. valbuild/home `docs/hosted-publishing.md`,
   * step 9.
   */
  restoreCode(name: string, commit: string): Promise<ProposalJson>;
  /**
   * What a build of it targets: the site's, or -- when it changed the
   * project's dependencies -- its own framework and layer, which content had
   * adept build (valbuild/home `docs/adept.md`, step 6). A 409 while they are
   * being built or when they could not be, which says so.
   */
  buildTarget(name: string): Promise<ProposalBuildTarget>;
  /**
   * Report the typecheck of its staged `inputs`: the errors the site's code
   * does not have (decision 20). A proposal with dependencies of its own is
   * not published until one is reported, with none.
   */
  reportTypecheck(
    name: string,
    report: {
      inputs: string;
      newErrors: ProposalTypeError[];
      count?: number;
    },
  ): Promise<ProposalTypecheck>;
  /**
   * Compute the lockfile of a proposal whose dependencies changed without one
   * to match: content has adept work it out and stages it, which builds the
   * dependencies from it. Answers at once, with what the proposal now builds
   * on; a 409 when there is nothing to compute.
   */
  computeLockfile(name: string): Promise<ProposalDependencies>;
  /** Serve a build of its staged files, uploaded as `publishId`, at its address. */
  serveBuild(
    name: string,
    build: { publishId: string; inputs: string },
  ): Promise<ProposalJson>;
  /**
   * Render its own build on the platform, as a canary, the way a publish
   * does before it goes live: whether the build of what it stages boots. A
   * build that rendered already answers at once. A 409 when it is not built
   * of what it stages; a 404 from a content service without it.
   */
  verifyBuild(name: string): Promise<ProposalBuildVerify>;
  /**
   * Where an upgrade proposal is before its upgrade page takes over: set up,
   * the upgrade worked out, its dependencies built -- with adept's own account
   * of the job it is at (valbuild/home `docs/plans/upgrades-v2.md`, piece C).
   */
  preparation(name: string): Promise<ProposalPreparation>;
};

const Preparation = z.object({
  stage: z.enum([
    "setup",
    "upgrade",
    "dependencies",
    "ready",
    "nothing",
    "failed",
  ]),
  error: z.string().nullable(),
  adept: z
    .object({
      step: z.string().nullable(),
      queued: z.number().nullable(),
      phase: z.object({ index: z.number(), of: z.number() }).nullable(),
      packages: z.object({ done: z.number(), expected: z.number() }).nullable(),
    })
    .nullable(),
});
/** Where an upgrade proposal is before its upgrade page takes over. */
export type ProposalPreparation = z.infer<typeof Preparation>;

const VerifyAnswer = z.object({
  ok: z.boolean(),
  problems: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      hint: z.string().optional(),
    }),
  ),
  /** The platform failed, not the build: asking again can help. */
  transient: z.boolean(),
});
/** What rendering a proposal's own build found. */
export type ProposalBuildVerify = z.infer<typeof VerifyAnswer>;

/**
 * A proposal's build target, and whose layer it is: `own` when the proposal
 * changed the dependencies and builds on the layer content had built for it,
 * `site` otherwise.
 */
export type ProposalBuildTarget = {
  target: BuildTargetResponse;
  layer: "site" | "own";
};

const LayerOf = z.object({ layer: z.enum(["site", "own"]).optional() });

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
    buildTarget: async (name) => {
      const answer = await call(`${at(name)}/build-target`, "GET");
      return {
        target: parseBuildTarget(answer),
        layer: LayerOf.parse(answer).layer ?? "site",
      };
    },
    reportTypecheck: async (name, report) =>
      TypecheckAnswer.parse(await call(`${at(name)}/typecheck`, "POST", report))
        .typecheck,
    computeLockfile: async (name) =>
      LockfileAnswer.parse(await call(`${at(name)}/lockfile`, "POST", {}))
        .dependencies,
    serveBuild: (name, build) => one(`${at(name)}/build`, "POST", build),
    verifyBuild: async (name) =>
      VerifyAnswer.parse(await call(`${at(name)}/verify`, "POST", {})),
    preparation: async (name) =>
      Preparation.parse(await call(`${at(name)}/preparation`, "GET")),
    updateFromSite: (name) => one(`${at(name)}/update-from-site`, "POST", {}),
    updateContent: async (name, resolutions, heads) =>
      UpdateContentAnswer.parse(
        await call(`${at(name)}/update-content`, "POST", {
          resolutions,
          ...heads,
        }),
      ),
    restoreCode: (name, commit) =>
      one(`${at(name)}/restore-code`, "POST", { commit }),
    mergeTrees: async (name) =>
      MergeTreesAnswer.parse(await call(`${at(name)}/merge-trees`, "GET")),
    updateCode: async (name, body) =>
      UpdateCodeAnswer.parse(
        await call(`${at(name)}/update-code`, "POST", body),
      ),
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
    ownedByViewer:
      viewer !== null &&
      (json.ownerIds ?? (json.ownerId ? [json.ownerId] : [])).includes(viewer),
    changes: json.changes ?? 0,
    ...(json.upgrade !== undefined ? { upgrade: true } : {}),
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
