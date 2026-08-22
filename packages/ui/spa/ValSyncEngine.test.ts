/* eslint-disable @typescript-eslint/no-explicit-any */
import { Api, ClientFetchErrors } from "@valbuild/shared/internal";
import { ValSyncEngine } from "./ValSyncEngine";
import {
  initVal,
  Internal,
  ModuleFilePath,
  PatchId,
  ReifiedRender,
  SelectorSource,
  SerializedSchema,
  SourcePath,
  ValConfig,
  ValidationError,
  ValModule,
  ValModules,
} from "@valbuild/core";
import {
  applyPatch,
  deepClone,
  JSONOps,
  JSONValue,
  Patch,
} from "@valbuild/core/patch";
import { z } from "zod";

describe("ValSyncEngine", () => {
  test("basic init and sync", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const updateValue = (syncEngine: ValSyncEngine, value: string) => {
      return syncEngine.addPatch(
        toSourcePath("/test.val.ts"),
        "string",
        [{ op: "replace", path: [], value }],
        tester.getNextNow(),
      );
    };

    const syncEngine1 = await tester.createInitializedSyncEngine();

    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("test");

    expect(updateValue(syncEngine1, "")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("");
    expect(updateValue(syncEngine1, "value 1 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 1 from store 1");
    tester.simulatePassingOfSeconds(5);
    expect(await tester.simulateStatCallback(syncEngine1)).toMatchObject({
      status: "done",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 1 from store 1");
  });

  test("fs publish keeps the patched value (no flicker back to base)", async () => {
    // Regression test for the save-flicker: after publish() drops the now-saved
    // patches in fs mode, serverSources still holds the un-patched base. Without
    // baking the optimistic value into serverSources first, the field would
    // momentarily revert to the pre-patch value until the next /sources/~ sync.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "Foo")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("Foo");

    syncEngine.addPatch(
      toSourcePath("/test.val.ts"),
      "string",
      [{ op: "replace", path: [], value: "FooBar" }],
      tester.getNextNow(),
    );
    // Optimistic value is shown immediately.
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("FooBar");

    // serverSources is still the un-patched base at this point (the studio reads
    // /sources/~ with apply_patches=false), so publishing must bake the patched
    // value in as it drops the patch chain.
    const patchIds = syncEngine.getPendingClientSidePatchIdsSnapshot();
    expect(patchIds.length).toBeGreaterThan(0);
    expect(
      await syncEngine.publish(patchIds, undefined, tester.getNextNow()),
    ).toMatchObject({
      status: "done",
    });

    // A field re-rendering after publish (fresh creatorId → fresh getPatchedSource
    // recompute, i.e. what HMR / the next sync's source invalidation triggers)
    // must NOT see the pre-patch value flicker through. This is the assertion
    // that fails without the fix (it would recompute base "Foo" + no patches).
    expect(
      syncEngine.getSourceSnapshot(
        toModuleFilePath("/test.val.ts"),
        "field-rerender-after-publish",
      ).data,
    ).toStrictEqual("FooBar");

    // And it stays "FooBar" after the follow-up stat-triggered sync.
    tester.simulatePassingOfSeconds(5);
    expect(await tester.simulateStatCallback(syncEngine)).toMatchObject({
      status: "done",
    });
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("FooBar");
  });

  test("fs publish clears the server-side patch-id snapshot (no Save button re-enable)", async () => {
    // Regression test for the Save button flicker: after publish() empties
    // globalServerSidePatchIds in fs mode, its snapshot must be invalidated too.
    // Otherwise getGlobalServerSidePatchIdsSnapshot() (which the button reads as
    // pendingServerSidePatchIds) stays stale and non-empty until the next
    // stat/sync, so the button briefly flips back to enabled when publish()'s
    // finally clears publishDisabled.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "Foo")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();
    syncEngine.addPatch(
      toSourcePath("/test.val.ts"),
      "string",
      [{ op: "replace", path: [], value: "FooBar" }],
      tester.getNextNow(),
    );
    // Push the patch to the server and promote it to a global server-side patch
    // id via the stat callback — this is the button's "enabled" precondition.
    expect(await syncEngine.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });
    expect(await tester.simulateStatCallback(syncEngine)).toMatchObject({
      status: "done",
    });
    const patchIds = syncEngine.getGlobalServerSidePatchIdsSnapshot();
    expect(patchIds.length).toBeGreaterThan(0);

    expect(
      await syncEngine.publish(patchIds, undefined, tester.getNextNow()),
    ).toMatchObject({
      status: "done",
    });

    // Immediately after publish (before any further stat/sync) the server-side
    // patch-id snapshot must be empty — this fails without the invalidation.
    expect(syncEngine.getGlobalServerSidePatchIdsSnapshot()).toStrictEqual([]);
  });

  test("fs publish persists patches that contain file ops", async () => {
    // File ops carry binary content, not document mutations, so applyPatch
    // rejects them: the fake /save must filter them out (as the real server
    // does) before applying the rest of the patch. Otherwise an image / gallery
    // patch never persists and the value reverts on the next sources sync.
    const { s, c, config } = initVal();
    const ref = "/public/val/test_a1b2c.png";
    const metadata = {
      width: 10,
      height: 20,
      mimeType: "image/png",
      alt: "",
    };
    const tester = new SyncEngineTester(
      "fs",
      [
        c.define(
          "/gallery.val.ts",
          s.record(
            s.object({
              width: s.number(),
              height: s.number(),
              mimeType: s.string(),
              alt: s.string(),
            }),
          ),
          {},
        ),
      ],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();
    // Same shape as ModuleGallery: the metadata entry is added by a JSON op and
    // the binary is carried by a file op on the same path (in the real flow
    // `value` is the sha256 of the already uploaded content).
    syncEngine.addPatch(
      toSourcePath("/gallery.val.ts"),
      "record",
      [
        { op: "add", path: [ref], value: metadata },
        {
          op: "file",
          path: [ref],
          filePath: ref,
          value:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          remote: false,
          metadata,
        },
      ],
      tester.getNextNow(),
    );
    expect(await syncEngine.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });
    expect(await tester.simulateStatCallback(syncEngine)).toMatchObject({
      status: "done",
    });
    const patchIds = syncEngine.getGlobalServerSidePatchIdsSnapshot();
    expect(patchIds.length).toBeGreaterThan(0);
    expect(
      await syncEngine.publish(patchIds, undefined, tester.getNextNow()),
    ).toMatchObject({
      status: "done",
    });
    // /save must have applied the non-file half of the patch to the sources...
    expect(tester.fakeSources["/gallery.val.ts"]).toStrictEqual({
      [ref]: metadata,
    });
    // ...so the entry survives the follow-up stat-triggered sources sync, where
    // it comes from the server instead of the now-dropped patch chain.
    tester.simulatePassingOfSeconds(5);
    expect(await tester.simulateStatCallback(syncEngine)).toMatchObject({
      status: "done",
    });
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/gallery.val.ts")).data,
    ).toStrictEqual({ [ref]: metadata });
  });

  test("editing one field does not invalidate every module", async () => {
    // Regression test for the typing-is-slow issue: every keystroke that
    // started a new patch changed the server-side patch id list, which used to
    // set forceSyncAllModules and therefore re-fetched + invalidated every
    // module in the project on the next stat callback.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [
        c.define("/edited.val.ts", s.string(), "edited"),
        c.define("/other1.val.ts", s.string(), "other1"),
        c.define("/other2.val.ts", s.string(), "other2"),
      ],
      config,
    );
    const requests: { route: string; path: string | undefined }[] = [];
    const mockClient = tester.createMockClient();
    const spyingClient: any = (route: string, method: any, req: any) => {
      requests.push({ route, path: req?.path });
      return mockClient(route, method, req);
    };
    const syncEngine = new ValSyncEngine(spyingClient, undefined);
    await syncEngine.init(
      tester.getMode(),
      tester.getBaseSha(),
      tester.getSchemasSha(),
      tester.getSourcesSha(),
      tester.fakePatches.map((p) => p.patchId),
      null,
      tester.getCommitSha(),
      tester.getNextNow(),
    );

    const invalidatedModules: ModuleFilePath[] = [];
    const unsubscribes = (
      ["/edited.val.ts", "/other1.val.ts", "/other2.val.ts"] as const
    ).map((moduleFilePathS) => {
      const moduleFilePath = toModuleFilePath(moduleFilePathS);
      return syncEngine.subscribe(
        "source",
        moduleFilePath,
      )(() => {
        invalidatedModules.push(moduleFilePath);
      });
    });

    // Type into a single field, then let the sync + stat cycle run.
    syncEngine.addPatch(
      toSourcePath("/edited.val.ts"),
      "string",
      [{ op: "replace", path: [], value: "edited!" }],
      tester.getNextNow(),
    );
    tester.simulatePassingOfSeconds(5);
    requests.length = 0;
    invalidatedModules.length = 0;
    expect(await tester.simulateStatCallback(syncEngine)).toMatchObject({
      status: "done",
    });

    // Only the edited module may be re-fetched...
    const sourceRequests = requests.filter((r) => r.route === "/sources/~");
    for (const sourceRequest of sourceRequests) {
      expect(sourceRequest.path).toBe("/edited.val.ts");
    }
    // ... and only the edited module may be invalidated.
    expect(new Set(invalidatedModules)).toStrictEqual(
      new Set([toModuleFilePath("/edited.val.ts")]),
    );
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/edited.val.ts")).data,
    ).toStrictEqual("edited!");

    // The stat callback that reports the now-synced patch id must not drag
    // the untouched modules along either.
    requests.length = 0;
    invalidatedModules.length = 0;
    tester.simulatePassingOfSeconds(5);
    expect(await tester.simulateStatCallback(syncEngine)).toMatchObject({
      status: "done",
    });
    expect(requests.filter((r) => r.route === "/sources/~")).toStrictEqual([]);
    expect(invalidatedModules).not.toContain(
      toModuleFilePath("/other1.val.ts"),
    );
    expect(invalidatedModules).not.toContain(
      toModuleFilePath("/other2.val.ts"),
    );
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/other1.val.ts")).data,
    ).toStrictEqual("other1");

    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  });

  test("patch errors are cleared once the server stops reporting them", async () => {
    // The server omits `patches.errors` for a module that has none, so an
    // absent field means "no errors" and has to clear what we held before.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string(), "test")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();
    const moduleFilePath = toModuleFilePath("/test.val.ts");

    let patchErrorsListenerCalls = 0;
    const unsubscribe = syncEngine.subscribe("patch-errors", [moduleFilePath])(
      () => {
        patchErrorsListenerCalls++;
      },
    );

    const sourcesResponseWithPatchErrors = {
      status: 200,
      json: {
        modules: {
          [moduleFilePath]: {
            source: "test",
            patches: {
              applied: [],
              errors: {
                ["some-patch-id" as PatchId]: { message: "Could not apply" },
              },
            },
          },
        },
        sourcesSha: tester.getSourcesSha(),
        schemaSha: tester.getSchemasSha(),
      },
    };
    tester.setFakeResponse("/sources/~", "PUT", sourcesResponseWithPatchErrors);
    // Force a sync that reads sources: a source file changed on disk.
    tester.fakeSources = { ...tester.fakeSources, "/other.val.ts": "changed" };
    tester.simulatePassingOfSeconds(5);
    await tester.simulateStatCallback(syncEngine);

    expect(syncEngine.getPatchErrorsSnapshot([moduleFilePath])).toStrictEqual({
      [moduleFilePath]: {
        ["some-patch-id" as PatchId]: { message: "Could not apply" },
      },
    });
    expect(patchErrorsListenerCalls).toBeGreaterThan(0);

    // The patch is fixed/removed server side, so `errors` is now omitted.
    patchErrorsListenerCalls = 0;
    tester.removeFakeResponse("/sources/~", "PUT");
    tester.fakeSources = { ...tester.fakeSources, "/other.val.ts": "again" };
    tester.simulatePassingOfSeconds(5);
    await tester.simulateStatCallback(syncEngine);

    expect(syncEngine.getPatchErrorsSnapshot([moduleFilePath])).toBeUndefined();
    expect(patchErrorsListenerCalls).toBeGreaterThan(0);

    unsubscribe();
  });

  test("basic reset", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const updateValue = (syncEngine: ValSyncEngine, value: string) => {
      return syncEngine.addPatch(
        toSourcePath("/test.val.ts"),
        "string",
        [{ op: "replace", path: [], value }],
        tester.getNextNow(),
      );
    };
    const syncEngine1 = await tester.createInitializedSyncEngine();
    updateValue(syncEngine1, "value 0 from store 1");
    expect(await syncEngine1.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 0 from store 1");
    syncEngine1.reset();
    syncEngine1.reset();
    syncEngine1.reset();
    syncEngine1.reset();
    expect(await syncEngine1.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 0 from store 1");
  });

  test("wait 1 second from last op before allowing sync", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const updateValue = (syncEngine: ValSyncEngine, value: string) => {
      return syncEngine.addPatch(
        toSourcePath("/test.val.ts"),
        "string",
        [{ op: "replace", path: [], value }],
        tester.getNextNow(),
      );
    };
    const syncEngine1 = await tester.createInitializedSyncEngine();
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("test");
    expect(updateValue(syncEngine1, "value 0 from store 1")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 0 from store 1");
    expect(updateValue(syncEngine1, "value 1 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 1 from store 1");
    tester.simulatePassingOfSeconds(0.5);
    expect(await syncEngine1.sync(tester.getNextNow())).toMatchObject({
      status: "retry",
      reason: "too-fast",
    });

    expect(updateValue(syncEngine1, "value 2 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    tester.simulatePassingOfSeconds(1);
    expect(await syncEngine1.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });

    expect(updateValue(syncEngine1, "value 3 from store 1")).toMatchObject({
      status: "patch-added",
    });
    tester.simulatePassingOfSeconds(4.5);
    expect(updateValue(syncEngine1, "value 4 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    tester.simulatePassingOfSeconds(0.5);
    expect(await syncEngine1.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });

    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 4 from store 1");
  });

  test("basic conflict", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const updateValue = (syncEngine: ValSyncEngine, value: string) => {
      return syncEngine.addPatch(
        toSourcePath("/test.val.ts"),
        "string",
        [{ op: "replace", path: [], value }],
        tester.getNextNow(),
      );
    };

    const syncEngine1 = await tester.createInitializedSyncEngine();

    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("test");
    expect(updateValue(syncEngine1, "value 0 from store 1")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 0 from store 1");
    expect(updateValue(syncEngine1, "value 1 from store 1")).toMatchObject({
      status: "patch-merged",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 1 from store 1");
    // Start up sync store 2 before sync...
    const syncEngine2 = await tester.createInitializedSyncEngine();
    expect(updateValue(syncEngine2, "value 2 from store 2")).toMatchObject({
      status: "patch-added",
    });
    expect(
      syncEngine2.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 2 from store 2");
    // ...then sync store 1
    tester.simulatePassingOfSeconds(5);
    expect(await syncEngine1.sync(tester.getNextNow())).toMatchObject({
      status: "done",
    });
    expect(await tester.simulateStatCallback(syncEngine1)).toMatchObject({
      status: "done",
    });
    // We must get stat before we can sync again
    tester.simulatePassingOfSeconds(5);
    expect(await syncEngine2.sync(tester.getNextNow())).toMatchObject({
      status: "retry",
      reason: "conflict",
    });
    tester.simulatePassingOfSeconds(5);
    expect(await tester.simulateStatCallback(syncEngine2)).toMatchObject({
      status: "done",
    });
    tester.simulatePassingOfSeconds(5);
    expect(await tester.simulateStatCallback(syncEngine1)).toMatchObject({
      status: "done",
    });
    expect(
      syncEngine1.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("value 2 from store 2");
  });

  test("setSchemas sets schemas and invalidates caches", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();

    const mockSchemas = {
      [toModuleFilePath("/test.val.ts")]: Internal.getSchema(
        c.define("/test.val.ts", s.string().minLength(2), "test"),
      )?.["executeSerialize"](),
    } as Record<ModuleFilePath, SerializedSchema | undefined>;

    let schemaListenerCalled = false;
    const unsubscribe = syncEngine.subscribe("schema")(() => {
      schemaListenerCalled = true;
    });

    syncEngine.setSchemas(mockSchemas);

    expect(schemaListenerCalled).toBe(true);
    const schemaSnapshot = syncEngine.getSchemaSnapshot(
      toModuleFilePath("/test.val.ts"),
    );
    expect(schemaSnapshot.status).toBe("success");
    if (schemaSnapshot.status === "success") {
      expect(schemaSnapshot.data).toEqual(
        mockSchemas[toModuleFilePath("/test.val.ts")],
      );
    }

    unsubscribe();
  });

  test("setSources updates serverSources and notifies subscribers", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();

    const mockSources = {
      [toModuleFilePath("/test.val.ts")]: "mock value",
    } as Record<ModuleFilePath, JSONValue | undefined>;

    let sourceListenerCalled = false;
    let allSourcesListenerCalled = false;
    const unsubscribeSource = syncEngine.subscribe(
      "source",
      toModuleFilePath("/test.val.ts"),
    )(() => {
      sourceListenerCalled = true;
    });
    const unsubscribeAllSources = syncEngine.subscribe("all-sources")(() => {
      allSourcesListenerCalled = true;
    });

    syncEngine.setSources(mockSources);

    expect(sourceListenerCalled).toBe(true);
    expect(allSourcesListenerCalled).toBe(true);
    const sourceSnapshot = syncEngine.getSourceSnapshot(
      toModuleFilePath("/test.val.ts"),
    );
    expect(sourceSnapshot.data).toEqual("mock value");

    unsubscribeSource();
    unsubscribeAllSources();
  });

  test("setRenders sets renders and invalidates caches", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();

    const mockRenders = {
      [toModuleFilePath("/test.val.ts")]: null,
    } as Record<ModuleFilePath, ReifiedRender | null>;

    let renderListenerCalled = false;
    const unsubscribe = syncEngine.subscribe(
      "render",
      toModuleFilePath("/test.val.ts"),
    )(() => {
      renderListenerCalled = true;
    });

    syncEngine.setRenders(mockRenders);

    expect(renderListenerCalled).toBe(true);
    const renderSnapshot = syncEngine.getRenderSnapshot(
      toModuleFilePath("/test.val.ts"),
    );
    expect(renderSnapshot).toBe(null);

    unsubscribe();
  });

  test("setInitializedAt sets initializedAt and invalidates cache", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "test")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();

    const mockTimestamp = 1234567890;

    let initializedAtListenerCalled = false;
    const unsubscribe = syncEngine.subscribe("initialized-at")(() => {
      initializedAtListenerCalled = true;
    });

    syncEngine.setInitializedAt(mockTimestamp);

    expect(initializedAtListenerCalled).toBe(true);
    const initializedAtSnapshot = syncEngine.getInitializedAtSnapshot();
    expect(initializedAtSnapshot.data).toBe(mockTimestamp);

    unsubscribe();
  });

  test("setValModules adopts local schemas/sources and surfaces validation errors", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/server.val.ts", s.string(), "server")],
      config,
    );
    // Bare engine (no init) so adoptLocalSources seeds serverSources from the
    // local modules and the worker fallback can validate them synchronously.
    const engine = new ValSyncEngine(tester.createMockClient(), undefined);

    const invalid = c.define("/invalid.val.ts", s.string().minLength(5), "no");
    await engine.setValModules(makeValModules(config, [invalid]));

    expect(engine.getLocalModulesStatusSnapshot().type).toBe("loaded");
    expect(
      engine.getSchemaSnapshot(toModuleFilePath("/invalid.val.ts")).status,
    ).toBe("success");
    // minLength(5) on "no" must produce at least one validation error (jsdom
    // has no Worker, so validation runs on the main thread synchronously).
    const errors = engine.getAllValidationErrorsSnapshot();
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  test("schemaOutOfDate disables publish and is cleared when falling back to server", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "http",
      [c.define("/server.val.ts", s.string(), "server")],
      config,
    );
    const engine = await tester.createInitializedSyncEngine();
    expect(engine.getSchemaOutOfDateSnapshot()).toBe(false);
    expect(engine.getPublishDisabledSnapshot()).toBe(false);

    // Local schema SHA differs from the server's → schema is out of date.
    const local = c.define("/local.val.ts", s.string(), "local");
    await engine.setValModules(makeValModules(config, [local]));
    expect(engine.getSchemaOutOfDateSnapshot()).toBe(true);
    expect(engine.getPublishDisabledSnapshot()).toBe(true);

    // Falling back to server modules must clear the gate AND re-enable publish.
    await engine.setValModules(null);
    expect(engine.getSchemaOutOfDateSnapshot()).toBe(false);
    expect(engine.getPublishDisabledSnapshot()).toBe(false);
  });

  test("unsubscribing removes only that listener, on every path it subscribed to", async () => {
    // The unsubscribe closure used to splice by an index captured at subscribe
    // time. Indices drift as soon as anything else in the same bucket
    // unsubscribes first, and for the multi-path overload the paths array was
    // indexed with a listener index (p[idx] instead of p[i]) - so unsubscribing
    // one component removed another component's listener and left its own
    // behind, and the victim silently stopped re-rendering.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [
        c.define("/a.val.ts", s.string(), "a"),
        c.define("/b.val.ts", s.string(), "b"),
      ],
      config,
    );
    const engine = await tester.createInitializedSyncEngine();

    const pathsA = [toModuleFilePath("/a.val.ts")];
    const pathsAB = [
      toModuleFilePath("/a.val.ts"),
      toModuleFilePath("/b.val.ts"),
    ];

    let first = 0;
    let second = 0;
    let multi = 0;
    const unsubFirst = engine.subscribe(
      "patch-errors",
      pathsA,
    )(() => {
      first++;
    });
    const unsubMulti = engine.subscribe(
      "patch-errors",
      pathsAB,
    )(() => {
      multi++;
    });
    const unsubSecond = engine.subscribe(
      "patch-errors",
      pathsA,
    )(() => {
      second++;
    });

    // "patch-errors" is the only listener type with an array-path overload and
    // it has no public setter, so drive its emit directly.
    const emitFor = (path: ModuleFilePath) =>
      engine["invalidatePatchErrors"](path);

    // Drop the first listener: the two registered after it must be untouched.
    unsubFirst();
    emitFor(toModuleFilePath("/a.val.ts"));
    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(multi).toBe(1);

    // The multi-path listener must come off /b.val.ts too, not just /a.val.ts.
    unsubMulti();
    emitFor(toModuleFilePath("/b.val.ts"));
    expect(multi).toBe(1);

    emitFor(toModuleFilePath("/a.val.ts"));
    expect(second).toBe(2);
    expect(multi).toBe(1);

    unsubSecond();
    emitFor(toModuleFilePath("/a.val.ts"));
    expect(second).toBe(2);
  });

  test("a redeploy reset keeps existing subscribers alive", async () => {
    // reset() used to wipe the listener registry. `subscribe` closes over that
    // registry, so every mounted component ended up subscribed to an object
    // `emit` no longer read from and the UI silently froze for the rest of the
    // session.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "http",
      [c.define("/test.val.ts", s.string(), "Foo")],
      config,
    );
    const engine = await tester.createInitializedSyncEngine();

    let calls = 0;
    const unsubscribe = engine.subscribe("all-sources")(() => {
      calls++;
    });

    // A new version is deployed: the server now reports another schema SHA.
    const added = c.define("/added.val.ts", s.string(), "Added");
    tester.fakeModules.push(added);
    tester.fakeSchemas["/added.val.ts"] = Internal.getSchema(added)!;
    tester.fakeSources["/added.val.ts"] = Internal.getSource(added);

    expect(await tester.simulateStatCallback(engine)).toMatchObject({
      status: "done",
    });
    expect(calls).toBeGreaterThan(0);

    unsubscribe();
  });

  // Each subscription registers its OWN identity, so two subscriptions sharing
  // one callback stay independent.
  //
  // For the current array buckets this is already true by accident: registrations
  // of the same callback are interchangeable, so removing "the one equal to
  // `listener`" leaves the same number behind either way. It stops being an
  // accident the moment the buckets become Sets - a duplicate callback collapses
  // to one entry there, and the first unsubscribe would silence both
  // subscriptions. This test is the guard for that change.
  test("two subscriptions sharing one callback are independent", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [
        c.define("/a.val.ts", s.string().minLength(2), "a"),
        c.define("/b.val.ts", s.string().minLength(2), "b"),
      ],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();
    const a = toModuleFilePath("/a.val.ts");

    let calls = 0;
    const listener = () => {
      calls++;
    };
    const unsubscribeFirst = syncEngine.subscribe("sources", [a])(listener);
    syncEngine.subscribe("sources", [a])(listener);

    let generation = 0;
    // Each emit needs a distinct value: setSources only notifies on a change.
    const emit = () => {
      calls = 0;
      generation += 1;
      syncEngine.setSources({
        [a]: `next-${generation}`,
      } as Record<ModuleFilePath, JSONValue | undefined>);
      return calls;
    };

    // Two live subscriptions, two notifications.
    expect(emit()).toBe(2);
    unsubscribeFirst();
    // One left, so exactly one notification - not zero.
    expect(emit()).toBe(1);
  });

  test("the first stat does not reset the engine", async () => {
    // serverSideSchemaSha starts out null, so comparing it against the first
    // stat's SHA always looked like a change and forced a reset + recursive
    // init on every cold start.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "http",
      [c.define("/test.val.ts", s.string(), "Foo")],
      config,
    );
    const engine = new ValSyncEngine(tester.createMockClient(), undefined);

    // Assert on reset() directly. Observing the symptoms is not enough any
    // more: listeners survive a reset now, and a reset followed by the
    // recursive re-init restores the source too - so both of those would still
    // look healthy if the regression came back.
    const resetSpy = jest.spyOn(engine, "reset");

    let calls = 0;
    const unsubscribe = engine.subscribe("all-sources")(() => {
      calls++;
    });

    await engine.init(
      "http",
      tester.getBaseSha(),
      tester.getSchemasSha(),
      tester.getSourcesSha(),
      [],
      null,
      tester.getCommitSha(),
      tester.getNextNow(),
    );

    expect(resetSpy).not.toHaveBeenCalled();
    // Subscribed before init: the listener must have survived it.
    expect(calls).toBeGreaterThan(0);
    expect(
      engine.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
    ).toStrictEqual("Foo");

    resetSpy.mockRestore();
    unsubscribe();
  });

  test("out-of-order setValModules calls do not regress to a stale registry", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/server.val.ts", s.string(), "server")],
      config,
    );
    const engine = new ValSyncEngine(tester.createMockClient(), undefined);

    const moduleA = c.define("/a.val.ts", s.string(), "a");
    const moduleB = c.define("/b.val.ts", s.string(), "b");

    // A's extraction is held until we release it; B resolves immediately.
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const modulesA = makeValModules(
      config,
      [moduleA],
      [() => aGate.then(() => ({ default: moduleA }))],
    );
    const modulesB = makeValModules(config, [moduleB]);

    const pA = engine.setValModules(modulesA); // seq 1, awaiting aGate
    await engine.setValModules(modulesB); // seq 2, completes and adopts B
    releaseA();
    await pA; // A resolves last but must bail (superseded by B)

    // B must remain the adopted registry — A's late result is ignored.
    expect(engine.getLocalModulesStatusSnapshot().type).toBe("loaded");
    expect(engine.getSchemaSnapshot(toModuleFilePath("/b.val.ts")).status).toBe(
      "success",
    );
    expect(engine.getSchemaSnapshot(toModuleFilePath("/a.val.ts")).status).toBe(
      "module-schema-not-found",
    );
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

