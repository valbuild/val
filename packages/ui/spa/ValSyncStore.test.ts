/* eslint-disable @typescript-eslint/no-explicit-any */
import { Api, ClientFetchErrors } from "@valbuild/shared/internal";
import { ValSyncStore } from "./ValSyncStore";
import {
  initVal,
  Internal,
  ModuleFilePath,
  PatchId,
  SelectorSource,
  SourcePath,
  ValConfig,
  ValidationError,
  ValModule,
} from "@valbuild/core";
import { applyPatch, deepClone, JSONOps, Patch } from "@valbuild/core/patch";
import { z } from "zod";

describe("ValSyncStore", () => {
  test("basic init and sync", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncStoreTester(
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const updateValue = (syncStore: ValSyncStore, value: string) => {
      return syncStore.addPatch(
        toSourcePath("/test.val.ts"),
        "string",
        [{ op: "replace", path: [], value }],
        tester.getNextNow(),
      );
    };

    const syncStore1 = await tester.createInitializedSyncStore();

    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: false,
      data: "test",
    });

    expect(updateValue(syncStore1, "value 0 from store 1")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: true,
      data: "value 0 from store 1",
    });
    expect(updateValue(syncStore1, "value 1 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: true,
      data: "value 1 from store 1",
    });
    expect(await tester.simulateStatCallback(syncStore1)).toMatchObject({
      status: "done",
    });
    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: false,
      data: "value 1 from store 1",
    });
  });

  test("basic conflict", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncStoreTester(
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const updateValue = (syncStore: ValSyncStore, value: string) => {
      return syncStore.addPatch(
        toSourcePath("/test.val.ts"),
        "string",
        [{ op: "replace", path: [], value }],
        tester.getNextNow(),
      );
    };

    const syncStore1 = await tester.createInitializedSyncStore();

    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: false,
      data: "test",
    });
    expect(updateValue(syncStore1, "value 0 from store 1")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: true,
      data: "value 0 from store 1",
    });
    expect(updateValue(syncStore1, "value 1 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: true,
      data: "value 1 from store 1",
    });
    // Start up sync store 2 before sync...
    const syncStore2 = await tester.createInitializedSyncStore();
    expect(updateValue(syncStore2, "value 2 from store 2")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncStore2.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: true,
      data: "value 2 from store 2",
    });
    // ...then sync store 1
    expect(await syncStore1.sync(tester.getNextNow(), false)).toMatchObject({
      status: "done",
    });
    expect(await tester.simulateStatCallback(syncStore1)).toMatchObject({
      status: "done",
    });
    // We must get stat before we can sync again
    expect(await syncStore2.sync(tester.getNextNow(), false)).toMatchObject({
      status: "retry",
      reason: "conflict",
    });
    expect(await tester.simulateStatCallback(syncStore2)).toMatchObject({
      status: "done",
    });
    expect(await tester.simulateStatCallback(syncStore1)).toMatchObject({
      status: "done",
    });
    expect(
      syncStore1.getSourceSnapshot(toModuleFilePath("/test.val.ts")),
    ).toMatchObject({
      status: "success",
      optimistic: false,
      data: "value 2 from store 2",
    });
  });
});

function toModuleFilePath(moduleFilePath: `/${string}.val.ts`): ModuleFilePath {
  return moduleFilePath as ModuleFilePath;
}

function toSourcePath(
  moduleFilePath: `/${string}.val.ts${`` | `?p=${string}`}`,
): SourcePath {
  return moduleFilePath as SourcePath;
}

type InferReq<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends z.ZodTypeAny
    ? z.infer<T[K]>
    : T[K] extends Record<string, unknown>
      ? InferReq<T[K]>
      : never;
};

type FakeApi = {
  "/sources/~": {
    PUT: z.infer<Api["/sources/~"]["PUT"]["res"]> | ClientFetchErrors | null;
  };
  "/patches": {
    GET: z.infer<Api["/patches"]["GET"]["res"]> | ClientFetchErrors | null;
    PUT: z.infer<Api["/patches"]["PUT"]["res"]> | ClientFetchErrors | null;
    DELETE:
      | z.infer<Api["/patches"]["DELETE"]["res"]>
      | ClientFetchErrors
      | null;
  };
  "/schema": {
    GET: z.infer<Api["/schema"]["GET"]["res"]> | ClientFetchErrors | null;
  };
};
class SyncStoreTester {
  fakeModules: any[];
  ops: JSONOps;
  fakePatches: {
    path: ModuleFilePath;
    patchId: PatchId;
    patch: Patch;
    createdAt: string;
    authorId: null;
    appliedAt: null;
  }[];
  fakeSchemas: Record<string, any>;
  fakeSources: Record<string, any>;
  now: number;
  fakeResponses: Partial<FakeApi>;

