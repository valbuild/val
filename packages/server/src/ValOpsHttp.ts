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
  type PatchGroupMembership,
  SchemaSha,
  OrderedPatchesMetadata,
  OrderedPatches,
  SourcesSha,
  type PublishRefusal,
} from "./ValOps";
import { z } from "zod";
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
  PatchGroup,
  type PatchGroupT,
  JSONValue as JSONValueSchema,
} from "@valbuild/shared/internal";
import { result } from "@valbuild/core/fp";
import {
  getErrorMessageFromUnknownJson,
  newestCommitSha,
} from "@valbuild/shared/internal";

const textEncoder = new TextEncoder();

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
   * Which group the content API put this patch in.
   *
   * Optional: a content API that predates patch groups does not send one, and
   * absence has to keep meaning "no groups here" rather than failing the save.
   */
  patchGroupId: z.string().optional(),
});
const DeletePatchesResponse = z.object({
  deleted: z.array(PatchId),
  errors: z
    .array(
      z.object({
        message: z.string(),
        patchId: PatchId,
      }),
    )
    .optional(),
});
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
  parentCommitSha: z.string(),
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

/*
 * The shared schema, not a copy of it.
 *
 * This re-declared `PatchGroup` field for field while the file already imported
 * `PatchGroupT` from the same module — so a field added on one side and not the
 * other would have `getPatchGroups()` return a `PatchGroupT[]` silently missing
 * it, with no type error anywhere.
 */
const PatchGroupsResponse = z.object({
  patchGroups: z.array(PatchGroup),
});

const PatchGroupMutationResponse = z.object({
  patchGroupId: z.string(),
  patchIds: z.array(PatchId),
});
export type PatchGroupMutationResult =
  | { patchIds: PatchId[]; status?: undefined; error?: undefined }
  | {
      patchIds: PatchId[];
      status: 403 | 409 | 500;
      error: GenericErrorMessage;
    };
const NonceResponse = z.object({
  nonce: z.string(),
  url: z.string(),
});

/**
 * How long a patch-group lookup is reused. See `ValOpsHttp.patchGroupsCache`.
 *
 * Sized to cover one server render, not to be a cache: several `fetchVal` calls
 * in one request share an answer, and the next request asks again.
 */
const PATCH_GROUPS_CACHE_MS = 1000;

export class ValOpsHttp extends ValOps {
  private readonly authHeaders:
    | { Authorization: string }
    | { "x-val-pat": string };
  private readonly root: string;
  /** Val's content service owns the store. See {@link ValOps.patchesAreLocal}. */
  override readonly patchesAreLocal = false;
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

