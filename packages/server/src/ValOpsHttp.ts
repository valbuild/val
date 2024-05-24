import {
  type PatchId,
  type ModuleFilePath,
  ValModules,
  Internal,
} from "@valbuild/core";
import type { Patch as PatchT } from "@valbuild/core/patch";
import {
  type AuthorId,
  type BaseSha,
  BinaryFileType,
  type CommitSha,
  FindPatches,
  GenericErrorMessage,
  MetadataOfType,
  OpsMetadata,
  Patches,
  PreparedCommit,
  ValOps,
  ValOpsOptions,
  WithGenericError,
} from "./ValOps";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { Patch } from "./patch/validation";

const textEncoder = new TextEncoder();

const PatchId = z.string().refine((s): s is PatchId => !!s); // TODO: validate
const CommitSha = z.string().refine((s): s is CommitSha => !!s); // TODO: validate
const BaseSha = z.string().refine((s): s is BaseSha => !!s); // TODO: validate
const AuthorId = z.string().refine((s): s is AuthorId => !!s); // TODO: validate
const ModuleFilePath = z.string().refine((s): s is ModuleFilePath => !!s); // TODO: validate
const Metadata = z.union([
  z.object({
    sha256: z.string(),
    mimeType: z.string(),
    width: z.number(),
    height: z.number(),
  }),
  z.object({
    sha256: z.string(),
    mimeType: z.string(),
  }),
]);
const MetadataRes = z.object({
  filePath: ModuleFilePath,
  metadata: Metadata,
  type: z.union([z.literal("file"), z.literal("image")]).nullable(),
});

