import { PatchId, ModuleFilePath, ValModules, Internal } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import {
  AuthorId,
  BaseSha,
  CommitSha,
  FindPatches,
  GenericErrorMessage,
  OpsMetadata,
  Patches,
  SchemaSha,
  ValOps,
  ValOpsOptions,
  WithGenericError,
} from "./ValOps";

export class ValOpsHttp extends ValOps {
  private authHeaders: { Authorization: string };
  constructor(
    private readonly hostUrl: string,
    private readonly project: string,
    /**
     * Root of project relative to repository.
     * E.g. if this is a monorepo and the current app is in the /apps/my-app folder,
     * the root would be /apps/my-app
     */
    private readonly root: string,
    private readonly commit: CommitSha,
    private readonly apiKey: string,
    valModules: ValModules,
    options?: ValOpsOptions
  ) {
    super(valModules, options);
    this.authHeaders = {
      Authorization: `Bearer ${apiKey}`,
    };
  }
  async onInit(): Promise<void> {
    // TODO: unused for now. Implement or remove
  }

  async getPatchOpsById(patchIds: PatchId[]): Promise<Patches> {
    const params = new URLSearchParams();
    params.set("include_ops", true.toString());
    if (patchIds.length > 0) {
      params.set("patch_ids", encodeURIComponent(patchIds.join(",")));
    }
    return fetch(`${this.hostUrl}${this.project}/patches?${params}`, {
      headers: this.authHeaders,
    }).then((res) => res.json());
  }

  async findPatches(filters: {
    authors?: AuthorId[] | undefined;
  }): Promise<FindPatches> {
    const params = new URLSearchParams();
    params.set("include_ops", false.toString());
    if (filters.authors && filters.authors.length > 0) {
      params.set("authors", encodeURIComponent(filters.authors.join(",")));
    }
    return fetch(`${this.hostUrl}${this.project}/patches?${params}`, {
      headers: this.authHeaders,
    }).then((res) => res.json());
  }

  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    authorId: AuthorId | null
  ): Promise<WithGenericError<{ patchId: PatchId }>> {
    return fetch(`${this.hostUrl}${this.project}/patches`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        path,
        patch,
        authorId,
        commit: this.commit,
        coreVersion: Internal.VERSION.core,
      }),
    }).then((res) => res.json());
  }
  protected getSourceFile(
    path: ModuleFilePath
  ): Promise<WithGenericError<{ data: string }>> {
    const params = new URLSearchParams();
    params.set("commit", this.commit);
    return fetch(
      `${this.hostUrl}${this.project}/repo/files/~${path}?${params}`,
      {
        method: "GET",
        headers: {
          Accept: "text/plain",
          ...this.authHeaders,
        },
      }
    ).then((res) => res.json());
  }

  protected saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    type: "file" | "image",
    patchId: PatchId,
    data: string,
    sha256: string
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    return fetch(`${this.hostUrl}${this.project}/patches/${patchId}/files`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        path: filePath,
        type,
        data,
        sha256,
      }),
    }).then((res) => res.json());
  }

  protected getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId
  ): Promise<Buffer | null> {
    return fetch(
      `${this.hostUrl}${this.project}/patches/${patchId}/files/~${filePath}`,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          ...this.authHeaders,
        },
      }
    ).then(async (res) => Buffer.from(await res.arrayBuffer()));
  }
  protected getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image"
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>> {
    const params = new URLSearchParams();
    params.set("type", type);
    return fetch(
      `${this.hostUrl}${this.project}/patches/${patchId}/metadata/~${filePath}?${params}`,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          ...this.authHeaders,
        },
      }
    ).then(async (res) => res.json());
  }
  protected getBinaryFile(filePath: string): Promise<Buffer | null> {
    const params = new URLSearchParams();
    params.set("commit", this.commit);
    return fetch(
      `${this.hostUrl}${this.project}/repo/files/~${filePath}?${params}`,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          ...this.authHeaders,
        },
      }
    ).then(async (res) => Buffer.from(await res.arrayBuffer()));
  }
  protected getBinaryFileMetadata<T extends "file" | "image">(
    filePath: string,
    type: T
  ): Promise<OpsMetadata<T>> {
    const params = new URLSearchParams();
    params.set("commit", this.commit);
    params.set("type", type);
    return fetch(
      `${this.hostUrl}${this.project}/repo/metadata/~${filePath}?${params}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...this.authHeaders,
        },
      }
    ).then(async (res) => res.json());
  }
  protected deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage & { patchId: PatchId }>;
      }
  > {
    return fetch(`${this.hostUrl}${this.project}/patches`, {
      method: "DELETE",
      headers: this.authHeaders,
      body: JSON.stringify({
        path: filePath,
        type,
        data,
        sha256,
      }),
    }).then((res) => res.json());
  }
}