  constructor(
    public valModules: ValModule<SelectorSource>[],
    public config: ValConfig,
  ) {
    this.fakeModules = valModules;
    this.ops = new JSONOps();
    this.fakePatches = [];
    this.fakeSchemas = Object.fromEntries(
      this.fakeModules.map((m) => {
        const path = Internal.getValPath(m)!;
        return [path, Internal.getSchema(m)!] as const;
      }),
    );
    this.fakeSources = Object.fromEntries(
      this.fakeModules.map((m) => {
        const path = Internal.getValPath(m)!;
        return [path, Internal.getSource(m)] as const;
      }),
    );
    this.now = 0;
    this.fakeResponses = {};
  }

  getSchemasSha() {
    // We could have used the way we do this in ValOps which is better (more stable), but this is simple and should work for the tests
    const textEncoder = new TextEncoder();
    return Internal.getSHA256Hash(
      textEncoder.encode(JSON.stringify(this.fakeSchemas)),
    );
  }

  getBaseSha() {
    // We could have used the way we do this in ValOps which is better (more stable), but this is simple and should work for the tests
    const textEncoder = new TextEncoder();
    return Internal.getSHA256Hash(
      textEncoder.encode(
        JSON.stringify(this.fakeSchemas) +
          JSON.stringify(this.fakeSources) +
          JSON.stringify(this.config),
      ),
    );
  }

  getSchema(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _req: InferReq<Api["/schema"]["GET"]["req"]>,
  ): z.infer<Api["/schema"]["GET"]["res"]> {
    const serializedSchemas = Object.fromEntries(
      Object.entries(this.fakeSchemas).map(([path, schema]) => {
        return [path, schema.serialize()] as const;
      }),
    );
    return {
      status: 200,
      json: {
        schemas: serializedSchemas,
        schemaSha: this.getSchemasSha(),
      },
    };
  }

  putPatches(
    req: InferReq<Api["/patches"]["PUT"]["req"]>,
  ): z.infer<Api["/patches"]["PUT"]["res"]> {
    const { patches, parentRef } = req.body;
    const isParentRefFirstHead =
      this.fakePatches.length === 0 &&
      parentRef.type === "head" &&
      parentRef.headBaseSha === this.getBaseSha();
    const isParentPatchHead =
      this.fakePatches.length > 0 &&
      parentRef.type === "patch" &&
      this.fakePatches[this.fakePatches.length - 1].patchId ===
        parentRef.patchId;
    const isConflict = !(isParentRefFirstHead || isParentPatchHead);
    if (isConflict) {
      return {
        status: 409,
        json: {
          type: "patch-head-conflict",
          message: "Conflict",
        },
      };
    }
    const newPatchIds: PatchId[] = [];
    for (const patchData of patches) {
      newPatchIds.push(patchData.patchId);
      this.fakePatches.push({
        ...patchData,
        createdAt: new Date().toISOString(),
        authorId: null,
        appliedAt: null,
      });
    }
    return {
      status: 200,
      json: {
        newPatchIds,
        parentRef: {
          type: "patch",
          patchId: this.fakePatches[this.fakePatches.length - 1].patchId,
        },
      },
    };
  }

  deletePatches(
    req: InferReq<Api["/patches"]["DELETE"]["req"]>,
  ): z.infer<Api["/patches"]["DELETE"]["res"]> {
    const patch_ids = req.query.id;
    const deletedPatchIds: PatchId[] = [];
    for (const patchId of patch_ids) {
      const index = this.fakePatches.findIndex((p) => p.patchId === patchId);
      if (index !== -1) {
        deletedPatchIds.push(patchId);
        this.fakePatches.splice(index, 1);
      }
    }
    return {
      status: 200,
      json: deletedPatchIds,
    };
  }

  getPatches(
    req: InferReq<Api["/patches"]["GET"]["req"]>,
  ): z.infer<Api["/patches"]["GET"]["res"]> {
    const patches: {
      path: ModuleFilePath;
      patchId: PatchId;
      createdAt: string;
      authorId: string | null;
      appliedAt: {
        commitSha: string;
      } | null;
      patch?: Patch | undefined;
    }[] = [];
    const allPatchIds = new Set(this.fakePatches.map((p) => p.patchId));
    for (const patchData of this.fakePatches) {
      allPatchIds.add(patchData.patchId);
      if (
        req.query.patch_id === undefined ||
        (req.query.patch_id !== undefined &&
          req.query.patch_id.includes(patchData.patchId))
      ) {
        patches.push(patchData);
      }
    }
    let error: { message: string } | undefined = undefined;
    let errors: Record<PatchId, { message: string }> | undefined = undefined;
    for (const requestedPatchId of req.query.patch_id || []) {
      if (!allPatchIds.has(requestedPatchId)) {
        if (!errors) {
          errors = {};
        }
        errors[requestedPatchId] = {
          message: `Patch ${requestedPatchId} not found.`,
        };
      }
    }
    if (errors && Object.keys(errors).length > 0) {
      error = {
        message: "Some patches were not found.",
      };
    }
    return {
      status: 200,
      json: {
        error,
        errors,
        patches,
        baseSha: this.getBaseSha(),
      },
    };
  }

