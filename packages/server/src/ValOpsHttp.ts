import {
  proposalJsonEntries,
  layeredSnapshot,
  proposalSnapshot,
  type ValContentVersion,
  type ValProposal,
} from "./proposal";
import {
  type PatchId,
  type ModuleFilePath,
  ValModules,
  Internal,
} from "@valbuild/core";
import type {
  Patch as PatchT,
  ParentRef as ParentRefT,
} from "@valbuild/core/patch";
import {
  type AuthorId,
  type BaseSha,
  BinaryFileType,
  type CommitSha,
  GenericErrorMessage,
  MetadataOfType,
  OpsMetadata,
  PreparedCommit,
  ValOps,
  ValOpsOptions,
  WithGenericError,
  SaveSourceFilePatchResult,
  SchemaSha,
  OrderedPatchesMetadata,
  OrderedPatches,
  SourcesSha,
  type PublishRefusal,
} from "./ValOps";
import { z } from "zod";
import {
  mergeContent,
  type ContentMergeResult,
} from "./proposalMerge/mergeContent";
import { updateWithCode } from "./proposalMerge/updateCode";
import { patchModuleText } from "./patchModuleText";
import {
  MoveInputs,
  movesAtMerge,
  type MergeMoves,
} from "./proposalMerge/movesAtMerge";
import { fromError } from "zod-validation-error";
import type { HistoryError } from "./history/HistoryError";
import type {
  AffectedFile,
  StoredModuleVersion,
  CommitPage,
  CommitPatch,
  HistoricalCommit,
} from "./history/types";
import {
  ParentRef,
  Patch,
  ValCommit,
  ValDeployment,
  JSONValue as JSONValueSchema,
  PatchId as PatchIdSchema,
  SerializedSchema as SerializedSchemaSchema,
  PlanRefusalError,
} from "@valbuild/shared/internal";
import { result } from "@valbuild/core/fp";
import {
  getErrorMessageFromUnknownJson,
  newestCommitSha,
} from "@valbuild/shared/internal";

const textEncoder = new TextEncoder();

/** The body of the content API's 403 for a write the project's plan refuses. */
const PlanRefusedBody = z.object({ error: PlanRefusalError });

/** `POST /proposals-api/<name>/patch-file`: see `patchFileInProposal`. */
const PatchFileBody = z.object({
  moduleFilePath: z.string().regex(/^\/.+\.val\.(ts|js)$/),
  patch: Patch,
  message: z.string().max(500).optional(),
});

/** What `patchFileInProposal` reads of content's answer for a proposal's files. */
const ProposalFilesRead = z.object({
  files: z.record(z.string(), z.string().nullable()),
});

const PatchId = z.string().refine((s): s is PatchId => !!s); // TODO: validate
const CommitSha = z.string().refine((s): s is CommitSha => !!s); // TODO: validate
const BaseSha = z.string().refine((s): s is BaseSha => !!s); // TODO: validate
const AuthorId = z.string().refine((s): s is AuthorId => !!s); // TODO: validate
const ModuleFilePath = z.string().refine((s): s is ModuleFilePath => !!s); // TODO: validate
const Metadata = z.union([
  z.object({
    mimeType: z.string(),
    width: z.number(),
    height: z.number(),
  }),
  z.object({
    mimeType: z.string(),
  }),
]);
const MetadataRes = z.object({
  filePath: ModuleFilePath,
  metadata: Metadata,
  type: z.union([z.literal("file"), z.literal("image")]).nullable(),
});