function makeValModules(
  config: ValConfig,
  modules: ValModule<SelectorSource>[],
  defs?: (() => Promise<{ default: ValModule<SelectorSource> }>)[],
): ValModules {
  return {
    config,
    modules: (
      defs ?? modules.map((m) => () => Promise.resolve({ default: m }))
    ).map((def) => ({ def })),
  };
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

class SyncEngineTester {
  fakeModules: any[];
  ops: JSONOps;
  fakePatches: {
    path: ModuleFilePath;
    patchId: PatchId;
    patch?: Patch;
    createdAt: string;
    authorId: null;
    appliedAt: null;
  }[];
  fakeSchemas: Record<string, any>;
  fakeSources: Record<string, any>;
  now: number;
  fakeResponses: Partial<FakeApi>;

  constructor(
    private mode: "fs" | "http",
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

  getMode() {
    return this.mode;
  }

  getSchemasSha() {
    // We could have used the way we do this in ValOps which is better (more stable), but this is simple and should work for the tests
    const textEncoder = new TextEncoder();
    return Internal.getSHA256Hash(
      textEncoder.encode(JSON.stringify(this.fakeSchemas)),
    );
  }

  getSourcesSha() {
    // We could have used the way we do this in ValOps which is better (more stable), but this is simple and should work for the tests
    const textEncoder = new TextEncoder();
    return Internal.getSHA256Hash(
      textEncoder.encode(JSON.stringify(this.fakeSources)),
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

  getAuthorId() {
    return "6e4d2995-ac82-4e29-8c23-25b859371a9a";
  }

  getCommitSha() {
    return "e83c5163316f89bfbde7d9ab23ca2e25604af290";
  }

  getSchema(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _req: InferReq<Api["/schema"]["GET"]["req"]>,
  ): z.infer<Api["/schema"]["GET"]["res"]> {
    const serializedSchemas = Object.fromEntries(
      Object.entries(this.fakeSchemas).map(([path, schema]) => {
        return [path, schema?.["executeSerialize"]()] as const;
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
                | Record<
                    PatchId,
                    {
                      message: string;
                    }
                  >
                | undefined;
              skipped?: PatchId[] | undefined;
            }
          | undefined;
        source?: any;
        render?: any;
        validationErrors?: Record<SourcePath, ValidationError[]> | undefined;
      }
    > = {};
    for (const patchData of this.fakePatches) {
      const { patch, patchId, path: moduleFilePath } = patchData;
      if (!patch) {
        continue;
      }
      // File ops carry binary content rather than document mutations, so
      // applyPatch rejects them outright. The real server filters them out the
      // same way before applying (see applySourceFilePatches in ValOps).
      const sourceFileOps = patch.filter((op) => op.op !== "file");
      const patchRes = applyPatch(
        deepClone(this.fakeSources[moduleFilePath]),
        this.ops,
        sourceFileOps,
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
        schema["executeValidate"](
          moduleFilePath as unknown as SourcePath,
          source,
        );
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
        sourcesSha: this.getSourcesSha(),
        schemaSha: this.getSchemasSha(),
      },
    };
  }

  postSave(
    req: InferReq<Api["/save"]["POST"]["req"]>,
  ): z.infer<Api["/save"]["POST"]["res"]> {
    // Model fs-mode /save: apply the requested patches to the backing sources
    // and then delete every patch (fs mode deletes all of them), so a
    // subsequent /patches read returns empty.
    const requestedPatchIds = new Set(req.body.patchIds);
    const savedSources = { ...this.fakeSources };
    const sourceFilePatchErrors: Record<ModuleFilePath, { message: string }[]> =
      {};
    for (const patchData of this.fakePatches) {
      if (!patchData.patch || !requestedPatchIds.has(patchData.patchId)) {
        continue;
      }
      // File ops carry binary content rather than document mutations: the real
      // /save writes those to disk separately and filters them out before
      // applying the rest (applyPatch errors on them). A file-only patch
      // therefore leaves the source untouched instead of failing to save.
      const sourceFileOps = patchData.patch.filter((op) => op.op !== "file");
      const patchRes = applyPatch(
        deepClone(savedSources[patchData.path]),
        this.ops,
        sourceFileOps,
      );
      if (patchRes.kind === "ok") {
        savedSources[patchData.path] = patchRes.value;
      } else {
        if (!sourceFilePatchErrors[patchData.path]) {
          sourceFilePatchErrors[patchData.path] = [];
        }
        sourceFilePatchErrors[patchData.path].push({
          message: patchRes.error.message,
        });
      }
    }
    if (Object.keys(sourceFilePatchErrors).length > 0) {
      // The real /save bails out before writing sources or deleting patches.
      return {
        status: 400,
        json: {
          message: "Failed to save patches",
          details: {
            sourceFilePatchErrors,
            binaryFilePatchErrors: {},
          },
        },
      };
    }
    this.fakeSources = savedSources;
    this.fakePatches = [];
    return {
      status: 200,
      json: {},
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
      if (route === "/save" && method === "POST") {
        return this.postSave(req);
      }
      return {
        status: 404,
        json: {
          message: `Invalid route ${route} with method ${
            method as string
          }. This is most likely a Val bug.`,
          path: route,
          method: method as string,
        },
      } satisfies ClientFetchErrors;
    };
  }

  async simulateStatCallback(valStore: ValSyncEngine) {
    const authorId = null;
    return await valStore.syncWithUpdatedStat(
      this.getMode(),
      this.getBaseSha(),
      this.getSchemasSha(),
      this.getSourcesSha(),
      this.fakePatches.map((p) => p.patchId),
      authorId,
      this.getCommitSha(),
      this.now++,
    );
  }

  async createInitializedSyncEngine() {
    const syncEngine = new ValSyncEngine(this.createMockClient(), undefined);
    const authorId = null;
    await syncEngine.init(
      this.getMode(),
      this.getBaseSha(),
      this.getSchemasSha(),
      this.getSourcesSha(),
      this.fakePatches.map((p) => p.patchId),
      authorId,
      this.getCommitSha(),
      this.now++,
    );
    return syncEngine;
  }

  simulatePassingOfSeconds(seconds: number) {
    this.now += seconds * 1000;
  }

  getNextNow() {
    return this.now++;
  }
}
