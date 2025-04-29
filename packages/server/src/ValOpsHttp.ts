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
  bufferFromDataUrl,
  OrderedPatchesMetadata,
  OrderedPatches,
  SourcesSha,
} from "./ValOps";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
  ParentRef,
  Patch,
  ValCommit,
  ValDeployment,
} from "@valbuild/shared/internal";
import { result } from "@valbuild/core/fp";

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

const SummaryResponse = z.object({
  commitSummary: z.string().nullable(),
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
        clientCommitSha: z.string(),
        parentCommitSha: z.string(),
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
      }),
    )
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
  branch: z.string(),
});
const ProfilesResponse = z.object({
  profiles: z.array(
    z.object({
      profileId: z.string(),
      fullName: z.string(),
      email: z.string().optional(), // TODO: make this required once this can be guaranteed
      avatar: z
        .object({
          url: z.string(),
        })
        .nullable(),
    }),
  ),
});

export class ValOpsHttp extends ValOps {
  private readonly authHeaders: { Authorization: string };
  private readonly root: string;
  constructor(
    private readonly contentUrl: string,
    private readonly project: string,
    private readonly commitSha: string, // TODO: CommitSha
    private readonly branch: string,
    apiKey: string,
    valModules: ValModules,
    options?: ValOpsOptions & {
      /**
       * Root of project relative to repository.
       * E.g. if this is a monorepo and the current app is in the /apps/my-app folder,
       * the root would be /apps/my-app
       */
      root?: string;
    },
  ) {
    super(valModules, options);
    this.authHeaders = {
      Authorization: `Bearer ${apiKey}`,
    };
    this.root = options?.root ?? "";
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
      if (res.headers.get("Content-Type")?.includes("application/json")) {
        const json = await res.json();
        if (json.message) {
          console.error("Presigned auth nonce error:", json.message);
          return {
            status: "error",
            statusCode: 500,
            error: { message: json.message },
          };
        }
      }
      const unknownErrorMessage = `Could not get presigned auth nonce. HTTP error: ${res.status} ${res.statusText}`;
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

  override async getCommitSummary(preparedCommit: PreparedCommit): Promise<
    | {
        commitSummary: string | null;
        error?: undefined;
      }
    | {
        commitSummary?: undefined;
        error: GenericErrorMessage;
      }
  > {
    try {
      const res = await fetch(
        `${this.contentUrl}/v1/${this.project}/commit-summary`,
        {
          method: "POST",
          headers: {
            ...this.authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            patchedSourceFiles: preparedCommit.patchedSourceFiles,
            previousSourceFiles: preparedCommit.previousSourceFiles,
          }),
        },
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = SummaryResponse.safeParse(json);
        if (parsed.success) {
          return { commitSummary: parsed.data.commitSummary };
        }
        console.error(
          `Could not parse summary response.  Error: ${fromError(parsed.error).toString()}`,
        );
        return {
          error: {
            message: `Cannot get the summary of your changes. An error has been logged. Possible cause: the current version of Val might be too old. Please try again later or contact the developers on your team.`,
          },
        };
      }
      if (res.status === 401) {
        console.error("Unauthorized to get summary");
        return {
          error: {
            message:
              "Could not get summary. Although your user is authorized, the application has authorization issues. Contact the developers on your team and ask them to verify the api keys.",
          },
        };
      }
      const unknownErrorMessage = `Could not get summary. HTTP error: ${res.status} ${res.statusText}`;
      if (res.headers.get("Content-Type")?.includes("application/json")) {
        const json = await res.json();
        if (json.message) {
          console.error("Summary error:", json.message);
          return { error: { message: json.message } };
        }
      }
      console.error(unknownErrorMessage);
      return { error: { message: unknownErrorMessage } };
    } catch (e) {
      console.error("Could not get summary (connection error?):", e);
      return {
        error: {
          message: `Could not get summary. Error: ${
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
        commitSha: CommitSha;
        commits: ValCommit[];
        deployments: ValDeployment[];
        patches: PatchId[];
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
    for (const patchData of allPatchData.patches) {
      patches.push(patchData.patchId);
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
      commitSha: this.commitSha as CommitSha,
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
        branch: this.branch,
        profileId,
        commitSha: this.commitSha,
      }),
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
    })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          if (typeof json.nonce !== "string" || typeof json.url !== "string") {
            return {
              status: "error" as const,
              error: {
                message: "Invalid nonce response: " + JSON.stringify(json),
              },
            };
          }
          if (!json.url.startsWith("ws://") && !json.url.startsWith("wss://")) {
            return {
              status: "error" as const,
              error: {
                message: "Invalid websocket url: " + json.url,
              },
            };
          }
          return {
            status: "success" as const,
            data: { nonce: json.nonce, url: json.url },
          };
        }
        const contentType = res.headers.get("Content-Type") || "";
        if (contentType.startsWith("application/json")) {
          const json = await res.json();
          return {
            status: "error" as const,
            error: {
              message:
                "Could not get nonce." +
                (json.message ||
                  "Unexpected error (no error message). Status: " + res.status),
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
    }
    return {
      patches: allPatches,
      errors: Object.keys(allErrors).length > 0 ? allErrors : undefined,
    } as ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches;
  }

  async fetchPatchesInternal<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  > {
    const params: [string, string][] = [];
    params.push(["branch", this.branch]);
    params.push(["commit", this.commitSha]);
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
                clientCommitSha: commit.clientCommitSha as CommitSha,
                parentCommitSha: commit.parentCommitSha as CommitSha,
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
            "Could not your changes. It is most likely due to a network issue. Check your network connection and please try again.",
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

  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: PatchT,
    patchId: PatchId,
    parentRef: ParentRefT,
    authorId: AuthorId | null,
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
        patchId,
        parentPatchId: parentRef.type === "patch" ? parentRef.patchId : null,
        baseSha,
        commit: this.commitSha,
        branch: this.branch,
        coreVersion: Internal.VERSION.core,
      }),
    })
      .then(async (res): Promise<SaveSourceFilePatchResult> => {
        if (res.ok) {
          const parsed = SavePatchResponse.safeParse(await res.json());
          if (parsed.success) {
            return result.ok({ patchId: parsed.data.patchId });
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
          return result.err({
            errorType: "other",
            message: json.message || "Unknown error",
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
    data: string,
    type: BinaryFileType,
    metadata: MetadataOfType<BinaryFileType>,
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
          remote,
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
    path: ModuleFilePath,
  ): Promise<WithGenericError<{ data: string }>> {
    const filesRes = await this.getHttpFiles([
      {
        filePath: path,
        location: "repo",
        root: this.root,
        commitSha: this.commitSha as CommitSha,
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

    requestFiles.push({
      filePath: filePath,
      location: "repo",
      root: this.root,
      commitSha: this.commitSha as CommitSha,
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
    return bufferFromDataUrl(file.value) ?? null;
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

  async getCommitMessage(preparedCommit: PreparedCommit): Promise<
    | {
        commitSummary: string;
        error?: undefined;
      }
    | {
        error: GenericErrorMessage;
      }
  > {
    const res = await fetch(
      `${this.contentUrl}/v1/${this.project}/commit-summary`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patchedSourceFiles: preparedCommit.patchedSourceFiles,
          previousSourceFiles: preparedCommit.previousSourceFiles,
        }),
      },
    );
    if (res.ok) {
      const json = await res.json();
      return { commitSummary: json.commitSummary };
    }
    if (res.headers.get("Content-Type")?.includes("application/json")) {
      const json = await res.json();
      return { error: { message: json.message } };
    }
    return {
      error: {
        message:
          "Could not get commit message. HTTP error: " +
          res.status +
          " " +
          res.statusText,
      },
    };
  }

  async commit(
    prepared: PreparedCommit,
    message: string,
    committer: AuthorId,
    filesDirectory: string,
    newBranch?: string,
  ): Promise<
    | {
        isNotFastForward?: boolean;
        updatedFiles: string[];
        commit: CommitSha;
        branch: string;
        error?: undefined;
      }
    | {
        isNotFastForward?: boolean;
        error: GenericErrorMessage;
      }
  > {
    try {
      const existingBranch = this.branch;
      const res = await fetch(`${this.contentUrl}/v1/${this.project}/commit`, {
        method: "POST",
        headers: {
          ...this.authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patchedSourceFiles: prepared.patchedSourceFiles,
          patchedBinaryFilesDescriptors: prepared.patchedBinaryFilesDescriptors,
          appliedPatches: prepared.appliedPatches,
          commit: this.commitSha,
          root: this.root,
          filesDirectory,
          baseSha: await this.getBaseSha(),
          committer,
          message,
          existingBranch,
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
        const json = await res.json();
        if (json.isNotFastForward) {
          return {
            isNotFastForward: true,
            error: {
              message: "Could not commit. Not a fast-forward commit",
            },
          };
        }
        return {
          error: {
            message: json.message,
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

  // #region profiles
  override async getProfiles(): Promise<
    {
      profileId: string;
      fullName: string;
      email?: string;
      avatar: { url: string } | null;
    }[]
  > {
    const res = await fetch(`${this.contentUrl}/v1/${this.project}/profiles`, {
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
    });
    if (res.ok) {
      const parsed = ProfilesResponse.safeParse(await res.json());
      if (parsed.error) {
        console.error("Could not parse profiles response", parsed.error);
        throw Error(
          `Could not get profiles from remote server: wrong format. You might need to upgrade Val.`,
        );
      }
      return parsed.data.profiles;
    }
    if (res.headers.get("Content-Type")?.includes("application/json")) {
      const json = await res.json();
      throw Error(
        `Could not get profiles (status: ${res.status}): ${"message" in json ? json.message : "Unknown error"}`,
      );
    }
    throw Error(`Could not get profiles. Got status: ${res.status}`);
  }
}