const GetApplicablePatches = z.object({
  patches: z.array(
    z.object({
      path: z.string(),
      patch: Patch.nullable(),
      patchId: z.string(),
      authorId: z.string().nullable(),
      baseSha: z.string(),
      createdAt: z.string(),
      applied: z
        .object({
          commitSha: z.string(),
        })
        .nullable(),
    }),
  ),
  /**
   * The head of the chain. See `OrderedPatches.headPatchId`. Optional because
   * a content service that predates it sends nothing.
   */
  headPatchId: PatchIdSchema.nullable().optional(),
  /**
   * The chain version of that head. See `OrderedPatches.headVersion`.
   * Optional for the same reason.
   */
  headVersion: z.number().optional(),
  /** The branch's last commit. See `OrderedPatches.headCommitSha`. */
  headCommitSha: z.string().nullable().optional(),
  /** Of `patches`, the ones a running publish holds. See `OrderedPatches.publishingPatches`. */
  publishingPatches: z.array(PatchIdSchema).optional(),
  /** Of `patches`, the ones a failed publish holds back. See `OrderedPatches.heldBackPatches`. */
  heldBackPatches: z.array(PatchIdSchema).optional(),
  commits: z
    .array(
      z.object({
        commitSha: z.string(),
        /*
         * Nullable since the content service mints its own commit shas: a
         * root commit has no parent, and a publisher that did not say where
         * it was has no client sha. Parsed rather than trusted, so a service
         * that sends null gets null here instead of failing the whole poll.
         */
        clientCommitSha: z.string().nullable(),
        parentCommitSha: z.string().nullable(),
        commitMessage: z.string().nullable(),
        branch: z.string(),
        creator: z.string(),
        createdAt: z.string(),
      }),
    )
    .optional(),
  deployments: z
    .array(
      z.object({
        deploymentId: z.string(),
        commitSha: z.string(),
        deploymentState: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        // The git message, where the content service knows it. See
        // `ValDeployment`: this is the only source for a deployment that Val
        // did not publish, and zod would otherwise strip it here.
        commitMessage: z.string().nullable().optional(),
      }),
    )
    .optional(),
  /**
   * What the project EXPECTS of whoever publishes it.
   *
   * Optional because a content service that predates it sends nothing, and
   * absent means "not reported" -- never "managed". The difference decides
   * whether a publish is refused, so guessing either way would be worse than
   * not checking: guessing `managed` would let a deployment publish a
   * connected project it cannot mirror, and guessing `connected` would refuse
   * every publish against an older service.
   */
  project: z
    .object({
      sourceMode: z.union([z.literal("managed"), z.literal("connected")]),
      branch: z.string(),
      /**
       * Whether a press of Publish is a publish JOB. Absent from a content
       * service that predates connected jobs: then managed projects publish
       * as jobs, and connected ones by commit, as they did.
       */
      publishJobs: z.boolean().optional(),
    })
    .optional(),
});
const FilesResponse = z.object({
  files: z.array(
    z.union([
      z.object({
        filePath: z.string(),
        location: z.literal("patch"),
        patchId: PatchId,
        value: z.string(),
        remote: z.boolean(),
      }),
      z.object({
        filePath: z.string(),
        location: z.literal("repo"),
        commitSha: CommitSha,
        value: z.string(),
      }),
    ]),
  ),
  errors: z
    .array(
      z.union([
        z.object({
          filePath: z.string(),
          location: z.literal("patch"),
          patchId: PatchId,
          message: z.string(),
          remote: z.boolean(),
        }),
        z.object({
          filePath: z.string(),
          location: z.literal("repo"),
          commitSha: CommitSha,
          message: z.string(),
        }),
      ]),
    )
    .optional(),
});
const SavePatchResponse = z.object({
  patchId: PatchId,
  /**
   * The chain version this write made, comparable with `headVersion` on the
   * listing. Optional: a content service that predates it sends nothing.
   */
  headVersion: z.number().optional(),
});
const DeletePatchesResponse = z.object({
  deleted: z.array(PatchId),
  errors: z
    .array(
      z.object({
        message: z.string(),
        patchId: PatchId,
        /** The publish job holding it, when that is why it was not deleted. */
        publishJobId: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * The chain version each branch the delete changed is now at, keyed by
   * branch. Optional: a content service that predates it sends none.
   */
  headVersions: z.record(z.string(), z.number()).optional(),
});
/**
 * This client's own branch's entry in a per-branch version map.
 *
 * A delete can span branches, so the content service answers per branch. With
 * no branch of its own (a build with no repository, where the service resolves
 * it), the only entry is ours when there is exactly one; with several, none can
 * be picked, and a wrong one would floor this client at another chain's count.
 */
export function ownBranchVersion(
  headVersions: Record<string, number> | undefined,
  branch: string | undefined,
): number | undefined {
  if (headVersions === undefined) return undefined;
  if (branch !== undefined) return headVersions[branch];
  const versions = Object.values(headVersions);
  return versions.length === 1 ? versions[0] : undefined;
}

const SavePatchFileResponse = z.object({
  patchId: PatchId,
  filePath: ModuleFilePath,
});
const CommitResponse = z.object({
  updatedFiles: z.array(z.string()),
  commit: CommitSha,
  /*
   * Optional because a content service that predates them sends neither, and
   * this client talks to whichever one the project is on. Absent means NOT
   * REPORTED: `parent: undefined` is not "a root commit", and a caller that
   * reads it as one would conclude the history starts here.
   *
   * Unbranded strings deliberately -- see `CommitResult.parent`. They arrive
   * from a service that versions separately and are passed through as what it
   * said, not as something this end vouched for.
   */
  parent: z.string().optional(),
  tree: z.string().optional(),
  branch: z.string(),
  /** The chain version the publish moved the branch to; absent if it applied nothing. */
  headVersion: z.number().optional(),
});
// #region history wire schemas
//
// Validated on arrival rather than trusted: these come from a service that
// versions separately, and a silently mis-shaped commit record reads as "this
// commit changed nothing", which is indistinguishable from a real answer.
const HistoricalCommitResponse = z.object({
  commitSha: z.string(),
  /** `null` for a root commit; see the note on the applicable-patches schema. */
  parentCommitSha: z.string().nullable(),
  /** `null` when the publisher did not say where it was. */
  clientCommitSha: z.string().nullable(),
  branch: z.string(),
  createdBranch: z.string().nullable(),
  creator: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
  seqNum: z.string(),
  patchCount: z.number(),
  hasArchive: z.boolean(),
});

const ListCommitsResponse = z.object({
  commits: z.array(HistoricalCommitResponse),
  nextCursor: z.string().nullable(),
});

const CommitPatchesResponse = z.object({
  commitSha: z.string(),
  commit: z.object({
    commitSha: z.string(),
    parentCommitSha: z.string().nullable(),
    clientCommitSha: z.string().nullable(),
    branch: z.string(),
    createdBranch: z.string().nullable(),
    creator: z.string().nullable(),
    message: z.string().nullable(),
    createdAt: z.string(),
    seqNum: z.string(),
    hasArchive: z.boolean(),
  }),
  patches: z.array(
    z.object({
      patchId: z.string(),
      path: z.string(),
      patch: z.unknown(),
      authorId: z.string().nullable(),
      createdAt: z.string(),
      baseSha: z.string(),
      coreVersion: z.string(),
    }),
  ),
});

/**
 * `home` — `Api["/commits/:commitSha/modules"]["GET"]["res"]`.
 *
 * `schema` stays `unknown` here on purpose. The content service stores it
 * opaquely and cannot vouch for it, so validating it at the transport boundary
 * would turn "a schema written by a different version of Val" into a failed
 * REQUEST rather than one module that cannot be shown. It is checked in
 * `getHistoricalPatchSet`, per module, where a failure degrades that module and
 * leaves the commit readable.
 */
const CommitModulesResponse = z.object({
  commitSha: z.string(),
  // Null for a project's first commit: a hosted one's first publish has none.
  parentCommitSha: z.string().nullable(),
  /**
   * Whether an `asOf` read covered the whole project.
   *
   * Optional so an older content server still parses. False means modules last
   * edited before history started being recorded are missing from the answer -
   * which a whole-project revert has to say out loud rather than silently skip.
   */
  complete: z.boolean().optional(),
  modules: z.array(
    z.object({
      moduleFilePath: z.string(),
      commitSha: z.string(),
      sourceSha: z.string().nullable(),
      schemaSha: z.string(),
      // Validated, because a Source IS just JSON and this side knows that much.
      source: JSONValueSchema.nullable(),
      schema: z.unknown(),
      unavailable: z.boolean(),
    }),
  ),
});

const CommitAffectedFilesResponse = z.object({
  commitSha: z.string(),
  files: z.array(
    z.union([
      z.object({
        kind: z.union([
          z.literal("module-source"),
          z.literal("json-entry"),
          z.literal("binary"),
        ]),
        gitPath: z.string(),
        change: z.union([
          z.literal("added"),
          z.literal("modified"),
          z.literal("deleted"),
        ]),
      }),
      z.object({
        kind: z.literal("remote-binary"),
        ref: z.string(),
        change: z.union([
          z.literal("added"),
          z.literal("modified"),
          z.literal("deleted"),
        ]),
      }),
    ]),
  ),
});
// #endregion history wire schemas

const NonceResponse = z.object({
  nonce: z.string(),
  url: z.string(),
});

export class ValOpsHttp extends ValOps {
  private readonly authHeaders:
    | { Authorization: string }
    | { "x-val-pat": string };
  private readonly root: string;
  /** Val's content service owns the store. See {@link ValOps.patchesAreLocal}. */
  override readonly patchesAreLocal = false;
  override readonly kind = "http";
  /** See {@link ValOps.requiresAuth}. */
  override readonly requiresAuth = true;
  /**
   * A commit mirrors into `.val.ts` only when there is a repository.
   *
   * See {@link ValOps.mirrorsSourceFiles}. Set in the constructor rather than
   * as an initialiser because it depends on `git`, and a class field
   * initialiser runs before the constructor body has assigned it.
   */
  protected override readonly mirrorsSourceFiles: boolean;
  /**
   * The running build's own source, when the host embedded it.
   *
   * Preferred over the content service for the `.val.ts` text a publish
   * patches, for two reasons. It is exactly the text this build was made from,
   * which is what the patches in its chain were written against. And it is the
   * only copy there is for a project with no repository: the content service
   * keeps a managed project's content as Source, not as files, and answers a
   * file read for one with "no GitHub repo".
   */
  private readonly projectSource: Record<string, string> | null;
  /** See `publishJob` on {@link ValApiOptions}; sent only with no commit. */
  private readonly publishJob: string | null;
  /** See `publishBuild` on {@link ValApiOptions}; sent with every position. */
  private readonly publishBuild: string | null;
  /** See `proposal` on {@link ValApiOptions}; `null` on the site. */
  private readonly proposal: ValProposal | null;
  /** See `contentVersion` on {@link ValApiOptions}; `null` at a proposal's address. */
  private readonly contentVersion: ValContentVersion | null;

  /** Did the host hand over the running build's source? See `projectSource`. */
  embedsSource(): boolean {
    return this.projectSource !== null;
  }

  /**
   * The Val source this build embeds, as git blob shas by path from the
   * project root: every module and `val.modules.*`. `null` when it embeds no
   * source.
   *
   * For a build of no commit -- the template's, which a project `/new` made
   * with a repository is served until CI's first build -- so the content
   * service can compare it with the branch file by file, having no commit to
   * compare from. A git blob sha is `sha1("blob <bytes>\0" + content)`, which is
   * what makes it comparable with the branch's tree without reading a file.
   */
  async embeddedValSourceShas(): Promise<Record<string, string> | null> {
    if (this.projectSource === null) return null;
    const encoder = new TextEncoder();
    const shas: Record<string, string> = {};
    for (const [path, content] of Object.entries(this.projectSource)) {
      const base = path.slice(path.lastIndexOf("/") + 1);
      const isValSource =
        path.endsWith(".val.ts") ||
        path.endsWith(".val.js") ||
        path.endsWith(".val.json") ||
        base === "val.modules.ts" ||
        base === "val.modules.js";
      if (!isValSource) continue;
      const body = encoder.encode(content);
      const header = encoder.encode(`blob ${body.byteLength}\0`);
      const bytes = new Uint8Array(header.byteLength + body.byteLength);
      bytes.set(header, 0);
      bytes.set(body, header.byteLength);
      const digest = await crypto.subtle.digest("SHA-1", bytes);
      shas[path.replace(/^\/+/, "")] = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
    return shas;
  }
  /**
   * What the content service last said this project expects of its publisher.
   *
   * `null` until something has asked it, which in practice is the first poll.
   * It is remembered rather than asked for on demand because the answer is
   * only wanted on the publish path, and that path already fetches the
   * patches it is publishing -- so a dedicated request would be a second round
   * trip for two fields that just arrived.
   *
   * It can be one poll out of date, and that is the right amount: the thing it
   * changes is whether this deployment can mirror commits into a repository,
   * which changes when a project CONNECTS one -- and a project that has just
   * connected is one whose builds are about to be replaced anyway.
   */
  private projectExpectation: {
    sourceMode: "managed" | "connected";
    branch: string;
    publishJobs?: boolean;
  } | null = null;

  constructor(
    private readonly contentUrl: string,
    private readonly project: string,
    /**
     * The repository this project's commits are mirrored into, or `null`.
     *
     * `null` is a project whose content service is the store of record: it
     * mints its own commit shas, and it knows this project's branch from the
     * project itself. Every request below that would have carried a branch and
     * a commit omits them instead, and the service answers from the project's
     * own chain -- which is where those answers always came from.
     *
     * It is NOT a degraded mode. The one thing that genuinely needs a
     * repository is producing the `.val.ts` text a commit mirrors, and a
     * project with no repository has nothing to mirror into. See `git` on
     * {@link ValApiOptions}.
     */
    private readonly git: { commit: string; branch: string } | null,
    /**
     * An api key (how the app itself authenticates) or a personal access token
     * (how the CLI authenticates after `val login`). Same two shapes as
     * getSettings / uploadRemoteFile / getPresignedAuthNonce.
     */
    auth: { apiKey: string } | { pat: string },
    valModules: ValModules,
    options?: ValOpsOptions & {
      /**
       * Root of project relative to repository.
       * E.g. if this is a monorepo and the current app is in the /apps/my-app folder,
       * the root would be /apps/my-app
       */
      root?: string;
      /** See `projectSource` on {@link ValApiOptions}. */
      projectSource?: Record<string, string>;
      /** See `publishJob` on {@link ValApiOptions}. */
      publishJob?: string;
      /** See `publishBuild` on {@link ValApiOptions}. */
      publishBuild?: string;
      /** See `proposal` on {@link ValApiOptions}. */
      proposal?: ValProposal;
      /** See `contentVersion` on {@link ValApiOptions}. */
      contentVersion?: ValContentVersion;
    },
  ) {
    /*
     * What replaces the bundle's Source: the content version the site serves,
     * and a proposal's saves over it at its address. Two layers rather than
     * one, because the version is the SITE -- what a proposal is compared
     * against -- and the proposal is what is being proposed.
     */
    const snapshot = layeredSnapshot(
      options?.proposal,
      options?.contentVersion,
    );
    super(
      valModules,
      options && snapshot
        ? {
            ...options,
            ...(options.proposal !== undefined
              ? { snapshotSources: proposalSnapshot(options.proposal) }
              : {}),
            ...(options.contentVersion !== undefined
              ? {
                  siteSnapshotSources: proposalSnapshot(options.contentVersion),
                }
              : {}),
            snapshotJsonEntries: proposalJsonEntries(
              snapshot,
              options.projectSource,
            ),
          }
        : options,
    );
    this.authHeaders =
      "pat" in auth
        ? { "x-val-pat": auth.pat }
        : { Authorization: `Bearer ${auth.apiKey}` };
    this.root = options?.root ?? "";
    this.proposal = options?.proposal ?? null;
    this.contentVersion =
      this.proposal === null ? (options?.contentVersion ?? null) : null;
    /*
     * In a proposal, the text its saves wrote over the text the build was made
     * from: the next save patches the last one's `.val.ts`, not the base's.
     * The same for a content version: the next publish patches what the last
     * one published, not what the build bundles.
     */
    this.projectSource =
      snapshot !== undefined
        ? { ...(options?.projectSource ?? {}), ...snapshot.files }
        : (options?.projectSource ?? null);
    this.publishJob = options?.publishJob ?? null;
    /*
     * Not with a content version: the content service places a build by the
     * build first (`getApplicablePatchesAndCommits`), and this build bundles an
     * older version than it serves -- placed there, the version's own changes
     * would be replayed over a snapshot that already holds them.
     */
    this.publishBuild =
      this.contentVersion === null ? (options?.publishBuild ?? null) : null;
    this.mirrorsSourceFiles = git !== null || this.projectSource !== null;
  }
  /**
   * A deployment that cannot mirror a project which expects to be mirrored.
   *
   * This is the one shape of "no base" that exists, and it is not the one it
   * sounds like. A project with no repository is fine: the content service is
   * the store of record for it and mints its own commit shas, so there is
   * always somewhere for the commit to go. What is refused is the mismatch --
   * a project whose commits are mirrored into a repository, being published by
   * a build that was made before it had one and so has no commit to produce
   * that mirror against.
   *
   * It is a REAL state rather than a defensive check: it is exactly what a
   * deployment looks like between a project connecting a repository and its
   * next build going out. Left unchecked, such a publish writes the data and
   * silently fails to mirror it, and the repository quietly falls behind the
   * content nobody is told about.
   *
   * `null` when the service did not say (see `project` on the response
   * schema): an older content service is not evidence of anything, and
   * refusing every publish against one would be a worse failure than not
   * checking.
   */
  override publishRefusal(): PublishRefusal | null {
    // A save in a proposal mirrors nothing: it reaches git by merging.
    if (this.git !== null || this.proposal !== null) {
      return null;
    }
    /*
     * Content runs this project's publishes as jobs, and its prepare decides
     * what the push goes on top of -- including for a site that was never
     * built from a commit (a project `/new` made, before its first CI build).
     * Refusing here would refuse what content can answer.
     */
    if (this.publishesAsJobs()) {
      return null;
    }
    if (this.projectExpectation?.sourceMode !== "connected") {
      return null;
    }
    return {
      code: "no-base",
      message:
        `This project mirrors its content into a git repository (branch ` +
        `'${this.projectExpectation.branch}'), but this deployment was not ` +
        "built from one, so it does not know which commit to write that " +
        "mirror against. Publishing would save the content and silently " +
        "leave the repository behind. Deploy this project again from its " +
        "repository, and publishing will work from that build on.",
    };
  }

  /**
   * What the content service last said this project's source mode is.
   *
   * Read off the same remembered expectation {@link publishRefusal} uses. It is
   * CURRENT wherever it matters rather than a poll behind, and by construction
   * rather than by luck: the only caller is `/stat`, which awaits `getStat`
   * first, and that fetches the patches -- which is the response the expectation
   * is recorded from.
   *
   * `null` before anything has fetched patches, which is the same "not
   * reported" the wire field means, and reads as connected. The alternative
   * would be to ask for it separately, which is a round trip for a field that
   * has just arrived.
   */
  override sourceMode(): "managed" | "connected" | null {
    /*
     * Not reported in a proposal, whatever the project is. The Studio reads
     * `managed` as "I am the deployer" and follows a commit with a build it
     * publishes to the SITE -- and a proposal's commit is a Save, which its
     * address serves without any build at all.
     */
    if (this.proposal !== null) return null;
    return this.projectExpectation?.sourceMode ?? null;
  }

  /** See {@link ValOps.canReadPublishedFiles}: not without a repository. */
  override canReadPublishedFiles(): boolean {
    return this.git !== null;
  }

  /** Remembered with {@link sourceMode}, from the same response. */
  override projectBranch(): string | null {
    return this.projectExpectation?.branch ?? null;
  }

  /**
   * Does a press of Publish run as a publish job? Every managed project, and
   * a connected one content says is hosted on the platform (its CI publishes
   * through content). `false` before anything has been heard.
   */
  /**
   * Ask the content service what this project expects of its publisher, when
   * nothing has been heard yet.
   *
   * What {@link publishesAsJobs} and {@link sourceMode} read is remembered
   * from the overlay this server last fetched, and a server that has fetched
   * none has heard nothing. That is not rare: the platform runs a site in many
   * isolates, each with a Val server of its own, so a publish's prepare can
   * reach one that has never served an overlay. It was refused ("This
   * deployment cannot prepare a publish job") as though the project did not
   * publish as jobs at all. Best effort: a content service that does not
   * answer leaves it unheard, and the caller refuses as before.
   */
  async learnProjectExpectation(): Promise<void> {
    if (this.projectExpectation !== null) return;
    await this.fetchPatchesInternal({ excludePatchOps: true }).catch(
      () => undefined,
    );
  }

  override publishesAsJobs(): boolean {
    // A proposal's Save is a commit on its branch; its merge is the publish.
    if (this.proposal !== null) return false;
    const expected = this.projectExpectation;
    if (expected === null) return false;
    return expected.publishJobs ?? expected.sourceMode === "managed";
  }

  /**
   * The short-lived publish token, and when it stops being usable.
   *
   * `null` until something publishes, which for most deployments is never.
   */
  private publishToken: { token: string; expiresAt: number } | null = null;

  /**
   * Trade this deployment's credential for one that can do one thing.
   *
   * Content's publish API takes a PROJECT TOKEN and nothing else --
   * `authenticateProjectToken` refuses anything that is not one, deliberately,
   * because a personal access token is a person's credential and does not name
   * a project. What this deployment holds is the project's api key, which is
   * neither.
   *
   * `POST /v1/{org}/{project}/publish-token` is the exchange, and it was built
   * for exactly this: its own docblock names the case where "the caller was the
   * project's api key ... a machine exchanging one machine credential for a
   * narrower one". What comes back can publish one project for ten minutes.
   *
   * So the api key never leaves this process and the browser never sees any
   * credential at all. That is the point of routing the publish through here
   * rather than letting the tab talk to content.
   */
  private async mintPublishToken(): Promise<
    { token: string; expiresAt: number } | { error: string; status: number }
  > {
    const res = await fetch(
      `${this.contentUrl}/v1/${this.project}/publish-token`,
      { method: "POST", headers: this.authHeaders },
    );
    const text = await res.text();
    if (!res.ok) {
      return {
        status: res.status,
        error:
          `Could not get a publish token for '${this.project}': ` +
          `${res.status} ${text.slice(0, 300)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        status: 502,
        error: "The publish token exchange did not answer with JSON.",
      };
    }
    const token =
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof parsed.token === "string"
        ? parsed.token
        : null;
    if (token === null) {
      return {
        status: 502,
        error: "The publish token exchange sent no token.",
      };
    }
    const expiresAtRaw =
      typeof parsed === "object" && parsed !== null && "expiresAt" in parsed
        ? parsed.expiresAt
        : null;
    const expiresAt =
      typeof expiresAtRaw === "string" ? Date.parse(expiresAtRaw) : NaN;
    return {
      token,
      /*
       * A token with no expiry, or one we cannot read, is treated as expiring
       * NOW -- so it is used for this call and minted again for the next.
       * Caching one we cannot reason about is how a publish starts failing
       * halfway through, days later, for no reason anyone can see.
       */
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    };
  }

  /**
   * A usable publish token, minting one when what we have will not last.
   *
   * The margin is what stops a token that is valid when the publish starts from
   * expiring in the middle of it: a publish is five calls and an upload of
   * every artifact, and the upload is the slow one.
   */
  private async currentPublishToken(): Promise<
    { token: string } | { error: string; status: number }
  > {
    const margin = 60_000;
    if (
      this.publishToken !== null &&
      this.publishToken.expiresAt - margin > Date.now()
    ) {
      return { token: this.publishToken.token };
    }
    const minted = await this.mintPublishToken();
    if ("error" in minted) {
      this.publishToken = null;
      return minted;
    }
    this.publishToken = minted;
    return { token: minted.token };
  }

  /**
   * adept, through content: lockfiles, upgrades and type bundles, for the
   * Studio's unlinked `/val/adept` page. A job is content's to scope to
   * this project; a name and a version are matched, not passed, so nothing
   * with a `..` reaches another of content's routes.
   *
   * Allowed at a proposal's address too: adept computes and publishes
   * nothing, so there is nothing a proposal's Studio could move on the site.
   */
  private static adeptPathAllowed(path: string): boolean {
    return (
      /^\/adept\/(lockfile|upgrade|jobs\/\d{1,18}(\/result)?|compiler\/[0-9A-Za-z][0-9A-Za-z.+-]{0,63})$/.test(
        path,
      ) ||
      /^\/adept\/types\/public\/(@[a-z0-9~-][a-z0-9._~-]{0,213}\/)?[a-z0-9~-][a-z0-9._~-]{0,213}@[0-9a-z][0-9a-z.+-]{0,63}$/i.test(
        path,
      )
    );
  }

  /**
   * The content paths this may reach, and nothing else.
   *
   * An allow list rather than a prefix check, because this method holds a
   * credential and the browser chooses the path. `/publish/{id}` and its three
   * steps are the publish conversation; `/build-target` is what a build needs
   * to know before it starts; `/project-source` is what it builds. Not
   * `/update-target` any more: a managed project's dependencies are upgraded
   * in a proposal (valbuild/home `docs/adept.md`, step 7), not by publishing
   * its template's.
   *
   * `/project-source` is here rather than on a route of its own because it is
   * one of the three things a publish asks for and none of them are useful
   * apart -- and because the credential is the same one. The Studio cannot get
   * the project's files any other way: it runs inside the deployment, which
   * holds a session for its own origin and an api key for content, and content
   * is the only thing it is allowed to talk to at all.
   *
   * A publish id is opaque and content-generated, so it is matched rather than
   * parsed -- what matters is that nothing with a `..`, a query or another
   * segment gets through.
   */
  private static publishApiPathAllowed(path: string): boolean {
    // A merge's prepare is content's own, from the proposal's last save.
    if (/^\/publish-jobs\/[A-Za-z0-9_-]{1,100}\/merge-prepare$/.test(path)) {
      return true;
    }
    if (
      path === "/build-target" ||
      path === "/project-source" ||
      path === "/publish" ||
      // Where "View run" goes, for a connected build CI reported failed.
      // Read only: reporting a run is CI's, with its own token.
      path === "/ci-runs/newest" ||
      // Whether there is anything to upgrade, and the site's lockfile the
      // typecheck of an upgrade compares against (valbuild/home
      // `docs/adept.md`, step 7). Both read only.
      path === "/upgrades" ||
      path === "/dependency-files"
    ) {
      return true;
    }
    /*
     * Publishing as a queued job: a press, where it is, Try again, and the
     * tab's reports about the job it runs. NOT `/publish-jobs/{id}/prepare`:
     * its body is the job's source files and modules, which this server
     * computes (`prepareJob`) -- a browser allowed to send it could publish
     * any text at all as a commit's archive.
     */
    if (/^\/publish-requests(\/[A-Za-z0-9_-]{1,100})?$/.test(path)) {
      return true;
    }
    if (ValOpsHttp.adeptPathAllowed(path)) return true;
    if (
      /^\/publish-jobs\/(next|[A-Za-z0-9_-]{1,100}\/(steps|renew|cancel|discard))$/.test(
        path,
      )
    ) {
      return true;
    }
    return /^\/publish\/[A-Za-z0-9_-]+(\/(artifacts|verify|promote))?$/.test(
      path,
    );
  }

  override async publishApi(
    path: string,
    init: { method: string; body?: string },
  ): Promise<{ status: number; body: string; contentType: string }> {
    /*
     * Nothing is published from a proposal's address: its way to the site is
     * a merge. The publish API reaches the SITE's builds and jobs, so a
     * Studio there that asked would be publishing over the site.
     */
    if (
      this.proposal !== null &&
      !ValOpsHttp.mergeApiPathAllowed(init.method, path)
    ) {
      return {
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          message:
            "This is a proposal's address: nothing is published from here. " +
            "A proposal reaches the site by being merged.",
        }),
      };
    }
    if (!ValOpsHttp.publishApiPathAllowed(path)) {
      return {
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          message: `'${path}' is not part of the publish API.`,
        }),
      };
    }
    return this.callPublishApi(path, init);
  }

  override currentProposal(): { name: string; branch: string } | null {
    return this.proposal === null
      ? null
      : { name: this.proposal.name, branch: this.proposal.branch };
  }

  /**
   * Which proposal calls the browser may make, by method and the path after
   * `/proposals`: list and open, read and rename one, read what its build
   * targets and how far an upgrade's preparation is, render its build as a
   * canary (`verify`), and close, reopen and retry its setup. Not `/save` -- the Studio saves through `/save`, which
   * prepares the commit here -- and not `/patches`, which moves the site's
   * changes into a proposal and has no screen yet.
   */
  private static proposalsApiAllowed(method: string, path: string): boolean {
    if (path === "") return method === "GET" || method === "POST";
    const one = /^\/[0-9a-f]{20}$/.test(path);
    if (one) return method === "GET" || method === "PATCH";
    if (method === "GET")
      return /^\/[0-9a-f]{20}\/(merge-checks|files|merge-trees|build-target|preparation)$/.test(
        path,
      );
    return (
      method === "POST" &&
      /^\/[0-9a-f]{20}\/(close|reopen|setup\/retry|merge|files|lockfile|typecheck|build|verify|update-from-site|restore-code)$/.test(
        path,
      )
    );
  }

  /**
   * A write to a proposal's FILES -- staging code, computing its lockfile
   * (valbuild/home `docs/adept.md`, step 6), reporting the typecheck of
   * them (step 7, decision 20), serving a build of it
   * (valbuild/home `docs/hosted-publishing.md`, step 7), or moving it onto the
   * site's code (step 8, "Update from the site"). The proposal it names and
   * what it does, or `null` when this path is not such a write.
   *
   * Who may make one is {@link ValOpsHttp.mayWriteFiles}.
   */
  private static proposalFilesWrite(
    method: string,
    path: string,
  ): { name: string; write: string } | null {
    if (method !== "POST") return null;
    const match =
      /^\/([0-9a-f]{20})\/(files|lockfile|typecheck|build|update-from-site|restore-code)$/.exec(
        path,
      );
    return match === null ? null : { name: match[1], write: match[2] };
  }

  /**
   * The writes the SITE's server may make to a proposal's files: what the
   * design tab does (valbuild/home `docs/design-tab.md`, step 2) -- stage
   * code, build it, and report its typecheck. The tab is served by the site's
   * build so that a build the assistant breaks in the proposal cannot take
   * down the tools it would fix it with; at the proposal's address those
   * tools run on the proposal's own code.
   *
   * The typecheck too, though it blocks the proposal's Publish (adept.md,
   * decision 20): it is the proposal's staged files checked against the
   * site's, the same program from either address, and the content service
   * keeps it only for the inputs it was made from. Without it the tab's
   * Types check, and the assistant's `typecheck`, had nothing to show.
   *
   * The rest stay the proposal's own: Update from the site and the lockfile
   * are answered from the proposal's build and schemas, and bringing back a
   * point's code is the Studio at its address finishing a restore.
   */
  private static readonly SITE_MAY_WRITE = new Set([
    "files",
    "build",
    "typecheck",
  ]);

  /**
   * Whether this server may make a write to a proposal's files: the
   * proposal's own server, any of them; the site's, the design tab's; and a
   * proposal's address, none to another proposal. Either way the site's own
   * files change only when a proposal is merged.
   */
  private mayWriteFiles(write: { name: string; write: string }): boolean {
    if (this.proposal !== null) return write.name === this.proposal.name;
    return ValOpsHttp.SITE_MAY_WRITE.has(write.write);
  }

  /**
   * What a proposal's address may reach of the publish API: building ITS OWN
   * merge, and nothing that publishes the site's changes. The merge's prepare
   * (content's, from the proposal's last save), the build it needs -- the
   * site's build target and source, declaring and uploading the build -- and
   * the job's own steps. Not a press of the site's Publish, not `next` (which
   * would hand this tab a site job), and not the site job's prepare.
   */
  private static mergeApiPathAllowed(method: string, path: string): boolean {
    if (
      path === "/build-target" ||
      path === "/project-source" ||
      path === "/publish"
    ) {
      return true;
    }
    // An upgrade proposal's typecheck compares against the site's lockfile,
    // and its chrome asks whether there is anything to upgrade. Read only.
    if (
      method === "GET" &&
      (path === "/upgrades" || path === "/dependency-files")
    ) {
      return true;
    }
    if (/^\/publish\/[A-Za-z0-9_-]+\/artifacts$/.test(path)) return true;
    if (ValOpsHttp.adeptPathAllowed(path)) return true;
    // Where its press is -- read only: a POST there is the site's Try again.
    if (
      method === "GET" &&
      path !== "/publish-requests/try-again" &&
      /^\/publish-requests\/[A-Za-z0-9_-]{1,100}$/.test(path)
    )
      return true;
    return /^\/publish-jobs\/[A-Za-z0-9_-]{1,100}\/(merge-prepare|steps|renew|cancel)$/.test(
      path,
    );
  }

  override async proposalsApi(
    path: string,
    init: { method: string; body?: string },
    profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const updating = /^\/([0-9a-f]{20})\/update-content$/.exec(path)?.[1];
    if (updating !== undefined && init.method === "POST") {
      return this.updateContentFromSite(updating, init.body, profileId);
    }
    const patching = /^\/([0-9a-f]{20})\/patch-file$/.exec(path)?.[1];
    if (patching !== undefined && init.method === "POST") {
      return this.patchFileInProposal(patching, init.body, profileId);
    }
    const withCode = /^\/([0-9a-f]{20})\/update-code$/.exec(path)?.[1];
    if (withCode !== undefined && init.method === "POST") {
      return this.updateCodeFromSite(withCode, init.body, profileId);
    }
    /*
     * Publish, and the checks before it, at the proposal's own address: Val
     * says which of the site's pending changes the merge moves, from this
     * build's schemas (step 8.2). Anywhere else they go to content as they
     * are, and the site's pending changes block as they always did.
     */
    const checking = /^\/([0-9a-f]{20})\/merge-checks$/.exec(path)?.[1];
    if (
      checking !== undefined &&
      init.method === "GET" &&
      (await this.answersMovesFor(checking, profileId))
    ) {
      return this.mergeChecksWithMoves(checking, profileId);
    }
    const pressing = /^\/([0-9a-f]{20})\/merge$/.exec(path)?.[1];
    if (
      pressing !== undefined &&
      init.method === "POST" &&
      (await this.answersMovesFor(pressing, profileId))
    ) {
      return this.pressMergeWithMoves(pressing, init.body, profileId);
    }
    if (!ValOpsHttp.proposalsApiAllowed(init.method, path)) {
      return {
        status: 403,
        contentType: json,
        body: JSON.stringify({
          message: `'${init.method} ${path}' is not part of the proposals API.`,
        }),
      };
    }
    const writes = ValOpsHttp.proposalFilesWrite(init.method, path);
    if (writes !== null && !this.mayWriteFiles(writes)) {
      return {
        status: 403,
        contentType: json,
        body: JSON.stringify({
          message:
            this.proposal === null
              ? "Only the proposal's own Studio does this: open the proposal, and do it there."
              : "Files are changed in the proposal this Studio is open in, not in another.",
        }),
      };
    }
    const res = await fetch(
      `${this.contentUrl}/v1/${this.project}/proposals${path}`,
      {
        method: init.method,
        headers: {
          ...this.authHeaders,
          /*
           * WHO is asking, as for a commit: the app's key names the project,
           * and a proposal is opened, renamed and closed by a person -- content
           * refuses those writes from a credential that names nobody.
           */
          ...(profileId !== null ? { "x-val-profile-id": profileId } : {}),
          ...(init.body === undefined ? {} : { "Content-Type": json }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      },
    );
    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get("Content-Type") ?? json,
    };
  }

  /**
   * A patch written into a module's FILE in a proposal, and staged there as
   * code: the design tab's `create_patch` (valbuild/home `docs/design-tab.md`).
   * The assistant there changes the proposal's code, so content it writes goes
   * with that code -- a field it just added is filled in the same change, and
   * built and rendered with it -- rather than into the proposal's saves, which
   * the site's server does not write.
   *
   * Answered here, at `POST /<name>/patch-file`: the file is the proposal's
   * copy if it has one, otherwise the one this build was made from, and the
   * patch is written into it as a save writes one (`patchModuleText`). Who may
   * is who may stage files: {@link ValOpsHttp.mayWriteFiles}.
   */
  private async patchFileInProposal(
    name: string,
    body: string | undefined,
    profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const answer = (status: number, value: unknown) => ({
      status,
      contentType: json,
      body: JSON.stringify(value),
    });
    if (!this.mayWriteFiles({ name, write: "files" })) {
      return answer(403, {
        message:
          "Files are changed in the proposal this Studio is open in, not in another.",
      });
    }
    let parsedBody: unknown;
    try {
      parsedBody = body === undefined || body === "" ? {} : JSON.parse(body);
    } catch {
      return answer(400, { message: "The patch's body is not JSON." });
    }
    const request = PatchFileBody.safeParse(parsedBody);
    if (!request.success) {
      return answer(400, {
        message: `Invalid patch: ${fromError(request.error).toString()}`,
      });
    }
    const { moduleFilePath, patch, message } = request.data;
    const content = (suffix: string, init: RequestInit = {}) =>
      fetch(
        `${this.contentUrl}/v1/${this.project}/proposals/${name}${suffix}`,
        {
          ...init,
          headers: {
            ...this.authHeaders,
            ...(profileId !== null ? { "x-val-profile-id": profileId } : {}),
            ...(init.body === undefined ? {} : { "Content-Type": json }),
          },
        },
      );
    const read = await content("/files");
    if (!read.ok) {
      return {
        status: read.status,
        contentType: json,
        body: await read.text(),
      };
    }
    const files = ProposalFilesRead.safeParse(await read.json());
    if (!files.success) {
      return answer(502, {
        message: `Content answered the proposal's files in a shape this Val does not read: ${fromError(files.error).toString()}`,
      });
    }
    const filePath = moduleFilePath.replace(/^\/+/, "");
    const own = files.data.files[filePath];
    if (own === null) {
      return answer(409, {
        message: `${moduleFilePath} is deleted in this proposal.`,
      });
    }
    if (own === undefined && this.projectSource === null) {
      return answer(409, {
        message: `This build does not carry its source, so ${moduleFilePath} can only be patched once the proposal has its own copy: write it with write_files.`,
      });
    }
    const text = own ?? this.projectSource?.[filePath];
    if (text === undefined) {
      return answer(404, {
        message: `There is no module file ${moduleFilePath} in this proposal or on the site.`,
      });
    }
    const patched = await patchModuleText(text, patch);
    if (result.isErr(patched)) {
      return answer(422, {
        message: `The patch does not apply to ${moduleFilePath}: ${patched.error}`,
      });
    }
    let formatted = patched.value;
    if (this.options?.formatter) {
      try {
        formatted = await this.options.formatter(patched.value, moduleFilePath);
      } catch (error) {
        return answer(422, {
          message: `The patched ${moduleFilePath} could not be formatted: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    const staged = await content("/files", {
      method: "POST",
      body: JSON.stringify({
        files: { [filePath]: formatted },
        ...(message !== undefined ? { message } : {}),
      }),
    });
    return {
      status: staged.status,
      contentType: staged.headers.get("Content-Type") ?? json,
      body: await staged.text(),
    };
  }

  /**
   * Update from the site, for a proposal that changes only content
   * (valbuild/home `docs/hosted-publishing.md`, step 8.2, slice 1a): content
   * hands over the three versions of every module the proposal saved, this
   * server merges them under its own build's schemas -- the same on all
   * three sides, which is what "content only" means -- and content commits
   * the merge on the proposal's branch.
   *
   * Answered here rather than forwarded, at `POST /<name>/update-content`, and
   * only by the proposal's own server: the schemas it merges under are this
   * build's. A conflict comes back for a person to resolve, and the same call
   * with their `resolutions` merges.
   */
  private async updateContentFromSite(
    name: string,
    body: string | undefined,
    profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const answer = (status: number, value: unknown) => ({
      status,
      contentType: json,
      body: JSON.stringify(value),
    });
    if (this.proposal?.name !== name) {
      return answer(403, {
        message:
          "A proposal is updated from the site at its own address, where its build is.",
      });
    }
    let parsedBody: unknown;
    try {
      parsedBody = body === undefined || body === "" ? {} : JSON.parse(body);
    } catch {
      return answer(400, { message: "The update's body is not JSON." });
    }
    const request = UpdateContentBody.safeParse(parsedBody);
    if (!request.success) {
      return answer(400, {
        message: `Invalid update: ${fromError(request.error).toString()}`,
      });
    }
    const content = (path: string, init: RequestInit = {}) =>
      fetch(`${this.contentUrl}/v1/${this.project}/proposals/${name}${path}`, {
        ...init,
        headers: {
          ...this.authHeaders,
          ...(profileId !== null ? { "x-val-profile-id": profileId } : {}),
          ...(init.body === undefined ? {} : { "Content-Type": json }),
        },
      });
    const read = await content("/merge-inputs");
    if (!read.ok) {
      return {
        status: read.status,
        contentType: json,
        body: await read.text(),
      };
    }
    const inputs = MergeInputs.safeParse(await read.json());
    if (!inputs.success) {
      return answer(502, {
        message: `Content answered the merge's inputs in a shape this Val does not read: ${fromError(inputs.error).toString()}`,
      });
    }
    if (inputs.data.upToDate) return answer(200, { status: "up-to-date" });
    if (!inputs.data.contentOnly.ok || inputs.data.siteHead === null) {
      return answer(409, {
        status: "needs-build",
        message: inputs.data.contentOnly.ok
          ? "The site has no commit to update from."
          : inputs.data.contentOnly.reason,
      });
    }
    const modules: Parameters<typeof mergeContent>[0]["modules"] = {};
    const withoutText: ModuleFilePath[] = [];
    for (const [path, module] of Object.entries(inputs.data.modules)) {
      const moduleFilePath = path as ModuleFilePath;
      if (module.text === null) {
        withoutText.push(moduleFilePath);
        continue;
      }
      modules[moduleFilePath] = {
        base: module.base,
        site: module.site,
        proposal: module.proposal,
        text: module.text,
      };
    }
    // Decisions are about the values a person was shown. When the site or
    // the proposal moved since, they would settle values nobody saw, so the
    // merge is done again without them: what still conflicts is shown again.
    const { siteHead, proposalHead } = request.data;
    const decidedHere =
      siteHead === undefined ||
      (siteHead === inputs.data.siteHead &&
        proposalHead === inputs.data.proposalHead);
    const merged: ContentMergeResult =
      withoutText.length > 0
        ? { status: "needs-full-merge", modules: withoutText }
        : mergeContent({
            modules,
            schemas: await this.getSchemas(),
            resolutions: decidedHere ? request.data.resolutions : [],
          });
    if (merged.status === "conflicts") {
      return answer(200, {
        status: "conflicts",
        conflicts: merged.conflicts,
        siteHead: inputs.data.siteHead,
        proposalHead: inputs.data.proposalHead,
      });
    }
    if (merged.status === "needs-full-merge") {
      return answer(409, {
        status: "needs-full-merge",
        modules: merged.modules,
        message: `${merged.modules.join(", ")} changed both here and on the site in a way this version cannot merge yet.`,
      });
    }
    const written = await content("/merge-from-site", {
      method: "POST",
      body: JSON.stringify({
        siteHead: inputs.data.siteHead,
        proposalHead: inputs.data.proposalHead,
        files: merged.files,
        modules: merged.modules,
      }),
    });
    const text = await written.text();
    if (!written.ok) {
      return { status: written.status, contentType: json, body: text };
    }
    return updatedAnswer(text);
  }

  /**
   * Whether this server says what a merge of `name` moves: at the proposal's
   * own address, whose schemas are the ones it publishes; and on the site, for
   * Publish selected's proposal, which changes no code -- so the site's
   * schemas are its own -- and has no address to be published from.
   */
  private async answersMovesFor(
    name: string,
    profileId: string | null,
  ): Promise<boolean> {
    if (this.proposal !== null) return this.proposal.name === name;
    const read = await this.proposalContent(name, profileId)("");
    if (!read.ok) return false;
    const kind = ProposalKindAnswer.safeParse(
      await read.json().catch(() => null),
    );
    return kind.success && kind.data.proposal.kind === "publish";
  }

  /** Content's proposals API for one proposal, as the person asking. */
  private proposalContent(name: string, profileId: string | null) {
    return (path: string, init: RequestInit = {}) =>
      fetch(`${this.contentUrl}/v1/${this.project}/proposals/${name}${path}`, {
        ...init,
        headers: {
          ...this.authHeaders,
          ...(profileId !== null ? { "x-val-profile-id": profileId } : {}),
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
      });
  }

  /**
   * Which of the site's pending changes a merge of this proposal moves
   * (`movesAtMerge`), or `null` when content could not say what is pending:
   * then nothing is claimed, and the site's pending changes block the merge.
   */
  private async mergeMovesOf(
    name: string,
    profileId: string | null,
  ): Promise<
    | (MergeMoves & { authors: string[][]; save: string | null | undefined })
    | null
  > {
    const read = await this.proposalContent(name, profileId)("/move-inputs");
    if (!read.ok) return null;
    const inputs = MoveInputs.safeParse(await read.json().catch(() => null));
    if (!inputs.success) return null;
    return {
      ...movesAtMerge(inputs.data, await this.getSchemas()),
      save: inputs.data.save,
    };
  }

  /**
   * The merge checks, with `pending-on-site` answered by what the merge
   * moves rather than by whether anything is pending: the conflicting
   * changes move to a proposal of their own when it is published, and the
   * rest stay, so neither blocks it.
   */
  private async mergeChecksWithMoves(
    name: string,
    profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const read = await this.proposalContent(name, profileId)("/merge-checks");
    const text = await read.text();
    const answer = { status: read.status, contentType: json, body: text };
    if (!read.ok) return answer;
    const parsed = MergeChecksAnswer.safeParse(parseJsonOrNull(text));
    if (!parsed.success) return answer;
    const pending = parsed.data.checks.find(
      (check) => check.id === "pending-on-site",
    );
    if (pending === undefined || pending.ok) return answer;
    const moves = await this.mergeMovesOf(name, profileId);
    if (moves === null) return answer;
    const moving = moves.groups.flat().length;
    const names = [...new Set(moves.authors.flat())];
    const checks = parsed.data.checks.map((check) =>
      check.id !== "pending-on-site"
        ? check
        : {
            ...check,
            ok: true,
            blockers: [],
            message:
              moving === 0
                ? "Unpublished changes on these pages do not conflict with this proposal, and stay unpublished"
                : `${moving === 1 ? "1 unpublished change" : `${moving} unpublished changes`} by ${namesOf(names)} ${moving === 1 ? "conflicts" : "conflict"} with this proposal, and ${moving === 1 ? "moves" : "move"} to ${moves.groups.length === 1 ? "a new proposal" : "new proposals"} when it is published`,
            moves: moves.groups.map((group, at) => ({
              patchIds: group,
              authors: moves.authors[at] ?? [],
            })),
          },
    );
    const othersOk = parsed.data.checks.every(
      (check) => check.ok || check.id === "pending-on-site",
    );
    return {
      status: 200,
      contentType: json,
      body: JSON.stringify({
        ...parsed.data,
        checks,
        canMerge: parsed.data.canMerge || othersOk,
      }),
    };
  }

  /** Publish in a proposal, carrying the moves (`MergeBody.moves` in content). */
  private async pressMergeWithMoves(
    name: string,
    body: string | undefined,
    profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const content = this.proposalContent(name, profileId);
    const forward = async (sent: string | undefined) => {
      const res = await content("/merge", {
        method: "POST",
        ...(sent === undefined ? {} : { body: sent }),
      });
      return {
        status: res.status,
        contentType: res.headers.get("Content-Type") ?? json,
        body: await res.text(),
      };
    };
    let pressed: unknown;
    try {
      pressed = body === undefined || body === "" ? {} : JSON.parse(body);
    } catch {
      return forward(body);
    }
    if (typeof pressed !== "object" || pressed === null) return forward(body);
    const moves = await this.mergeMovesOf(name, profileId);
    if (moves === null) return forward(body);
    return forward(
      JSON.stringify({
        /*
         * The save the moves were worked out against is the one this press
         * publishes: named, so a change written after the press -- which the
         * Studio lets an editor make at once -- continues in a new proposal
         * rather than refusing it as unsaved.
         */
        ...(typeof moves.save === "string" ? { save: moves.save } : {}),
        ...pressed,
        moves: {
          siteHead: moves.siteHead,
          considered: moves.considered,
          groups: moves.groups,
        },
      }),
    );
  }

  /**
   * Update from the site, for a proposal with code (valbuild/home
   * `docs/hosted-publishing.md`, step 8.2, slice 1b), at
   * `POST /<name>/update-code`. The builder tab has read content's trees
   * (`GET /<name>/merge-trees`, forwarded) and evaluated them; this reads the
   * trees again -- the tab's evaluation is of the trees content has, or it is
   * of nothing -- and does the text (`updateWithCode`). The first call
   * answers the merge for the tab to evaluate; the second, with that
   * evaluation, commits it on the proposal's branch, staging its code.
   *
   * Only at the proposal's own address, as every write to its files is.
   */
  private async updateCodeFromSite(
    name: string,
    body: string | undefined,
    profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const answer = (status: number, value: unknown) => ({
      status,
      contentType: json,
      body: JSON.stringify(value),
    });
    if (this.proposal?.name !== name) {
      return answer(403, {
        message:
          "A proposal is updated from the site at its own address, where its files are written.",
      });
    }
    let parsedBody: unknown;
    try {
      parsedBody = body === undefined || body === "" ? {} : JSON.parse(body);
    } catch {
      return answer(400, { message: "The update's body is not JSON." });
    }
    const request = UpdateCodeBody.safeParse(parsedBody);
    if (!request.success) {
      return answer(400, {
        message: `Invalid update: ${fromError(request.error).toString()}`,
      });
    }
    const content = (path: string, init: RequestInit = {}) =>
      fetch(`${this.contentUrl}/v1/${this.project}/proposals/${name}${path}`, {
        ...init,
        headers: {
          ...this.authHeaders,
          ...(profileId !== null ? { "x-val-profile-id": profileId } : {}),
          ...(init.body === undefined ? {} : { "Content-Type": json }),
        },
      });
    const read = await content("/merge-trees");
    if (!read.ok) {
      return {
        status: read.status,
        contentType: json,
        body: await read.text(),
      };
    }
    const trees = MergeTrees.safeParse(await read.json());
    if (!trees.success) {
      return answer(502, {
        message: `Content answered the merge's trees in a shape this Val does not read: ${fromError(trees.error).toString()}`,
      });
    }
    const { siteHead, proposalHead, builds } = request.data;
    if (
      trees.data.siteHead !== siteHead ||
      trees.data.proposalHead !== proposalHead ||
      trees.data.builds.base !== builds.base ||
      trees.data.builds.site !== builds.site
    ) {
      return answer(409, {
        status: "moved",
        message:
          "The site or this proposal changed while this update was being made. Update from the site again.",
      });
    }
    if (trees.data.upToDate) return answer(200, { status: "up-to-date" });
    if (siteHead === null) {
      return answer(409, { message: "The site has no commit to update from." });
    }
    const merged = updateWithCode({
      trees: trees.data,
      evaluated: request.data.evaluated,
      resolutions: request.data.resolutions,
      ...(request.data.merged ? { merged: request.data.merged } : {}),
    });
    if (merged.status === "stale") {
      return answer(409, {
        status: "stale",
        message:
          "What was checked is not this update any more. Update from the site again.",
      });
    }
    if (merged.status !== "merged") return answer(200, merged);
    const written = await content("/merge-from-site", {
      method: "POST",
      body: JSON.stringify({
        siteHead,
        proposalHead,
        files: merged.files,
        modules: merged.modules,
        code: { build: builds.site, staged: merged.staged },
      }),
    });
    const text = await written.text();
    if (!written.ok) {
      return { status: written.status, contentType: json, body: text };
    }
    return updatedAnswer(text);
  }

  /**
   * A publish job's prepare, sent to content: the job's sources, archived
   * there before the job is built (valbuild/home, docs/app-mode.md, "The
   * archive, before the seal"). With this server's publish token, as every
   * publish call is, and never through `publishApi` -- see the allowlist.
   */
  async prepareJob(
    jobId: string,
    body: {
      tab: string;
      filesDirectory: string;
      patchedSourceFiles: Record<string, string | null>;
      patchedBinaryFilesDescriptors: PreparedCommit["patchedBinaryFilesDescriptors"];
      modules: PreparedCommit["moduleVersions"];
      /** Connected: the git commit this deployment was built from. */
      gitCommit?: string;
      /** Connected: the tab can build this job (the deployment embeds its source). */
      tabBuilds?: true;
      /** Connected, a build of no commit: its Val source. See `embeddedValSourceShas`. */
      deploymentFiles?: Record<string, string>;
    },
  ): Promise<{ status: number; body: string; contentType: string }> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: `'${jobId}' is not a job id.` }),
      };
    }
    return this.callPublishApi(`/publish-jobs/${jobId}/prepare`, {
      method: "POST",
      body: JSON.stringify({ ...body, root: this.root }),
    });
  }

  private async callPublishApi(
    path: string,
    init: { method: string; body?: string },
  ): Promise<{ status: number; body: string; contentType: string }> {
    const json = "application/json";
    const send = async (token: string) =>
      fetch(`${this.contentUrl}/v1${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { "Content-Type": json }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      });

    const credential = await this.currentPublishToken();
    if ("error" in credential) {
      return {
        status: credential.status,
        contentType: json,
        body: JSON.stringify({ message: credential.error }),
      };
    }

    let res = await send(credential.token);
    if (res.status === 401) {
      /*
       * Revoked, or expired sooner than it said. One retry with a fresh token,
       * because the alternative is a publish that fails for a reason the editor
       * cannot act on and a retry that fails the same way.
       */
      this.publishToken = null;
      const second = await this.currentPublishToken();
      if ("error" in second) {
        return {
          status: second.status,
          contentType: json,
          body: JSON.stringify({ message: second.error }),
        };
      }
      res = await send(second.token);
    }

    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? json,
      body: await res.text(),
    };
  }

  async onInit(): Promise<void> {
    // TODO: unused for now. Implement or remove
  }

  async getPresignedAuthNonce(
    profileId: string,
    corsOrigin: string,
  ): Promise<
    | {
        status: "success";
        data: { nonce: string; baseUrl: string };
      }
    | { status: "error"; statusCode: 401 | 500; error: GenericErrorMessage }
  > {
    try {
      const res = await fetch(
        `${this.contentUrl}/v1/${this.project}/presigned-auth-nonce`,
        {
          method: "POST",
          headers: {
            ...this.authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profileId,
            corsOrigin,
          }),
        },
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = z
          .object({
            nonce: z.string(),
            expiresAt: z.string(),
          })
          .safeParse(json);
        if (parsed.success) {
          const { nonce } = parsed.data;
          return {
            status: "success" as const,
            data: { nonce, baseUrl: `${this.contentUrl}/v1/${this.project}` },
          };
        } else {
          Internal.log.error(
            "Could not parse presigned auth nonce response. Error: " +
              fromError(parsed.error),
          );
          return {
            status: "error" as const,
            statusCode: 500,
            error: {
              message:
                "Could not get presigned auth nonce. The response that Val got from the server was not in the expected format. You might be running on an old version, or it might be a transient error or a configuration issue. Please try again later.",
            },
          };
        }
      }
      if (res.status === 401) {
        return {
          statusCode: 401,
          status: "error",
          error: {
            message:
              "Could not get presigned auth nonce. Although your user is authorized, the application has authorization issues. Contact the developers on your team and ask them to verify the api keys.",
          },
        };
      }
      const unknownErrorMessage = `Could not get presigned auth nonce. HTTP error: ${res.status} ${res.statusText}`;
      if (res.headers.get("Content-Type")?.includes("application/json")) {
        const json = await res.json();
        const message = getErrorMessageFromUnknownJson(
          json,
          unknownErrorMessage,
        );
        Internal.log.error("Presigned auth nonce error:", message);
        return {
          status: "error",
          statusCode: 500,
          error: { message },
        };
      }
      Internal.log.error(unknownErrorMessage);
      return {
        status: "error",
        statusCode: 500,
        error: { message: unknownErrorMessage },
      };
    } catch (e) {
      Internal.log.error(
        "Could not get presigned auth nonce (connection error?):",
        e,
      );
      return {
        status: "error",
        statusCode: 500,
        error: {
          message: `Could not get presigned auth nonce. Error: ${
            e instanceof Error ? e.message : JSON.stringify(e)
          }`,
        },
      };
    }
  }

  async getStat(
    params: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      patches?: PatchId[];
      profileId?: AuthorId;
    } | null,
  ): Promise<
    | {
        type: "request-again" | "no-change";
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        sourcesSha: SourcesSha;
        patches: PatchId[];
      }
    | {
        type: "use-websocket";
        url: string;
        nonce: string;
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        sourcesSha: SourcesSha;
        /** Absent for a project with no repository. See `git` on ValApiOptions. */
        commitSha?: CommitSha;
        commits: ValCommit[];
        deployments: ValDeployment[];
        patches: PatchId[];
        /** Of `patches`, the ones that have shipped. See the implementation. */
        appliedPatches: PatchId[];
        /** Of `patches`, the ones a running publish holds. See {@link OrderedPatches.publishingPatches}. */
        publishingPatches?: PatchId[];
        /** Of `patches`, the ones a failed publish holds back. See {@link OrderedPatches.heldBackPatches}. */
        heldBackPatches?: PatchId[];
        /** The head of the chain. See {@link OrderedPatchesMetadata.headPatchId}. */
        headPatchId?: PatchId | null;
        /** The chain version of that head. See {@link OrderedPatchesMetadata.headVersion}. */
        headVersion?: number;
        /** The newest commit, which is the publish head. */
        headCommitSha?: string;
      }
    | {
        type: "error";
        error: GenericErrorMessage;
        unauthorized?: boolean;
        networkError?: boolean;
      }
  > {
    if (!params?.profileId) {
      return { type: "error", error: { message: "No profileId provided" } };
    }
    const currentBaseSha = await this.getBaseSha();
    const currentSchemaSha = await this.getSchemaSha();
    const currentSourcesSha = await this.getSourcesSha();
    const allPatchData = await this.fetchPatches({
      excludePatchOps: true,
      patchIds: undefined,
    });
    if (
      "error" in allPatchData &&
      allPatchData.error &&
      allPatchData.unauthorized
    ) {
      return { type: "error", error: allPatchData.error, unauthorized: true };
    }
    if (
      "error" in allPatchData &&
      allPatchData.error &&
      allPatchData.networkError
    ) {
      return { type: "error", error: allPatchData.error, networkError: true };
    }
    // We think these errors will be picked up else where (?), so we only return an error here if there are no patches
    if (allPatchData.patches.length === 0) {
      let message;
      if (allPatchData.error) {
        message = allPatchData.error.message;
      } else if (allPatchData.errors && allPatchData.errors.length > 0) {
        const errors = allPatchData.errors;
        message = errors.map((error) => error.message).join("");
      }
      if (message) {
        message = `Could not get patches: ${message}`;
        Internal.log.error(message);
        return {
          type: "error",
          error: { message },
        };
      }
    }
    const patches: PatchId[] = [];
    /*
     * Which of them have SHIPPED, alongside which of them exist.
     *
     * A published patch stays in the chain with `appliedAt` set until the next
     * deployment moves the base, so "in the chain" and "has shipped" are
     * different questions — and the chain ids alone answer only the first. A
     * client that already holds a record never re-fetches it, so it never
     * learns the second: another author's publish left that patch in your scope
     * as pending, your prefix gate read a hole in front of it, and Publish
     * refused for a reason that had stopped being true.
     *
     * Sent as ids rather than folded into `patches`, so a client that ignores
     * it behaves exactly as before.
     */
    const appliedPatches: PatchId[] = [];
    for (const patchData of allPatchData.patches) {
      patches.push(patchData.patchId);
      if (patchData.appliedAt) {
        appliedPatches.push(patchData.patchId);
      }
    }
    const webSocketNonceRes = await this.getWebSocketNonce(params.profileId);
    if (webSocketNonceRes.status === "error") {
      return { type: "error", error: webSocketNonceRes.error };
    }
    const { nonce, url } = webSocketNonceRes.data;
    return {
      type: "use-websocket",
      url,
      nonce,
      baseSha: currentBaseSha,
      schemaSha: currentSchemaSha,
      sourcesSha: currentSourcesSha,
      commits: allPatchData.commits || [],
      deployments: allPatchData.deployments || [],
      patches,
      appliedPatches,
      /*
       * Absent, not empty, from a content service that does not say: an empty
       * list would claim no publish is running when it cannot know.
       */
      ...(allPatchData.publishingPatches !== undefined
        ? { publishingPatches: allPatchData.publishingPatches }
        : {}),
      // Absent from a content service that does not say, as above.
      ...(allPatchData.heldBackPatches !== undefined
        ? { heldBackPatches: allPatchData.heldBackPatches }
        : {}),
      /*
       * The CHAIN head, not the publish head below. Spread: absent is a content
       * service that does not report it, which is not the same as `null`.
       */
      ...(allPatchData.headPatchId !== undefined
        ? { headPatchId: allPatchData.headPatchId }
        : {}),
      ...(allPatchData.headVersion !== undefined
        ? { headVersion: allPatchData.headVersion }
        : {}),
      /*
       * The PUBLISH head, which is not `commitSha`.
       *
       * `commitSha` is the commit this deployment is serving and does not move
       * when somebody publishes — only when the new build lands. This does, so
       * it is what a client carries back to `/save` to say which world it
       * decided against.
       */
      headCommitSha: newestCommitSha(allPatchData.commits) ?? undefined,
      /*
       * Spread: a project with no repository has no such commit, and saying
       * so by leaving the key out is different from sending an empty string
       * the Studio would try to show.
       */
      ...(this.git ? { commitSha: this.git.commit as CommitSha } : {}),
    };
  }

  /**
   * Where this server sits in the content service's chain, as every request
   * that asks about a position says it.
   *
   * In a proposal: its branch, and the save its snapshot is (none before the
   * first). The content service then answers with what came after that save
   * and nothing else -- never the site's position, which would replay the
   * proposal's own saves over a snapshot that already holds them. Otherwise
   * the commit this build was made from, or, for a build a tab made, its job.
   */
  private position(): { branch?: string; commit?: string; job?: string } {
    if (this.proposal !== null) {
      return {
        branch: this.proposal.branch,
        ...(this.proposal.commit !== null
          ? { commit: this.proposal.commit }
          : {}),
      };
    }
    /*
     * A content version sits where the publish that made it does: its job,
     * which content places exactly, or its commit, once nothing else says.
     */
    if (this.contentVersion !== null) {
      if (this.contentVersion.job !== null) {
        return { job: this.contentVersion.job };
      }
      if (this.contentVersion.commit !== null) {
        return { commit: this.contentVersion.commit };
      }
    }
    if (this.git) {
      return { branch: this.git.branch, commit: this.git.commit };
    }
    return this.publishJob !== null ? { job: this.publishJob } : {};
  }

  /** The branch this server's patches are on, where it knows it. */
  private ownBranch(): string | undefined {
    return this.proposal?.branch ?? this.git?.branch;
  }

  async getWebSocketNonce(profileId: string): Promise<
    | {
        status: "success";
        data: { nonce: string; url: string };
      }
    | { status: "error"; error: GenericErrorMessage }
  > {
    return fetch(`${this.contentUrl}/v1/${this.project}/websocket/nonces`, {
      method: "POST",
      body: JSON.stringify({
        profileId,
        /*
         * Omitted when there is no repository, like every other request here.
         * The content service knows this project's branch -- it is a column on
         * the project -- and a nonce is scoped to the project and the person,
         * not to a position in a chain.
         */
        ...(() => {
          const { branch, commit, job } = this.position();
          return {
            ...(branch !== undefined ? { branch } : {}),
            ...(commit !== undefined ? { commitSha: commit } : {}),
            ...(job !== undefined ? { job } : {}),
          };
        })(),
        // Which build is asking, beside what it says about itself.
        ...(this.publishBuild !== null ? { build: this.publishBuild } : {}),
      }),
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
    })
      .then(async (res) => {
        if (res.ok) {
          const json = NonceResponse.safeParse(await res.json());
          if (!json.success) {
            return {
              status: "error" as const,
              error: {
                message:
                  "Invalid nonce response: " + fromError(json.error).toString(),
              },
            };
          }
          if (
            !json.data.url.startsWith("ws://") &&
            !json.data.url.startsWith("wss://")
          ) {
            return {
              status: "error" as const,
              error: {
                message: "Invalid websocket url: " + json.data.url,
              },
            };
          }
          return {
            status: "success" as const,
            data: { nonce: json.data.nonce, url: json.data.url },
          };
        }
        const contentType = res.headers.get("Content-Type") || "";
        if (contentType.startsWith("application/json")) {
          const json = await res.json();
          const message = getErrorMessageFromUnknownJson(
            json,
            "Could not get nonce. Unexpected error (no error message). Status: " +
              res.status,
          );
          return {
            status: "error" as const,
            error: {
              message: "Could not get nonce. " + message,
            },
          };
        }
        return {
          status: "error" as const,
          error: {
            message:
              "Could not get nonce. HTTP error: " +
              res.status +
              " " +
              res.statusText,
          },
        };
      })
      .catch((e) => {
        Internal.log.error(
          "Could not get nonce (connection error?):",
          e instanceof Error ? e.message : e.toString(),
        );
        return {
          status: "error" as const,
          error: {
            message:
              "Could not get nonce. Error: " +
              (e instanceof Error ? e.message : e.toString()),
          },
        };
      });
  }

  override async fetchPatches<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  > {
    // Split patchIds into chunks to avoid too long query strings
    // NOTE: fetching patches results are cached, so this should reduce the pressure on the server
    const chunkSize = 100;
    const patchIds = filters.patchIds || [];
    const patchIdChunks = [];
    for (let i = 0; i < patchIds.length; i += chunkSize) {
      patchIdChunks.push(patchIds.slice(i, i + chunkSize));
    }
    const allPatches: OrderedPatches["patches"] = [];
    const allErrors: OrderedPatches["errors"] = [];
    /*
     * The commits, which are a fact about the whole BRANCH, not about a chunk.
     *
     * This loop used to return only `patches` and `errors`, so a filtered fetch
     * silently answered with no commits at all. That is not cosmetic:
     * the publish-head guard in `ValServer` reads `newestCommitSha(commits)`,
     * got `undefined` for every publish (a publish always names patch ids, so
     * it always takes this branch), and skipped the check entirely. Two clients
     * could publish against the same head with neither told.
     *
     * Taken from the first chunk that carries them, which is sound for the
     * reason the dedupe below exists: each chunk's response describes the whole
     * chain regardless of which ids it asked about.
     *
     * `deployments` is not carried, because it is declared only on
     * `OrderedPatchesMetadata` and this is generic over both shapes. Nothing
     * reads it from a filtered fetch today; if something starts to, it needs
     * the same treatment and a home on `OrderedPatches` first.
     */
    let commits: OrderedPatches["commits"];
    // A fact about the branch too, so taken from the first chunk that has it
    // for the same reason `commits` is.
    let headPatchId: OrderedPatches["headPatchId"];
    let headVersion: OrderedPatches["headVersion"];
    if (patchIds === undefined || patchIds.length === 0) {
      return this.fetchPatchesInternal({
        patchIds: patchIds,
        excludePatchOps: filters.excludePatchOps,
      });
    }
    for (const res of await Promise.all(
      patchIdChunks.map((patchIdChunk) =>
        this.fetchPatchesInternal({
          patchIds: patchIdChunk,
          excludePatchOps: filters.excludePatchOps,
        }),
      ),
    )) {
      if ("error" in res) {
        return res;
      }
      allPatches.push(...(res.patches as OrderedPatches["patches"]));
      if (res.errors) {
        allErrors.push(...res.errors);
      }
      if (commits === undefined && res.commits !== undefined) {
        commits = res.commits;
      }
      /*
       * The NEWEST head among the chunks: each is its own request, so a later
       * one can have seen a write an earlier one did not. Taken with its own
       * version, so the two always describe one read. Without versions (an
       * older content service) the first head stands, as before.
       */
      if (
        res.headPatchId !== undefined &&
        (headPatchId === undefined ||
          (res.headVersion !== undefined &&
            (headVersion === undefined || res.headVersion > headVersion)))
      ) {
        headPatchId = res.headPatchId;
        headVersion = res.headVersion;
      }
    }
    // Chunking is a query-string-length workaround, NOT a filter: the content
    // api returns every applicable patch per request regardless of which
    // patch_ids we ask for. Concatenating the chunks therefore repeats the
    // whole chain once per chunk, and prepare() applies each patch that many
    // times - which corrupts arrays (a "remove" runs N times) and fails the
    // commit with "Array index out of bounds". Only bites above chunkSize
    // pending patches, so it stays invisible until a project accumulates them.
    //
    // Dedupe by patch id, keeping first occurrence so the api's ordering is
    // preserved, and keep only what was asked for. Correct whether or not the
    // api filters on its side.
    const requestedPatchIds = new Set<string>(patchIds);
    const seenPatchIds = new Set<string>();
    const patches = allPatches.filter((patch) => {
      if (!requestedPatchIds.has(patch.patchId)) {
        return false;
      }
      if (seenPatchIds.has(patch.patchId)) {
        return false;
      }
      seenPatchIds.add(patch.patchId);
      return true;
    });
    return {
      patches,
      errors: Object.keys(allErrors).length > 0 ? allErrors : undefined,
      // Spread rather than set to `undefined`, so a caller that distinguishes
      // "absent" from "empty" — `newestCommitSha` does not, but the annotation
      // readers do — sees the same shape the unchunked path gives it.
      ...(commits !== undefined ? { commits } : {}),
      ...(headPatchId !== undefined ? { headPatchId } : {}),
      ...(headVersion !== undefined ? { headVersion } : {}),
    } as ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches;
  }

  async fetchPatchesInternal<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  > {
    const params: [string, string][] = [];
    /*
     * A position in the chain, WHEN THIS BUILD HAS ONE.
     *
     * `commit` tells the content service where this deployment sits, so it can
     * answer with the commits at or after that point. A build with no
     * repository has no such commit baked into it, and asking the service to
     * resolve the position itself is strictly better than inventing one: it
     * holds the chain, and for a project it is the only publisher of, the
     * position IS the head.
     */
    // A build a tab made has no commit, and says which job it was made for;
    // a proposal says its branch and its save. See `position`.
    for (const [key, value] of Object.entries(this.position())) {
      if (value !== undefined) params.push([key, value]);
    }
    /*
     * And WHICH build this is, when the platform running it says: the only
     * thing that places a build the edge still serves after a publish, which
     * the service would otherwise take to be the new one. Sent with the commit
     * or the job, which still say where a build is that the service has no
     * publish of.
     */
    if (this.publishBuild !== null) {
      params.push(["build", this.publishBuild]);
    }
    if (filters.patchIds) {
      for (const patchId of filters.patchIds) {
        params.push(["patch_id", patchId]);
      }
    }
    if (filters.excludePatchOps) {
      params.push(["exclude_patch_ops", "true"]);
    }
    const searchParams = new URLSearchParams(params);
    try {
      const patchesRes = await fetch(
        `${this.contentUrl}/v1/${this.project}/applicable/patches${
          searchParams.size > 0 ? `?${searchParams.toString()}` : ""
        }`,
        {
          headers: this.authHeaders,
        },
      );
      const patches: {
        path: ModuleFilePath;
        patchId: PatchId;
        patch?: Patch;
        baseSha: BaseSha;
        createdAt: string;
        authorId: AuthorId | null;
        appliedAt: {
          commitSha: CommitSha;
        } | null;
      }[] = [];
      if (patchesRes.ok) {
        const json = await patchesRes.json();
        const parsed = GetApplicablePatches.safeParse(json);
        if (parsed.success) {
          const errors: (ExcludePatchOps extends true
            ? OrderedPatchesMetadata
            : OrderedPatches)["errors"] = [];
          const data = parsed.data;
          /*
           * What the project expects of its publisher, remembered.
           *
           * Recorded here rather than returned because every caller of this
           * already has what it needs and only the publish path asks the
           * question -- and that path calls this first. See
           * {@link publishRefusal}.
           */
          if (data.project) {
            this.projectExpectation = data.project;
          }
          for (const patchesRes of data.patches) {
            patches.push({
              authorId: patchesRes.authorId as AuthorId,
              createdAt: patchesRes.createdAt,
              patchId: patchesRes.patchId as PatchId,
              path: patchesRes.path as ModuleFilePath,
              baseSha: patchesRes.baseSha as BaseSha,
              patch: patchesRes.patch as Patch,
              appliedAt: patchesRes.applied?.commitSha
                ? {
                    commitSha: patchesRes.applied.commitSha as CommitSha,
                  }
                : null,
            });
          }
          const commits: OrderedPatchesMetadata["commits"] = [];
          if (data.commits) {
            for (const commit of data.commits) {
              commits.push({
                commitSha: commit.commitSha as CommitSha,
                clientCommitSha: commit.clientCommitSha as CommitSha | null,
                parentCommitSha: commit.parentCommitSha as CommitSha | null,
                branch: commit.branch,
                creator: commit.creator as AuthorId,
                createdAt: commit.createdAt,
                commitMessage: commit.commitMessage,
              });
            }
          }
          const deployments: OrderedPatchesMetadata["deployments"] = [];
          if (data.deployments) {
            for (const deployment of data.deployments) {
              deployments.push({
                commitSha: deployment.commitSha as CommitSha,
                deploymentId: deployment.deploymentId,
                deploymentState: deployment.deploymentState,
                createdAt: deployment.createdAt,
                updatedAt: deployment.updatedAt,
                commitMessage: deployment.commitMessage,
              });
            }
          }
          return {
            commits,
            deployments,
            patches,
            errors,
            ...(data.headPatchId !== undefined
              ? { headPatchId: data.headPatchId }
              : {}),
            ...(data.headVersion !== undefined
              ? { headVersion: data.headVersion }
              : {}),
            ...(data.headCommitSha !== undefined
              ? { headCommitSha: data.headCommitSha }
              : {}),
            ...(data.publishingPatches !== undefined
              ? { publishingPatches: data.publishingPatches }
              : {}),
            ...(data.heldBackPatches !== undefined
              ? { heldBackPatches: data.heldBackPatches }
              : {}),
          } as ExcludePatchOps extends true
            ? OrderedPatchesMetadata
            : OrderedPatches;
        }
        Internal.log.error(
          "Could not parse patches response. Error: " + fromError(parsed.error),
        );
        return {
          patches,
          error: {
            message: `The response that Val got from the server was not in the expected format. This might be a transient error or a configuration issue. Please try again later.`,
          },
        } as ExcludePatchOps extends true
          ? OrderedPatchesMetadata
          : OrderedPatches;
      }
      Internal.log.error(
        "Could not get patches. HTTP error: " +
          patchesRes.status +
          " " +
          patchesRes.statusText,
      );
      if (patchesRes.status === 401) {
        return {
          patches,
          error: {
            message:
              "Although your user is authorized, the application has authorization issues. Contact the developers on your team and ask them to verify the api keys.",
          },
        } as ExcludePatchOps extends true
          ? OrderedPatchesMetadata
          : OrderedPatches;
      }
      return {
        patches,
        error: {
          message:
            "Could not get your changes. It is most likely due to a network issue. Check your network connection and please try again.",
        },
      } as ExcludePatchOps extends true
        ? OrderedPatchesMetadata
        : OrderedPatches;
    } catch (err) {
      Internal.log.error(
        "Could not get patches (connection error):",
        err instanceof Error ? err.message : JSON.stringify(err),
      );
      return {
        patches: [],
        networkError: true,
        error: {
          message: `Error: ${
            err instanceof Error ? err.message : JSON.stringify(err)
          }`,
        },
      };
    }
  }

  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: PatchT,
    patchId: PatchId,
    parentRef: ParentRefT,
    authorId: AuthorId | null,
    sessionId: string | null,
  ): Promise<SaveSourceFilePatchResult> {
    const baseSha = await this.getBaseSha();
    return fetch(`${this.contentUrl}/v1/${this.project}/patches`, {
      method: "POST",
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
        patch,
        authorId,
        sessionId,
        patchId,
        parentPatchId: parentRef.type === "patch" ? parentRef.patchId : null,
        baseSha,
        /*
         * In a proposal, its branch alone: the content service files the
         * patch there, and only for an open proposal.
         */
        ...(this.proposal !== null
          ? { branch: this.proposal.branch }
          : this.git
            ? { commit: this.git.commit, branch: this.git.branch }
            : {}),
        coreVersion: Internal.VERSION.core,
      }),
    })
      .then(async (res): Promise<SaveSourceFilePatchResult> => {
        if (res.ok) {
          const parsed = SavePatchResponse.safeParse(await res.json());
          if (parsed.success) {
            return result.ok({
              patchId: parsed.data.patchId,
              ...(parsed.data.headVersion !== undefined
                ? { headVersion: parsed.data.headVersion }
                : {}),
            });
          }
          return result.err({
            errorType: "other",
            message: `Could not parse save patch response. Error: ${fromError(
              parsed.error,
            )}`,
          });
        }
        if (res.status === 409) {
          return result.err({
            errorType: "patch-head-conflict",
            message: "Conflict: " + (await res.text()),
          });
        }
        if (res.headers.get("Content-Type")?.includes("application/json")) {
          const json = await res.json();
          const message = getErrorMessageFromUnknownJson(json, "Unknown error");
          /*
           * Refused for the plan: the patch is fine, and the reason comes as
           * data. Kept apart from every other error, which the Studio is told
           * is a bad patch and drops. A 403 without a refusal in it (a
           * credential missing the write scope) is still one of those.
           */
          const refusal =
            res.status === 403 ? PlanRefusedBody.safeParse(json) : null;
          if (refusal?.success) {
            return result.err({
              errorType: "plan-refused",
              error: { message },
              refusal: refusal.data.error,
            });
          }
          return result.err({
            errorType: "other",
            message,
          });
        }
        return result.err({
          errorType: "other",
          message:
            "Could not save patch. HTTP error: " +
            res.status +
            " " +
            res.statusText,
        });
      })
      .catch((e): SaveSourceFilePatchResult => {
        return result.err({
          errorType: "other",
          message: `Could save source file patch (connection error?): ${
            e instanceof Error ? e.message : e.toString()
          }`,
        });
      });
  }

  /**
   * @deprecated For HTTP ops use direct upload instead (i.e. client should upload the files directly) since hosting platforms (Vercel) might have low limits on the size of the request body.
   */
  override async saveBase64EncodedBinaryFileFromPatch(
    filePathOrRef: string,
    parentRef: ParentRef,
    patchId: PatchId,
    data: string | null,
    type: BinaryFileType,
    metadata: MetadataOfType<BinaryFileType> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    const filePath: string = filePathOrRef;

    return fetch(
      `${this.contentUrl}/v1/${this.project}/patches/${patchId}/files`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath,
          parentRef, // Not currently used
          data,
          type,
          metadata,
        }),
      },
    )
      .then(
        async (
          res,
        ): Promise<
          WithGenericError<{ patchId: PatchId; filePath: string }>
        > => {
          if (res.ok) {
            const parsed = SavePatchFileResponse.safeParse(await res.json());
            if (parsed.success) {
              return {
                patchId: parsed.data.patchId,
                filePath: parsed.data.filePath,
              };
            }
            return {
              error: {
                message: `Could not parse save patch file response. Error: ${fromError(
                  parsed.error,
                )}`,
              },
            };
          }
          return {
            error: {
              message:
                "Could not save patch file. HTTP error: " +
                res.status +
                " " +
                res.statusText,
            },
          };
        },
      )
      .catch((e): WithGenericError<{ patchId: PatchId; filePath: string }> => {
        return {
          error: {
            message: `Could save source binary file in patch (connection error?): ${e.toString()}`,
          },
        };
      });
  }

  private async getHttpFiles(
    files: (
      | {
          filePath: string;
          location: "patch";
          patchId: PatchId;
          remote: boolean;
        }
      | {
          filePath: string;
          location: "repo";
          root: string;
          commitSha: CommitSha;
        }
    )[],
  ): Promise<
    WithGenericError<{
      files: (
        | {
            value: string;
            filePath: string;
            location: "patch";
            patchId: PatchId;
            remote: boolean;
          }
        | {
            value: string;
            filePath: string;
            location: "repo";
            commitSha: CommitSha;
          }
      )[];
      errors?: (
        | {
            message: string;
            filePath: string;
            location: "patch";
            patchId: PatchId;
            remote: boolean;
          }
        | {
            message: string;
            filePath: string;
            location: "repo";
            commitSha: CommitSha;
          }
      )[];
    }>
  > {
    const params = new URLSearchParams();
    const stringifiedFiles = JSON.stringify({ files, root: this.root });
    params.set(
      "body_sha", // We use this for cache invalidation
      Internal.getSHA256Hash(textEncoder.encode(stringifiedFiles)),
    );
    return fetch(`${this.contentUrl}/v1/${this.project}/files?${params}`, {
      method: "PUT", // Yes, PUT is weird. Weirder to have a body in a GET request.
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
      body: stringifiedFiles,
    })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          // TODO: Check that all requested paths are in the response
          const parsedFileResponse = FilesResponse.safeParse(json);
          if (parsedFileResponse.success) {
            return parsedFileResponse.data;
          }
          return {
            error: {
              message: `Could not parse file response. Error: ${fromError(
                parsedFileResponse.error,
              )}`,
            },
          };
        }
        return {
          error: {
            message:
              "Could not get files. HTTP error: " +
              res.status +
              " " +
              res.statusText,
          },
        };
      })
      .catch((e) => {
        return {
          error: {
            message: `Could not get file (connection error?): ${
              e instanceof Error ? e.message : e.toString()
            }`,
          },
        };
      });
  }

  protected override async getSourceFile(
    path: string,
  ): Promise<WithGenericError<{ data: string }>> {
    if (this.projectSource !== null) {
      const text = this.projectSource[path.replace(/^\/+/, "")];
      if (text === undefined) {
        return {
          error: {
            message: `Cannot read the source of ${path}: it is not in the source this build was made from.`,
          },
        };
      }
      return { data: text };
    }
    /*
     * There is no file to read without a repository to read it from.
     *
     * Reachable only through the CLI's debug snapshot now: the publish path
     * does not call this for such a project at all -- see
     * {@link ValOps.mirrorsSourceFiles} -- because there is nothing for it to
     * produce. It is an error rather than an empty string because an empty
     * `.val.ts` would be patched successfully and committed as a module that
     * had lost all its content.
     */
    if (!this.git) {
      return {
        error: {
          message:
            `Cannot read the source of ${path}: this project has no ` +
            "repository, so there is no `.val.ts` to read. Its content lives " +
            "in Val's content service, which is the store of record for it.",
        },
      };
    }
    const filesRes = await this.getHttpFiles([
      {
        filePath: path,
        location: "repo",
        root: this.root,
        commitSha: this.git.commit as CommitSha,
      },
    ]);
    if (filesRes.error) {
      return filesRes;
    }
    const file = filesRes.files.find((f) => f.filePath === path);
    if (!file) {
      return {
        error: {
          message: `Could not find file ${path} in response`,
        },
      };
    }
    return { data: Buffer.from(file.value, "base64").toString("utf-8") };
  }

  override async getBinaryFile(filePath: string): Promise<Buffer | null> {
    // We could also just get this from public/ on the running server. Current approach feels more clean, but will be slower / puts more server load... We might want to change this
    const requestFiles: (
      | {
          filePath: string;
          location: "patch";
          patchId: PatchId;
          remote: boolean;
        }
      | {
          filePath: string;
          location: "repo";
          root: string;
          commitSha: CommitSha;
        }
    )[] = [];

    if (!this.git) {
      /*
       * A published binary lives in the repository, and there is none.
       *
       * `null` is this method's existing "not found", which is what a caller
       * already handles: the Studio falls back to the patch's own copy, which
       * is where a managed project's files stay. See the note on local files
       * in the content service's commit handler.
       */
      return null;
    }
    requestFiles.push({
      filePath: filePath,
      location: "repo",
      root: this.root,
      commitSha: this.git.commit as CommitSha,
    });
    const filesRes = await this.getHttpFiles(requestFiles);
    if (filesRes.error) {
      return null;
    }
    const file = filesRes.files[0];
    if (filesRes.files.length > 1) {
      Internal.log.error("Expected 1 file, got more:", filesRes.files);
    }
    if (!file) {
      return null;
    }
    return Buffer.from(file.value, "base64");
  }

  override async getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
    remote: boolean,
  ): Promise<Buffer | null> {
    const filesRes = await this.getHttpFiles([
      {
        filePath: filePath,
        location: "patch",
        patchId,
        remote,
      },
    ]);
    if (filesRes.error) {
      Internal.log.error("Error getting file:", filePath, filesRes.error);
      return null;
    }
    if (filesRes.errors) {
      Internal.log.error(
        "Failed while retrieving files",
        filePath,
        filesRes.errors,
      );
    }
    const file = filesRes.files[0];
    if (filesRes.files.length > 1) {
      Internal.log.error("Expected 1 file, got more:", filesRes.files);
    }
    if (!file) {
      return null;
    }
    // Plain base64, the same as the `repo` branch of getBinaryFile above.
    //
    // `value` used to be a data: URL here and plain base64 there - two
    // encodings in one field, told apart only by which branch produced them.
    // The content service answers base64 for both now.
    return Buffer.from(file.value, "base64");
  }

  protected override async getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image",
  >(
    filePath: string,
    type: T,
    patchId: PatchId,
    remote: boolean,
  ): Promise<OpsMetadata<T>> {
    const params = new URLSearchParams();
    params.set("file_path", filePath);
    params.set("remote", remote.toString());
    try {
      const metadataRes = await fetch(
        `${this.contentUrl}/v1/${this.project}/patches/${patchId}/files?${params}`,
        {
          headers: { ...this.authHeaders, "Content-Type": "application/json" },
        },
      );
      if (metadataRes.ok) {
        const json = await metadataRes.json();
        const parsed = MetadataRes.safeParse(json);
        if (parsed.success) {
          return {
            metadata: parsed.data.metadata,
          } as OpsMetadata<T>;
        }
        return {
          errors: [
            {
              message: `Could not parse metadata response. Error: ${fromError(
                parsed.error,
              )}`,
              filePath,
            },
          ],
        };
      }
      return {
        errors: [
          {
            message:
              "Could not get metadata. HTTP error: " +
              metadataRes.status +
              " " +
              metadataRes.statusText,
            filePath,
          },
        ],
      };
    } catch (err) {
      return {
        errors: [
          {
            message:
              "Could not get metadata (connection error?): " +
              (err instanceof Error
                ? err.message
                : err?.toString() || "unknown error"),
          },
        ],
      };
    }
  }

  protected override async getBinaryFileMetadata<T extends "file" | "image">(
    filePath: string,
    type: T,
  ): Promise<OpsMetadata<T>> {
    // TODO: call get metadata on this instance which caches + returns the metadata for this filepath / commit
    // something like this:
    // const params = new URLSearchParams();
    // params.set("path", filePath);
    // params.set("type", type);
    // return fetch(new URL(`${this.route}/files/metadata?${params}`, baseUrl)).then(
    //   (res) => {
    //     return res.json();
    //   }
    // );
    return {
      errors: [
        {
          message: "Not implemented: " + type,
          filePath,
        },
      ],
    };
  }

  override async deletePatches(patchIds: PatchId[]): Promise<
    | {
        deleted: PatchId[];
        errors?: undefined;
        error?: undefined;
        headVersion?: number;
      }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
        headVersion?: number;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  > {
    return fetch(`${this.contentUrl}/v1/${this.project}/patches`, {
      method: "DELETE",
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patchIds }),
    })
      .then(async (res) => {
        if (res.ok) {
          const parsed = DeletePatchesResponse.safeParse(await res.json());
          if (parsed.success) {
            const errors: Record<PatchId, GenericErrorMessage> = {};
            for (const err of parsed.data.errors || []) {
              errors[err.patchId] = err;
            }
            const headVersion = ownBranchVersion(
              parsed.data.headVersions,
              this.ownBranch(),
            );
            const version = headVersion !== undefined ? { headVersion } : {};

            if (Object.keys(errors).length === 0) {
              return {
                deleted: parsed.data.deleted,
                ...version,
              };
            }
            return {
              deleted: parsed.data.deleted,
              errors,
              ...version,
            };
          }
          return {
            error: {
              message: `Could not parse delete patches response. Error: ${fromError(
                parsed.error,
              )}`,
            },
          };
        }
        return {
          error: {
            message:
              "Could not delete patches. HTTP error: " +
              res.status +
              " " +
              res.statusText,
          },
        };
      })
      .catch((e) => {
        return {
          error: {
            message: `Could not delete patches (connection error?): ${
              e instanceof Error ? e.message : e.toString()
            }`,
          },
        };
      });
  }

  async commit(
    prepared: PreparedCommit,
    message: string,
    committer: AuthorId,
    filesDirectory: string,
    newBranch?: string,
    /**
     * A save into this proposal rather than this server's own branch: the
     * site's server saving Publish selected's proposal (`/publish-selected`),
     * which has no address of its own to save from.
     */
    intoProposal?: string,
  ): Promise<
    | {
        isNotFastForward?: boolean;
        updatedFiles: string[];
        commit: CommitSha;
        /** See `CommitResult.parent`: absent means not reported. */
        parent?: string;
        /** See `CommitResult.tree`: absent means not reported. */
        tree?: string;
        branch: string;
        /** The chain version the publish moved the branch to, where reported. */
        headVersion?: number;
        error?: undefined;
      }
    | {
        isNotFastForward?: boolean;
        error: GenericErrorMessage;
      }
  > {
    try {
      /*
       * A save in a proposal is a commit on the proposal's branch, at its own
       * route: the site's `/commit` refuses a proposal's patches, which is
       * the line that keeps them off the site until a merge.
       */
      const proposalName = intoProposal ?? this.proposal?.name;
      const commitUrl =
        proposalName !== undefined
          ? `${this.contentUrl}/v1/${this.project}/proposals/${proposalName}/save`
          : `${this.contentUrl}/v1/${this.project}/commit`;
      const res = await fetch(commitUrl, {
        method: "POST",
        headers: {
          ...this.authHeaders,
          /*
           * WHO is publishing: `this.authHeaders` is the app's API key, which
           * names the PROJECT and not the person. The content API reads it as
           * an identity claim beside the app's key and derives no scope from
           * it; `committer` in the body says the same.
           */
          "x-val-profile-id": committer,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patchedSourceFiles: prepared.patchedSourceFiles,
          patchedBinaryFilesDescriptors: prepared.patchedBinaryFilesDescriptors,
          appliedPatches: prepared.appliedPatches,
          /*
           * What each changed module IS after this commit, as DATA, with the
           * schema it is under.
           *
           * The half git cannot give back. Git keeps the `.val.ts`, but that is
           * code: turning it back into data means parsing it, which is
           * best-effort and rots across TypeScript, runtime and Val versions -
           * so a commit that reads today can quietly stop reading later. And
           * git has no copy at all of the SCHEMA a commit was written under,
           * which is what showing a module as it was needs once the schema has
           * moved on.
           */
          modules: prepared.moduleVersions,
          /*
           * WHERE THIS BUILD THOUGHT IT WAS -- and only for a project with a
           * repository, which is the only thing that still reads it.
           *
           * The content service mints its own commit shas, so this is no
           * longer the parent, and it never was the concurrency check: that is
           * `expectedHeadCommitSha` against `newestCommitSha(patches.commits)`,
           * which `/save` runs before it gets here. What is left is the git
           * fast-forward check, which needs to know the commit this build read
           * the branch at to tell whether the branch has moved under it.
           *
           * The branch goes with it. The project's branch is a column on the
           * project, so a build asserting one could only ever disagree with
           * the project it is publishing to.
           */
          ...(this.git ? { commit: this.git.commit } : {}),
          root: this.root,
          filesDirectory,
          baseSha: await this.getBaseSha(),
          committer,
          message,
          newBranch,
        }),
      });
      if (res.ok) {
        const parsed = CommitResponse.safeParse(await res.json());
        if (parsed.success) {
          return {
            updatedFiles: parsed.data.updatedFiles,
            commit: parsed.data.commit,
            branch: parsed.data.branch,
            /*
             * Spread rather than set, so a service that did not report them
             * leaves the keys ABSENT rather than present-and-undefined. A
             * caller doing `'parent' in result` then gets the truthful answer,
             * and JSON round-trips of this object do not grow null fields.
             */
            ...(parsed.data.parent !== undefined
              ? { parent: parsed.data.parent }
              : {}),
            ...(parsed.data.tree !== undefined
              ? { tree: parsed.data.tree }
              : {}),
            ...(parsed.data.headVersion !== undefined
              ? { headVersion: parsed.data.headVersion }
              : {}),
          };
        }
        return {
          error: {
            message: `Could not parse commit response. Error: ${fromError(
              parsed.error,
            )}`,
          },
        };
      }
      if (res.headers.get("Content-Type")?.includes("application/json")) {
        const json = z
          .object({ isNotFastForward: z.boolean().optional() })
          .safeParse(await res.json());
        if (json.success && json.data.isNotFastForward) {
          return {
            isNotFastForward: true,
            error: {
              message: "Could not commit. Not a fast-forward commit",
            },
          };
        }
        const message = getErrorMessageFromUnknownJson(json, "Unknown error");
        return {
          error: {
            message,
          },
        };
      }
      return {
        error: {
          message:
            "Could not commit. HTTP error: " +
            res.status +
            " " +
            res.statusText,
        },
      };
    } catch (err) {
      return {
        error: {
          message: `Could not commit (connection error?): ${
            err instanceof Error
              ? err.message
              : err?.toString() || "unknown error"
          }`,
        },
      };
    }
  }

  // #region history

  /**
   * One GET against the content service, parsed and Result-typed.
   *
   * Every history read has the same three failure modes - could not reach the
   * service, the commit is not there, the answer was not what was expected -
   * and each of them means something different to a caller deciding whether to
   * offer a restore. Doing it once here is what keeps that consistent across
   * the five endpoints.
   */
  private async getHistory<T>(
    path: string,
    schema: z.ZodType<T>,
    commitShaForErrors: string,
  ): Promise<result.Result<T, HistoryError>> {
    let res: Response;
    try {
      res = await fetch(`${this.contentUrl}/v1/${this.project}${path}`, {
        headers: { ...this.authHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return result.err({
        kind: "transport",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (res.status === 404) {
      return result.err({
        kind: "commit-not-found",
        commitSha: commitShaForErrors,
      });
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      if (res.headers.get("Content-Type")?.includes("application/json")) {
        message = getErrorMessageFromUnknownJson(await res.json(), message);
      }
      // A 5xx from the service reading a record it says it has is a real
      // failure of that record, not a network problem - keep them apart.
      return result.err({
        kind: "archive-unreadable",
        commitSha: commitShaForErrors,
        message,
      });
    }
    // A 200 is not a promise of JSON: a proxy or gateway in front of the
    // service answers HTML, and an unguarded `.json()` would reject straight
    // out of this Result-typed API and 500 the route.
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      return result.err({
        kind: "archive-unreadable",
        commitSha: commitShaForErrors,
        message: `response was not JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return result.err({
        kind: "archive-unreadable",
        commitSha: commitShaForErrors,
        message: `unexpected response shape: ${fromError(parsed.error)}`,
      });
    }
    return result.ok(parsed.data);
  }

  override async listCommits(
    branch: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<result.Result<CommitPage, HistoryError>> {
    const params = new URLSearchParams({ branch });
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options?.cursor !== undefined) {
      params.set("cursor", options.cursor);
    }
    const res = await this.getHistory(
      `/commits?${params}`,
      ListCommitsResponse,
      branch,
    );
    if (result.isErr(res)) {
      return res;
    }
    return result.ok({
      commits: res.value.commits,
      nextCursor: res.value.nextCursor,
    });
  }

  override async getCommitPatches(
    commitSha: string,
  ): Promise<
    result.Result<
      { commit: HistoricalCommit; patches: CommitPatch[] },
      HistoryError
    >
  > {
    // One request. The endpoint returns the commit's own summary alongside its
    // patches, because it already has the row - this used to page the commit
    // LISTING until the sha turned up, which cost up to twenty requests to open
    // an old commit and could not find one on another branch at all.
    const patchesRes = await this.getHistory(
      `/commits/${commitSha}/patches`,
      CommitPatchesResponse,
      commitSha,
    );
    if (result.isErr(patchesRes)) {
      return patchesRes;
    }
    return result.ok({
      commit: {
        ...patchesRes.value.commit,
        patchCount: patchesRes.value.patches.length,
      },
      patches: patchesRes.value.patches.map((patch) => ({
        patchId: patch.patchId as PatchId,
        moduleFilePath: patch.path as ModuleFilePath,
        patch: patch.patch,
        authorId: patch.authorId,
        createdAt: patch.createdAt,
        baseSha: patch.baseSha,
        coreVersion: patch.coreVersion,
      })),
    });
  }

  override async getCommitModules(
    commitSha: string,
    options?: { asOf?: boolean; moduleFilePath?: ModuleFilePath },
  ): Promise<
    result.Result<
      { modules: StoredModuleVersion[]; complete: boolean },
      HistoryError
    >
  > {
    const query = new URLSearchParams();
    if (options?.asOf) {
      query.set("as_of", "1");
    }
    if (options?.moduleFilePath) {
      query.set("path", options.moduleFilePath);
    }
    const search = query.toString();
    const res = await this.getHistory(
      `/commits/${commitSha}/modules${search ? `?${search}` : ""}`,
      CommitModulesResponse,
      commitSha,
    );
    if (result.isErr(res)) {
      return res;
    }
    return result.ok({
      modules: res.value.modules.map((module) => ({
        ...module,
        moduleFilePath: module.moduleFilePath as ModuleFilePath,
      })),
      // Absent from an older content server, which only ever answered "what
      // this commit changed" - and that answer is always whole.
      complete: res.value.complete ?? !options?.asOf,
    });
  }

  override async getCommitAffectedFiles(
    commitSha: string,
  ): Promise<result.Result<AffectedFile[], HistoryError>> {
    const res = await this.getHistory(
      `/commits/${commitSha}/affected-files`,
      CommitAffectedFilesResponse,
      commitSha,
    );
    if (result.isErr(res)) {
      return res;
    }
    return result.ok(res.value.files);
  }

  /**
   * `root` in front, and never a doubled or missing slash.
   *
   * `root` is "" for a project at the repository root and something like
   * `examples/next` otherwise; a ModuleFilePath always starts with "/". Joining
   * them by hand at each call site is how one of these ends up with "//" in the
   * middle, which GitHub answers with a 404 that reads like a missing file.
   */
  override gitPathOfModule(
    moduleFilePath: ModuleFilePath,
  ): result.Result<string, HistoryError> {
    const joined = `${this.root}/${moduleFilePath}`
      .split("/")
      .filter((part) => part !== "")
      .join("/");
    return result.ok(joined);
  }

  override async getFileAtCommit(
    commitSha: string,
    filePath: string,
    remote: boolean,
  ): Promise<result.Result<Buffer, HistoryError>> {
    const params = new URLSearchParams({ path: filePath });
    if (remote) {
      params.set("remote", "true");
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.contentUrl}/v1/${this.project}/commits/${commitSha}/file?${params}`,
        { headers: { ...this.authHeaders } },
      );
    } catch (err) {
      return result.err({
        kind: "transport",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (!res.ok) {
      // A missing file is about the FILE, not the commit: the commit may be
      // perfectly readable and this one blob gone. Saying "commit not found"
      // here would send a caller looking in the wrong place.
      return result.err({
        kind: "file-unavailable",
        gitPath: filePath,
        message: `${res.status} ${res.statusText}`,
      });
    }
    return result.ok(Buffer.from(await res.arrayBuffer()));
  }
  // #endregion history
}

/**
 * Content's answer to a merge it committed, as the Studio is answered: what
 * content says, marked updated. Content has written the merge by then, so an
 * answer that cannot be read says so rather than failing as though nothing
 * happened.
 */
function updatedAnswer(text: string): {
  status: number;
  body: string;
  contentType: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          "The proposal was updated from the site, but content's answer could not be read. Reload to see the proposal as it is now.",
      }),
    };
  }
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "updated", ...parsed }),
  };
}

/** What the Studio sends to update a proposal from the site: its decisions. */
const UpdateContentBody = z.object({
  /**
   * Where the site and the proposal were when the conflicts the
   * `resolutions` decide were found: the conflicts answer says. Absent with
   * no decisions.
   */
  siteHead: z.string().nullable().optional(),
  proposalHead: z.string().nullable().optional(),
  resolutions: z
    .array(
      z.union([
        z.object({
          moduleFilePath: z.string().transform((p) => p as ModuleFilePath),
          path: z.array(z.string()),
          keep: z.enum(["site", "proposal"]),
        }),
        z.object({
          moduleFilePath: z.string().transform((p) => p as ModuleFilePath),
          path: z.array(z.string()),
          value: JSONValueSchema,
        }),
      ]),
    )
    .default([]),
});

/** A module, as the builder tab's evaluation of its tree gave it. */
const EvaluatedModules = z.record(
  z.string().transform((p) => p as ModuleFilePath),
  z.object({
    schema: SerializedSchemaSchema,
    written: JSONValueSchema,
    errors: z.array(
      z.object({ path: z.array(z.string()), message: z.string() }),
    ),
  }),
);

/** What the builder tab sends to update a proposal with code from the site. */
const UpdateCodeBody = z.object({
  siteHead: z.string().nullable(),
  proposalHead: z.string().nullable(),
  builds: z.object({ base: z.string(), site: z.string() }),
  evaluated: z.object({
    base: EvaluatedModules,
    site: EvaluatedModules,
    proposal: EvaluatedModules,
  }),
  resolutions: z
    .array(
      z.union([
        z.object({
          moduleFilePath: z.string().transform((p) => p as ModuleFilePath),
          path: z.array(z.string()),
          keep: z.enum(["site", "proposal"]),
        }),
        z.object({
          moduleFilePath: z.string().transform((p) => p as ModuleFilePath),
          path: z.array(z.string()),
          value: JSONValueSchema,
        }),
        z.object({ file: z.string(), keep: z.enum(["site", "proposal"]) }),
        z.object({ file: z.string(), text: z.string() }),
      ]),
    )
    .default([]),
  /** The tab's evaluation of the merge the first call answered. */
  merged: z.object({ id: z.string(), evaluated: EvaluatedModules }).optional(),
});

/** Content's `GET /proposals/:name/move-inputs`. */
/** The one thing `answersMovesFor` reads from content's `GET /proposals/:name`. */
const ProposalKindAnswer = z.object({
  proposal: z.object({ kind: z.string() }),
});
/** Content's `GET /proposals/:name/merge-checks`, as far as it is changed here. */
const MergeChecksAnswer = z
  .object({
    checks: z.array(
      z.object({ id: z.string(), ok: z.boolean() }).passthrough(),
    ),
    canMerge: z.boolean(),
  })
  .passthrough();

/** "Kari", "Kari and Bo", "Kari, Bo and 2 more". */
function namesOf(names: string[]): string {
  return names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** Content's `GET /proposals/:name/merge-trees`. */
const MergeTrees = z.object({
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

/** Content's `GET /proposals/:name/merge-inputs`. */
const MergeInputs = z.object({
  base: z.string().nullable(),
  siteHead: z.string().nullable(),
  proposalHead: z.string().nullable(),
  upToDate: z.boolean(),
  contentOnly: z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), reason: z.string() }),
  ]),
  modules: z.record(
    z.string(),
    z.object({
      base: JSONValueSchema.nullable(),
      site: JSONValueSchema.nullable(),
      proposal: JSONValueSchema.nullable(),
      text: z.string().nullable(),
    }),
  ),
});

/** `JSON.parse`, or `null` for a body that is not JSON: an answer passed on as it came. */
function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