  putSources(
    req: InferReq<Api["/sources/~"]["PUT"]["req"]>,
  ): z.infer<Api["/sources/~"]["PUT"]["res"]> {
    const modules: Record<
      ModuleFilePath,
      {
        patches?:
          | {
              applied: PatchId[];
              errors?:
                | Partial<
                    Record<
                      PatchId,
                      {
                        message: string;
                      }
                    >
                  >
                | undefined;
              skipped?: PatchId[] | undefined;
            }
          | undefined;
        source?: any;
        validationErrors?: Record<SourcePath, ValidationError[]> | undefined;
      }
    > = {};
    for (const patchData of this.fakePatches) {
      const { patch, patchId, path: moduleFilePath } = patchData;
      const patchRes = applyPatch(
        deepClone(this.fakeSources[moduleFilePath]),
        this.ops,
        patch,
      );
      if (!modules[moduleFilePath]) {
        modules[moduleFilePath] = {};
      }
      if (!modules[moduleFilePath].patches) {
        modules[moduleFilePath].patches = {
          applied: [],
        };
      }
      if (patchRes.kind === "ok") {
        modules[moduleFilePath].source = patchRes.value;
        modules[moduleFilePath].patches?.applied.push(patchId);
      } else {
        if (
          modules[moduleFilePath].patches !== undefined &&
          !modules[moduleFilePath].patches?.skipped
        ) {
          modules[moduleFilePath].patches!.skipped = [];
        }
        modules[moduleFilePath].patches?.skipped?.push(patchId);
        if (!modules[moduleFilePath].patches!.errors) {
          modules[moduleFilePath].patches!.errors = {};
        }
        if (!modules[moduleFilePath].patches?.errors?.[patchId]) {
          modules[moduleFilePath].patches!.errors![patchId] = {
            message: patchRes.error.message,
          };
        }
      }
    }
    for (const moduleFilePathS of Object.keys(this.fakeSources)) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const source =
        modules?.[moduleFilePath]?.source ?? this.fakeSources[moduleFilePath];
      const schema = this.fakeSchemas[moduleFilePath];
      const validationErrors =
        req.query.validate_sources &&
        schema.validate(moduleFilePath as unknown as SourcePath, source);
      modules[moduleFilePath] = {
        source: deepClone(source),
      };
      if (validationErrors) {
        modules[moduleFilePath].validationErrors = validationErrors;
      }
    }
    return {
      status: 200,
      json: {
        modules,
        schemaSha: this.getSchemasSha(),
      },
    };
  }

  removeFakeResponse<R extends keyof FakeApi, M extends keyof FakeApi[R]>(
    route: R,
    method: M,
  ): this {
    const maybeAnyRoute = this.fakeResponses[
      route as keyof typeof this.fakeResponses
    ] as any;
    delete maybeAnyRoute[method];
    return this;
  }

  setFakeResponse<
    R extends keyof FakeApi,
    M extends keyof FakeApi[R],
    ResType = FakeApi[R][M],
  >(route: R, method: M, response: ResType | ClientFetchErrors): this {
    if (!this.fakeResponses[route as keyof typeof this.fakeResponses]) {
      this.fakeResponses[route as keyof typeof this.fakeResponses] = {} as any;
    }

    (this.fakeResponses[route as keyof typeof this.fakeResponses] as any)[
      method
    ] = response;
    return this;
  }

  createMockClient(): any {
    return (route: string, method: string, req: any) => {
      const anyFakeResponses = this.fakeResponses as any;
      if (
        anyFakeResponses &&
        route in anyFakeResponses &&
        method in anyFakeResponses[route] &&
        anyFakeResponses[route][method]
      ) {
        return anyFakeResponses[route][method];
      }
      if (route === "/sources/~" && method === "PUT") {
        return this.putSources(req);
      }
      if (route === "/patches" && method === "GET") {
        return this.getPatches(req);
      }
      if (route === "/patches" && method === "PUT") {
        return this.putPatches(req);
      }
      if (route === "/patches" && method === "DELETE") {
        return this.deletePatches(req);
      }
      if (route === "/schema" && method === "GET") {
        return this.getSchema(req);
      }
      return {
        status: 404,
        json: {
          message: `Invalid route ${route} with method ${method as string}. This is most likely a Val bug.`,
          path: route,
          method: method as string,
        },
      } satisfies ClientFetchErrors;
    };
  }

  async simulateStatCallback(valStore: ValSyncStore) {
    return await valStore.syncWithUpdatedStat(
      this.getBaseSha(),
      this.getSchemasSha(),
      this.fakePatches.map((p) => p.patchId),
      this.now++,
    );
  }

  async createInitializedSyncStore() {
    const syncStore = new ValSyncStore(this.createMockClient(), undefined);
    await syncStore.init(
      this.getBaseSha(),
      this.getSchemasSha(),
      this.fakePatches.map((p) => p.patchId),
      this.now++,
    );
    return syncStore;
  }

  getNextNow() {
    return this.now++;
  }
}