  /** Did the host hand over the running build's source? See `projectSource`. */
  embedsSource(): boolean {
    return this.projectSource !== null;
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
    },
  ) {
    super(valModules, options);
    this.authHeaders =
      "pat" in auth
        ? { "x-val-pat": auth.pat }
        : { Authorization: `Bearer ${auth.apiKey}` };
    this.root = options?.root ?? "";
    this.projectSource = options?.projectSource ?? null;
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
    if (this.git !== null) {
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
    return this.projectExpectation?.sourceMode ?? null;
  }

  /** Remembered with {@link sourceMode}, from the same response. */
  override projectBranch(): string | null {
    return this.projectExpectation?.branch ?? null;
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
   * The content paths this may reach, and nothing else.
   *
   * An allow list rather than a prefix check, because this method holds a
   * credential and the browser chooses the path. `/publish/{id}` and its three
   * steps are the publish conversation; `/build-target` is what a build needs
   * to know before it starts; `/project-source` is what it builds.
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
    if (
      path === "/build-target" ||
      path === "/project-source" ||
      path === "/publish"
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
    const json = "application/json";
    if (!ValOpsHttp.publishApiPathAllowed(path)) {
      return {
        status: 403,
        contentType: json,
        body: JSON.stringify({
          message: `'${path}' is not part of the publish API.`,
        }),
      };
    }

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
          console.error(
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
        console.error("Presigned auth nonce error:", message);
        return {
          status: "error",
          statusCode: 500,
          error: { message },
        };
      }
      console.error(unknownErrorMessage);
      return {
        status: "error",
        statusCode: 500,
        error: { message: unknownErrorMessage },
      };
    } catch (e) {
      console.error(
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
        console.error(message);
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
        ...(this.git
          ? { branch: this.git.branch, commitSha: this.git.commit }
          : {}),
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
        console.error(
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
    if (this.git) {
      params.push(["branch", this.git.branch]);
      params.push(["commit", this.git.commit]);
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
          } as ExcludePatchOps extends true
            ? OrderedPatchesMetadata
            : OrderedPatches;
        }
        console.error(
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
      console.error(
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
      console.error(
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

  // #region patch groups
  /**
   * Add patches to a patch group.
   *
   * The set arrives closed by the client — `withPatchIds` is the prefix closure
   * over the patch sets the staged patches belong to. We forward it and do not
   * second-guess it: deriving the closure needs the content schema, which this
   * process does have but content.val.build does not, and having two
   * implementations of the rule would be worse than having one.
   *
   * Membership rows are stamped with `coreVersion` on the content side — the
   * same stamp the patch row carries — so which client wrote a row stays
   * legible after the fact.
   */
  async stagePatches(
    patchGroupId: string,
    /** What the user asked to stage. */
    patchIds: PatchId[],
    /**
     * What has to come with it, because the staged patches are written on top
     * of it.
     *
     * The content API stores each membership row as `explicit` or `dependency`
     * and treats what it is not told about as a dependency. Folding the two
     * halves into `patchIds` therefore files the patch somebody clicked as one
     * the closure dragged in — the exact opposite of what happened, and the
     * only record anywhere of what the author chose.
     */
    withPatchIds: PatchId[],
    /**
     * WHO is asking, so the content API can refuse a group that is not theirs.
     *
     * Every call from this class carries the app's API key, which says which
     * PROJECT is calling and nothing about which editor. Without this the
     * content API cannot tell one of a project's editors from another, so the
     * only check on stage and unstage is the one in `ValServer` — and anything
     * reaching the content API by another route (an API key, a PAT) has none at
     * all.
     *
     * `null` where there is no session. The content API refuses rather than
     * treating that as a match: a group written by an api key has a null author
     * too, and `null === null` must not read as ownership.
     */
    authorId: AuthorId | null,
  ): Promise<PatchGroupMutationResult> {
    return this.mutatePatchGroup(
      "POST",
      // Encoded: patchGroupId arrives in a request body, so an unencoded value
      // like "../../commit" would reach a different endpoint carrying this
      // project's auth headers.
      `patch-groups/${encodeURIComponent(patchGroupId)}/patches`,
      {
        patchIds,
        withPatchIds,
        coreVersion: Internal.VERSION.core,
      },
      authorId,
    );
  }

  /**
   * Remove patches from a patch group.
   *
   * The set arrives closed FORWARDS by the client: unstaging a patch also
   * unstages everything built on top of it within its patch sets, and that is
   * what `withPatchIds` carries.
   */
  async unstagePatches(
    patchGroupId: string,
    /** What the user asked to unstage. */
    patchIds: PatchId[],
    /** What has to go with it: everything built on top of it. */
    withPatchIds: PatchId[],
    /** See {@link stagePatches} — the content API's half of the ownership check. */
    authorId: AuthorId | null,
  ): Promise<PatchGroupMutationResult> {
    return this.mutatePatchGroup(
      "DELETE",
      `patch-groups/${encodeURIComponent(patchGroupId)}/patches`,
      { patchIds, withPatchIds },
      authorId,
    );
  }

  /**
   * Every patch group on this branch, with what each holds.
   *
   * Read rather than mutated, and used to answer "which pending patches is THIS
   * person allowed to see". A draft render that skips this shows base + every
   * pending patch on the branch, including work other people have not
   * published — which is what independent publish exists to prevent.
   *
   * A failure is an empty list rather than a throw, and the caller decides what
   * that means. For a draft render the honest fallback is "show nothing
   * pending" rather than "show everything": being shown your own committed
   * content when the group lookup is down is a worse experience than being
   * shown somebody else's unpublished draft is a bug.
   */
  /**
   * The last group lookup, and when it was made.
   *
   * A draft render calls `getPatchGroups` once per `fetchVal`, in series with
   * the whole-chain fetch, and a page that calls `fetchVal` several times pays
   * the round trip several times. Groups are per branch and change rarely, so a
   * short window removes the multiplier without letting a stage go unseen for
   * meaningfully longer than one render.
   *
   * Deliberately short. This is a read whose staleness decides whose draft
   * content someone sees, so it is a per-request de-duplication rather than a
   * cache: a second render a second later asks again.
   */
  private patchGroupsCache: {
    at: number;
    res:
      | { status: "ok"; patchGroups: PatchGroupT[] }
      | { status: "unsupported" };
  } | null = null;

  async getPatchGroups(options?: {
    /**
     * Ask the content API even if a recent answer is remembered.
     *
     * For the checks that DECIDE something rather than render something.
     * `refuseUnlessOwn` reads this list to say whether a group is yours, and a
     * group is at its youngest exactly when that matters: the first write
     * creates it, the save response names it, and the shell flushes its queued
     * stages immediately — well inside the cache window. Served from a list
     * fetched before the group existed, every one of those was refused 403 and
     * dropped, so the queue that exists to survive the post-publish window
     * persisted nothing in the flow it was built for.
     *
     * Not solved by shortening the window: the cache sits on this instance,
     * which outlives the request, so "recent" is recent for the whole server
     * and not for one render.
     */
    fresh?: boolean;
  }): Promise<
    | { status: "ok"; patchGroups: PatchGroupT[] }
    | { status: "unsupported" }
    | { status: "error"; message: string }
  > {
    const now = Date.now();
    if (
      options?.fresh !== true &&
      this.patchGroupsCache !== null &&
      now - this.patchGroupsCache.at < PATCH_GROUPS_CACHE_MS
    ) {
      return this.patchGroupsCache.res;
    }
    const res = await this.fetchPatchGroups();
    /*
     * ANSWERS are cached; failures are not.
     *
     * A transient failure held for a second is replayed to every caller in it,
     * and the callers are not equivalent: `refuseUnlessOwn` turns it into a 500
     * that refuses the stage, a scoped draft render falls back to base and
     * drops every pending patch on the page, and `GET /patches` omits the
     * annotation. One flaky request became a second of all three. The point of
     * this cache is to collapse the several `fetchVal` calls in one render into
     * one round trip, and an error is exactly the case worth retrying inside
     * that window rather than the case worth remembering.
     *
     * `unsupported` is cached with `ok` deliberately: it is a real answer about
     * the deployment — this content API predates patch groups — and it will not
     * change between two renders.
     */
    if (res.status === "ok" || res.status === "unsupported") {
      this.patchGroupsCache = { at: now, res };
    }
    return res;
  }

  private async fetchPatchGroups(): Promise<
    | { status: "ok"; patchGroups: PatchGroupT[] }
    | { status: "unsupported" }
    | { status: "error"; message: string }
  > {
    try {
      /*
       * `branch` is REQUIRED by the endpoint, which answers 400 without it.
       *
       * Same two params every other read here sends (`fetchPatchesInternal`,
       * `saveSourceFilePatch`): groups are per branch, so a request without one
       * is not merely under-specified, it is rejected.
       */
      const params = new URLSearchParams(
        this.git ? [["branch", this.git.branch]] : [],
      );
      const res = await fetch(
        `${this.contentUrl}/v1/${this.project}/patch-groups?${params}`,
        { headers: this.authHeaders },
      );
      if (res.status === 404) {
        /*
         * The endpoint is not there, which is a content API that PREDATES patch
         * groups — not a failure.
         *
         * The distinction decides what a draft render shows, and collapsing it
         * into "error" is not a small mistake: a caller that reads an error as
         * "could not ask" renders BASE, so every existing http deployment would
         * silently drop all pending content from every draft preview. "There
         * are no groups here" has to mean unscoped, which is exactly the
         * behaviour those projects have today.
         */
        return { status: "unsupported" };
      }
      if (!res.ok) {
        return {
          status: "error",
          message:
            res.status === 401
              ? "Could not read patch groups: unauthorized. Verify that the val api keys are correct."
              : `Could not read patch groups. HTTP error: ${res.status} ${res.statusText}`,
        };
      }
      const parsed = PatchGroupsResponse.safeParse(await res.json());
      if (!parsed.success) {
        return {
          status: "error",
          message: `Could not parse patch groups response. Error: ${fromError(
            parsed.error,
          )}`,
        };
      }
      return { status: "ok", patchGroups: parsed.data.patchGroups };
    } catch (err) {
      return {
        status: "error",
        message: `Could not read patch groups. Error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  private async mutatePatchGroup(
    method: "POST" | "DELETE",
    path: string,
    body: Record<string, unknown>,
    /**
     * WHO is asking. Sent as `x-val-profile-id`, which is what the content API
     * reads to decide whether this group is the caller's.
     *
     * `this.authHeaders` is the app's API key, and that names the PROJECT, not
     * the person — so without this the content API cannot resolve a profile
     * and refuses every stage and unstage with
     * "Cannot resolve the caller's profile". The group endpoints are the only
     * ones here that need it, because they are the only ones whose answer
     * depends on which of a project's editors is calling.
     *
     * Omitted when there is no session rather than sent empty: the content API
     * treats an unidentified caller as a refusal, which is what we want, and an
     * empty header would be a different and less obvious way to say it.
     *
     * A PAT already identifies a person, so `authHeaders` carries the identity
     * on its own there and this adds nothing.
     */
    authorId: AuthorId | null,
  ): Promise<PatchGroupMutationResult> {
    try {
      const res = await fetch(`${this.contentUrl}/v1/${this.project}/${path}`, {
        method,
        headers: {
          ...this.authHeaders,
          ...(authorId !== null ? { "x-val-profile-id": authorId } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const parsed = PatchGroupMutationResponse.safeParse(await res.json());
        if (parsed.success) {
          return { patchIds: parsed.data.patchIds };
        }
        return {
          status: 500,
          patchIds: [],
          error: {
            message: `Could not parse patch group response. Error: ${fromError(
              parsed.error,
            )}`,
          },
        };
      }
      // 403 (not your group) and 409 (already published) are meaningful to the
      // client, so they are passed through rather than flattened to a 500.
      if (res.status === 403 || res.status === 409) {
        // `home` answers these with a JSON body, so `res.text()` put the literal
        // `{"message":"..."}` in front of the user. Every other branch in this
        // class unwraps it; this one now does too.
        return {
          status: res.status,
          patchIds: [],
          error: {
            message: getErrorMessageFromUnknownJson(
              await res.json().catch(() => undefined),
              `Could not update patch group. HTTP error: ${res.status} ${res.statusText}`,
            ),
          },
        };
      }
      // A 401 here is the app's own credentials failing, not the user's, so it gets
      // the same wording as every other call in this class rather than an opaque
      // 500 that sends the user looking at their own session.
      if (res.status === 401) {
        return {
          status: 500,
          patchIds: [],
          error: {
            message:
              "Although your user is authorized, the application has authorization issues. Contact the developers on your team and ask them to verify the api keys.",
          },
        };
      }
      return {
        status: 500,
        patchIds: [],
        error: {
          message: `Could not update patch group. HTTP error: ${res.status} ${res.statusText}`,
        },
      };
    } catch (err) {
      return {
        status: 500,
        patchIds: [],
        error: {
          message: `Could not update patch group (connection error?): ${
            err instanceof Error ? err.message : JSON.stringify(err)
          }`,
        },
      };
    }
  }
  // #endregion

  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: PatchT,
    patchId: PatchId,
    parentRef: ParentRefT,
    authorId: AuthorId | null,
    sessionId: string | null,
    patchGroup?: PatchGroupMembership,
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
        ...(this.git
          ? { commit: this.git.commit, branch: this.git.branch }
          : {}),
        coreVersion: Internal.VERSION.core,
        /*
         * Group membership in the SAME request as the patch.
         *
         * The content API runs every refusal before its insert, so an invalid
         * closure is a 400 with nothing written. Spread rather than sent as
         * nulls: a client with no group omits the fields entirely, which is
         * what an older content API expects to see.
         */
        ...(patchGroup
          ? {
              // Only when the caller named one. Omitted, the content API
              // resolves this author's open group and creates it if absent,
              // which is what every write wants.
              ...(patchGroup.patchGroupId !== undefined
                ? { patchGroupId: patchGroup.patchGroupId }
                : {}),
              withPatchIds: patchGroup.withPatchIds,
            }
          : {}),
      }),
    })
      .then(async (res): Promise<SaveSourceFilePatchResult> => {
        if (res.ok) {
          const parsed = SavePatchResponse.safeParse(await res.json());
          if (parsed.success) {
            return result.ok({
              patchId: parsed.data.patchId,
              /*
               * Passed back to the client, which cannot learn it any other way.
               *
               * A write names no group — the content API resolves this author's
               * open group and CREATES it if absent — so on a fresh branch the
               * group comes into existence here and nowhere else. The chain
               * annotation is only re-read when a fetch has missing ids to ask
               * for, and a patch this client made is never missing, so without
               * this the tab that bootstrapped the group would never learn its
               * id and every stage would be a no-op.
               */
              ...(parsed.data.patchGroupId !== undefined
                ? { patchGroupId: parsed.data.patchGroupId }
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
      console.error("Expected 1 file, got more:", filesRes.files);
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
      console.error("Error getting file:", filePath, filesRes.error);
      return null;
    }
    if (filesRes.errors) {
      console.error("Failed while retrieving files", filePath, filesRes.errors);
    }
    const file = filesRes.files[0];
    if (filesRes.files.length > 1) {
      console.error("Expected 1 file, got more:", filesRes.files);
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

  override async deletePatches(
    patchIds: PatchId[],
    /**
     * Patches that are NOT deleted but must lose their group membership.
     *
     * Deleting a patch out of the middle of a patch set leaves every group
     * still holding the rest with a non-prefix intersection — the patches after
     * the hole were written against a view that had it. The content API cannot
     * work out which those are (it has no schema), so the client sends the
     * forward closure and it drops those memberships without deleting anything.
     */
    unstagePatchIds?: PatchId[],
  ): Promise<
    | { deleted: PatchId[]; errors?: undefined; error?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  > {
    return fetch(`${this.contentUrl}/v1/${this.project}/patches`, {
      method: "DELETE",
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        patchIds,
        ...(unstagePatchIds !== undefined && unstagePatchIds.length > 0
          ? { unstagePatchIds }
          : {}),
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const parsed = DeletePatchesResponse.safeParse(await res.json());
          if (parsed.success) {
            const errors: Record<PatchId, GenericErrorMessage> = {};
            for (const err of parsed.data.errors || []) {
              errors[err.patchId] = err;
            }

            if (Object.keys(errors).length === 0) {
              return {
                deleted: parsed.data.deleted,
              };
            }
            return {
              deleted: parsed.data.deleted,
              errors,
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
     * The patch group this commit EMPTIES, if it empties one.
     *
     * The content API closes the group it is given — and closes it WITHOUT
     * checking that the commit shipped all of it, so a caller that names a
     * group still holding work takes those patches out of every group and
     * leaves their author unable to publish them. The client therefore sends it
     * only when the publish accounts for everything the group still holds.
     *
     * Omitting it is not neutral: the commit still empties the group (the
     * content API drops applied ids from every group), but `published_at` is
     * never set, so the id is reused across publishes instead of a new group
     * per publish and the "already published" refusal can never fire.
     */
    patchGroupId?: string,
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
        error?: undefined;
      }
    | {
        isNotFastForward?: boolean;
        error: GenericErrorMessage;
      }
  > {
    try {
      const res = await fetch(`${this.contentUrl}/v1/${this.project}/commit`, {
        method: "POST",
        headers: {
          ...this.authHeaders,
          /*
           * WHO is publishing — the same `x-val-profile-id` stage and unstage
           * send, and for the same reason: `this.authHeaders` is the app's API
           * key, which names the PROJECT and not the person.
           *
           * Closing a group is an ownership decision, so the content API
           * refuses a commit that names a `patchGroupId` it cannot attribute:
           * without this header `profileId` is `undefined` there and every
           * group-closing publish is 403 "Cannot resolve the caller's profile".
           * That is the NORMAL full publish, not an edge — `publish` names the
           * group whenever the commit empties it.
           *
           * Sent on every commit rather than only when a group is named. The
           * committer is a person either way, `committer` in the body already
           * says so, and a header that appears only on some commits is one more
           * conditional for a reader of either repo to reconstruct. It changes
           * nothing else: the content API reads it as an identity claim beside
           * the app's key and derives no scope from it.
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
          ...(patchGroupId !== undefined ? { patchGroupId } : {}),
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