const BasePatchResponse = z.object({
  path: ModuleFilePath,
  patchId: PatchId,
  authorId: AuthorId.nullable(),
  createdAt: z.string().datetime(),
  applied: z
    .object({
      baseSha: BaseSha,
      commitSha: CommitSha,
      appliedAt: z.string().datetime(),
    })
    .nullable(),
});
const GetPatches = z.object({
  patches: z.array(
    z.intersection(
      z.object({
        patch: Patch,
      }),
      BasePatchResponse
    )
  ),
  errors: z
    .array(
      z.object({
        patchId: PatchId.optional(),
        message: z.string(),
      })
    )
    .optional(),
});
const SearchPatches = z.object({
  patches: z.array(BasePatchResponse),
});
const FilesResponse = z.object({
  files: z.array(
    z.union([
      z.object({
        filePath: z.string(),
        location: z.literal("patch"),
        patchId: PatchId,
        value: z.string(),
      }),
      z.object({
        filePath: z.string(),
        location: z.literal("repo"),
        commitSha: CommitSha,
        value: z.string(),
      }),
    ])
  ),
  errors: z
    .array(
      z.union([
        z.object({
          filePath: z.string(),
          location: z.literal("patch"),
          patchId: PatchId,
          message: z.string(),
        }),
        z.object({
          filePath: z.string(),
          location: z.literal("repo"),
          commitSha: CommitSha,
          message: z.string(),
        }),
      ])
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
      })
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

export class ValOpsHttp extends ValOps {
  private readonly authHeaders: { Authorization: string };
  private readonly root: string;
  constructor(
    private readonly hostUrl: string,
    private readonly project: string,
    private readonly commitSha: string,
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
    }
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

  override async getPatchOpsById(patchIds: PatchId[]): Promise<Patches> {
    const params = new URLSearchParams();
    params.set("branch", this.branch);
    if (patchIds.length > 0) {
      params.set("patch_ids", encodeURIComponent(patchIds.join(",")));
    }
    return fetch(
      `${this.hostUrl}/v1/${this.project}/patches${
        params.size > 0 ? "?" + params : ""
      }`,
      {
        headers: {
          ...this.authHeaders,
          "Content-Type": "application/json",
        },
      }
    ).then(async (res): Promise<Patches> => {
      const patches: Patches["patches"] = {};
      if (res.ok) {
        const json = await res.json();
        const parsed = GetPatches.safeParse(json);
        if (parsed.success) {
          const data = parsed.data;
          const errors: Patches["errors"] = {};
          for (const patchesRes of data.patches) {
            patches[patchesRes.patchId] = {
              path: patchesRes.path,
              authorId: patchesRes.authorId,
              createdAt: patchesRes.createdAt,
              appliedAt: patchesRes.applied && {
                baseSha: patchesRes.applied.baseSha,
                timestamp: patchesRes.applied.appliedAt,
                git: {
                  commitSha: patchesRes.applied.commitSha,
                },
              },
              patch: patchesRes.patch,
            };
          }
          return {
            patches,
            errors,
          };
        }
        return {
          patches,
          error: {
            message: `Could not parse get patches response. Error: ${fromError(
              parsed.error
            )}`,
          },
        };
      }
      return {
        patches,
        error: {
          message:
            "Could not get patches. HTTP error: " +
            res.status +
            " " +
            res.statusText,
        },
      };
    });
  }

  async findPatches(filters: {
    authors?: AuthorId[] | undefined;
  }): Promise<FindPatches> {
    const params = new URLSearchParams();
    params.set("branch", this.branch);
    if (filters.authors && filters.authors.length > 0) {
      params.set("author_ids", encodeURIComponent(filters.authors.join(",")));
    }
    return fetch(
      `${this.hostUrl}/v1/${this.project}/search/patches${
        params.size > 0 ? "?" + params : ""
      }`,
      {
        headers: {
          ...this.authHeaders,
          "Content-Type": "application/json",
        },
      }
    ).then(async (res) => {
      const patches: FindPatches["patches"] = {};
      if (res.ok) {
        const parsed = SearchPatches.safeParse(await res.json());
        if (parsed.success) {
          for (const patchesRes of parsed.data.patches) {
            patches[patchesRes.patchId] = {
              path: patchesRes.path,
              authorId: patchesRes.authorId,
              createdAt: patchesRes.createdAt,
              appliedAt: patchesRes.applied && {
                baseSha: patchesRes.applied.baseSha,
                timestamp: patchesRes.applied.appliedAt,
                git: {
                  commitSha: patchesRes.applied.commitSha,
                },
              },
            };
          }
          return {
            patches,
          };
        }
        return {
          patches,
          error: {
            message: `Could not parse search patches response. Error: ${fromError(
              parsed.error
            )}`,
          },
        };
      }
      return {
        patches,
        error: {
          message:
            "Could not find patches. HTTP error: " +
            res.status +
            " " +
            res.statusText,
        },
      };
    });
  }

  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: PatchT,
    authorId: AuthorId | null
  ): Promise<WithGenericError<{ patchId: PatchId }>> {
    return fetch(`${this.hostUrl}/v1/${this.project}/patches`, {
      method: "POST",
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
        patch,
        authorId,
        commit: this.commitSha,
        branch: this.branch,
        coreVersion: Internal.VERSION.core,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const parsed = SavePatchResponse.safeParse(await res.json());
          if (parsed.success) {
            return { patchId: parsed.data.patchId };
          }
          return {
            error: {
              message: `Could not parse save patch response. Error: ${fromError(
                parsed.error
              )}`,
            },
          };
        }
        return {
          error: {
            message:
              "Could not save patch. HTTP error: " +
              res.status +
              " " +
              res.statusText,
          },
        };
      })
      .catch((e) => {
        return {
          error: {
            message: `Could save source file patch (connection error?): ${
              e instanceof Error ? e.message : e.toString()
            }`,
          },
        };
      });
  }

  protected override async saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
    data: string,
    type: BinaryFileType,
    metadata: MetadataOfType<BinaryFileType>
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    return fetch(
      `${this.hostUrl}/v1/${this.project}/patches/${patchId}/files`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath: filePath,
          data,
          type,
          metadata,
        }),
      }
    )
      .then(async (res) => {
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
                parsed.error
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
      })
      .catch((e) => {
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
        }
      | {
          filePath: string;
          location: "repo";
          root: string;
          commitSha: CommitSha;
        }
    )[]
  ): Promise<
    WithGenericError<{
      files: (
        | {
            value: string;
            filePath: string;
            location: "patch";
            patchId: PatchId;
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
      Internal.getSHA256Hash(textEncoder.encode(stringifiedFiles))
    );
    return fetch(`${this.hostUrl}/v1/${this.project}/files?${params}`, {
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
                parsedFileResponse.error
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
    path: ModuleFilePath
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
    const filesRes = await this.getHttpFiles([
      {
        filePath: filePath,
        location: "repo",
        root: this.root,
        commitSha: this.commitSha as CommitSha,
      },
    ]);
    if (filesRes.error) {
      return null;
    }
    const file = filesRes.files.find((f) => f.filePath === filePath);
    if (!file) {
      return null;
    }
    return Buffer.from(file.value, "base64");
  }

  override async getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId
  ): Promise<Buffer | null> {
    const filesRes = await this.getHttpFiles([
      {
        filePath: filePath,
        location: "patch",
        patchId,
      },
    ]);
    if (filesRes.error) {
      return null;
    }
    const file = filesRes.files.find((f) => f.filePath === filePath);
    if (!file) {
      return null;
    }
    return Buffer.from(file.value, "base64");
  }

  protected override async getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image"
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>> {
    const params = new URLSearchParams();
    params.set("file_path", filePath);
    try {
      const metadataRes = await fetch(
        `${this.hostUrl}/v1/${this.project}/patches/${patchId}/metadata?${params}`,
        {
          headers: { ...this.authHeaders, "Content-Type": "application/json" },
        }
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
                parsed.error
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
    type: T
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
    return fetch(`${this.hostUrl}/v1/${this.project}/patches`, {
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
                parsed.error
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
    newBranch?: string
  ): Promise<
    WithGenericError<{
      updatedFiles: string[];
      commit: CommitSha;
      branch: string;
    }>
  > {
    try {
      const existingBranch = this.branch;
      const res = await fetch(`${this.hostUrl}/v1/${this.project}/commit`, {
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
              parsed.error
            )}`,
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
}
