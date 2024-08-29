import {
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { Patch } from "@valbuild/core/patch";
import { ValClient } from "./ValClient";
import { Result } from "@valbuild/core/src/fp/result";

export type ValCacheError =
  | {
      errorType: "patch-error";
      errors: {
        moduleFilePath: string;
        patchId: PatchId;
        skipped: boolean;
        patchError: string;
      }[];
    }
  | { errorType: "other"; message: string };

export class ValCache {
  private readonly drafts: Record<ModuleFilePath, Json>;
  private readonly schema: Record<ModuleFilePath, SerializedSchema>;

  constructor(private readonly client: ValClient) {
    this.drafts = {};
    this.schema = {};
  }

  async reloadPaths(paths: ModuleFilePath[]) {
    const patchesResponse = await this.client("/patches/~", "GET", {
      query: {
        omit_patch: true,
        author: [],
        patch_id: [],
        module_file_path: paths,
      },
    });
    if (patchesResponse.status !== 200) {
      console.error(
        "Val: failed to get patches",
        patchesResponse.json.message,
        patchesResponse.json
      );
      return;
    }

    const patches = patchesResponse.json;
    const filteredPatches = Object.keys(patches) as PatchId[];
    const treeRes = await this.client("/tree/~", "PUT", {
      query: {
        validate_sources: true,
        validate_all: false,
        validate_binary_files: false,
      },
      path: undefined, // TODO: reload only the paths the requested paths
      body: {
        patchIds: filteredPatches,
      },
    });
    await this.initialize();
    if (treeRes.status === 200) {
      const data = treeRes.json;
      for (const pathS of Object.keys(data.modules)) {
        const path = pathS as ModuleFilePath;
        this.drafts[path] = data?.modules?.[path]?.source;
        this.emitEvent(path, this.drafts[path]);
      }
    } else {
      console.error("Val: failed to reload paths", paths, treeRes.json);
    }
  }

  async reset(): Promise<Result<undefined, ValCacheError>> {
    const patchesRes = await this.client("/patches/~", "GET", {
      query: {
        omit_patch: true,
        author: [],
        patch_id: [],
        module_file_path: [],
      },
    });
    if (patchesRes.status !== 200) {
      console.error("Val: failed to get patches", patchesRes.json);

      return result.err({
        errorType: "other",
        message: "Failed to get patches",
      });
    }
    const allPatches = Object.keys(patchesRes.json.patches) as PatchId[];

    const treeRes = await this.client("/tree/~", "PUT", {
      path: undefined,
      query: {
        validate_sources: false,
        validate_all: false,
        validate_binary_files: false,
      },
      body: {
        patchIds: allPatches,
      },
    });
    const initRes = await this.initialize();

    if (result.isErr(initRes)) {
      console.error("Failed to initialize inside reset", initRes.error);
      return result.err({
        errorType: "other",
        message: initRes.error.message,
      });
    }
    if (treeRes.status === 200) {
      for (const pathS of Object.keys(treeRes.json.modules)) {
        const path = pathS as ModuleFilePath;
        this.drafts[path] = treeRes.json?.modules?.[path]?.source;
        this.emitEvent(path, this.drafts[path]);
      }
      return result.ok(undefined);
    } else if (treeRes.status === 400 && "type" in treeRes.json) {
      return result.err({
        errorType: "patch-error",
        errors: Object.entries(treeRes.json.errors).flatMap(
          ([moduleFilePath, value]) =>
            (value ?? []).map((item) => ({
              moduleFilePath,
              patchError: item.error.message,
              patchId: item.patchId,
              skipped: item.skipped,
            }))
        ),
      });
    } else {
      console.error("Val: failed to reset", treeRes.json);
      return result.err({
        errorType: "other",
        message: "Failed to reset " + JSON.stringify(treeRes.json),
      });
    }
  }

  async getModule(path: ModuleFilePath, refetch: boolean = false) {
    if (!refetch && this.drafts[path] && this.schema[path]) {
      return result.ok({
        source: this.drafts[path],
        schema: this.schema[path],
      });
    }
    const treeRes = await this.client("/tree/~", "PUT", {
      path,
      body: {},
      query: {
        validate_sources: false,
        validate_all: false,
        validate_binary_files: false,
      },
    });

    if (treeRes.status === 200) {
      if (!treeRes.json?.modules?.[path]) {
        console.error("Val: could not find the module", {
          moduleIds: Object.keys(treeRes.json.modules),
          moduleId: path,
          data: treeRes,
        });
        return result.err({
          message:
            "Could not fetch data.\nCould not find the module:\n" +
            path +
            "\n\nVerify that the val.modules file includes this module.",
        });
      }
      const fetchedSource = treeRes.json?.modules?.[path]?.source;
      const schema: SerializedSchema | undefined = this.schema[path];
      if (!this.schema[path]) {
        await this.initialize();
        if (!this.schema[path]) {
          return result.err({
            message: "Path not found in schema. Verify that the module exists.",
          });
        }
      }
      if (fetchedSource !== undefined) {
        this.drafts[path] = fetchedSource;
        return result.ok({
          source: fetchedSource,
          schema,
        });
      } else {
        console.error("Val: could not find the module source");
        return result.err({
          message: "Could not fetch data. Verify that the module exists.",
        });
      }
    } else {
      if (treeRes.status === 504) {
        console.error("Val: timeout", treeRes.json);
        return result.err({
          message: "Timed out while fetching data. Try again later.",
        });
      } else {
        console.error("Val: failed to get module", treeRes.json);
        return result.err({
          message:
            "Could not fetch data. Verify that  is correctly configured.",
        });
      }
    }
  }

  async deletePatches(
    patchIds: PatchId[]
  ): Promise<result.Result<PatchId[], { message: string }>> {
    const patchesRes = await this.client("/patches/~", "DELETE", {
      query: {
        id: patchIds,
      },
    });
    if (patchesRes.status === 200) {
      return result.ok(patchesRes.json);
    } else {
      console.error("Val: failed to delete patches", patchesRes.json);
      return result.err({ message: patchesRes.json.message });
    }
  }

  async applyPatch(
    path: ModuleFilePath,
    patchIds: PatchId[],
    patch: Patch
  ): Promise<
    result.Result<
      {
        modules: Record<
          ModuleFilePath,
          {
            patchIds: PatchId[];
          }
        >;
        newPatchId: PatchId;
      },
      ValCacheError
    >
  > {
    const treeRes = await this.client("/tree/~", "PUT", {
      path,
      query: {
        validate_sources: false,
        validate_all: false,
        validate_binary_files: false,
      },
      body: {
        patchIds,
        addPatch: {
          path,
          patch,
        },
      },
    });
    if (treeRes.status === 200) {
      const newPatchId = treeRes.json.newPatchId;
      if (!newPatchId) {
        console.error("Val: could create patch", treeRes);
        return result.err({
          errorType: "other",
          message: "Val: could not create patch",
        });
      }
      const fetchedSource = treeRes.json?.modules?.[path]?.source;
      if (fetchedSource !== undefined) {
        this.drafts[path] = fetchedSource;
        this.emitEvent(path, fetchedSource);
        return result.ok({
          newPatchId,
          modules: {
            [path]: {
              patchIds: treeRes.json?.modules?.[path]?.patches?.applied || [],
            },
          },
        });
      } else {
        console.error("Val: could not patch");
        return result.err({
          errorType: "other",
          message: "Val: could not fetch data. Verify that the module exists.",
        });
      }
    } else if (treeRes.status === 400 && "type" in treeRes.json) {
      return result.err({
        errorType: "patch-error",
        errors: Object.entries(treeRes.json.errors).flatMap(
          ([moduleFilePath, value]) =>
            (value ?? []).map((item) => ({
              moduleFilePath,
              patchError: item.error.message,
              patchId: item.patchId,
              skipped: item.skipped,
            }))
        ),
      });
    } else {
      console.error("Val: failed to get module", treeRes.json);
      return result.err({
        errorType: "other",
        message:
          "Val: could not fetch data. Verify that  is correctly configured.",
      });
    }
  }

  private emitEvent(path: ModuleFilePath, source: Json) {
    const event = new CustomEvent("val-event", {
      detail: {
        type: "module-update",
        path,
        source,
      },
    });
    window.dispatchEvent(event);
  }

  async initialize(): Promise<
    result.Result<
      ModuleFilePath[],
      {
        message: string;
        details: {
          fetchError: {
            message: string;
            statusCode?: number;
          };
        };
      }
    >
  > {
    const schemaRes = await this.client("/schema", "GET", {});
    if (schemaRes.status === 200) {
      const paths: ModuleFilePath[] = [];
      for (const moduleId of Object.keys(
        schemaRes.json.schemas
      ) as ModuleFilePath[]) {
        const schema = schemaRes.json.schemas[moduleId];
        if (schema) {
          paths.push(moduleId);
          this.schema[moduleId] = schema;
        }
      }
      return result.ok(paths);
    } else {
      let msg = "Failed to fetch content. ";
      if (schemaRes.status === 401) {
        msg += "Authorization failed - check that you are logged in.";
      } else {
        msg += "Get a developer to verify that  is correctly setup.";
      }
      return result.err({
        message: msg,
        details: {
          fetchError: schemaRes.json,
        },
      });
    }
  }
}
