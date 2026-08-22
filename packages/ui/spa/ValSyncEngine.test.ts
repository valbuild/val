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
  VAL_EXTENSION,
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

    // A field re-rendering after publish must NOT see the pre-patch value flicker
    // through. `publish` ends in `invalidateSource`, so this read genuinely
    // recomputes `getPatchedSource` - the same recompute HMR and the next sync's
    // source invalidation trigger. Without the fix it would recompute base "Foo"
    // plus no patches.
    expect(
      syncEngine.getSourceSnapshot(toModuleFilePath("/test.val.ts")).data,
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

  test("publishCount increments on a successful publish and notifies", async () => {
    // The compare view uses this as its reload key: if it does not move on a
    // publish, the view keeps showing the pre-publish diff; if it moves without
    // notifying, it moves too late to matter.
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "Foo")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();

    let notifications = 0;
    const unsubscribe = syncEngine.subscribe("published")(() => {
      notifications++;
    });
    expect(syncEngine.getPublishCountSnapshot()).toBe(0);

    syncEngine.addPatch(
      toSourcePath("/test.val.ts"),
      "string",
      [{ op: "replace", path: [], value: "FooBar" }],
      tester.getNextNow(),
    );
    const patchIds = syncEngine.getPendingClientSidePatchIdsSnapshot();
    expect(
      await syncEngine.publish(patchIds, undefined, tester.getNextNow()),
    ).toMatchObject({ status: "done" });

    expect(syncEngine.getPublishCountSnapshot()).toBe(1);
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
  });

  test("publishCount does not move when there is nothing to publish", async () => {
    const { s, c, config } = initVal();
    const tester = new SyncEngineTester(
      "fs",
      [c.define("/test.val.ts", s.string().minLength(2), "Foo")],
      config,
    );
    const syncEngine = await tester.createInitializedSyncEngine();

    expect(syncEngine.getPublishCountSnapshot()).toBe(0);
    await syncEngine.publish([], undefined, tester.getNextNow());
    // No patches, so no publish happened and the compare view must not reload.
    expect(syncEngine.getPublishCountSnapshot()).toBe(0);
  });

  test("publishCount survives reset so a reload key is never reused", async () => {
    // reset() clears derived state, but a reload key that repeats a value it
    // has already had reads as "no reload needed" - the compare view would keep
    // its stale trees. So this counter is deliberately NOT reset.
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
    await syncEngine.publish(
      syncEngine.getPendingClientSidePatchIdsSnapshot(),
      undefined,
      tester.getNextNow(),
    );
    expect(syncEngine.getPublishCountSnapshot()).toBe(1);

    syncEngine.reset();
    expect(syncEngine.getPublishCountSnapshot()).toBe(1);
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

  describe("source snapshot caching", () => {
    async function engineWithOneModule() {
      const { s, c, config } = initVal();
      const tester = new SyncEngineTester(
        "fs",
        [c.define("/a.val.ts", s.string().minLength(2), "a")],
        config,
      );
      return tester.createInitializedSyncEngine();
    }

    // The snapshot deep-clones the whole module. The cache key used to include
    // the calling component's creatorId, so N mounted fields meant N full clones
    // of the module on every keystroke. Reads must now share one clone.
    test("repeated reads share one snapshot until the module is invalidated", async () => {
      const syncEngine = await engineWithOneModule();
      const moduleFilePath = toModuleFilePath("/a.val.ts");

      const first = syncEngine.getSourceSnapshot(moduleFilePath);
      const second = syncEngine.getSourceSnapshot(moduleFilePath);
      expect(second).toBe(first);

      syncEngine.setSources({
        [moduleFilePath]: "next",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      const third = syncEngine.getSourceSnapshot(moduleFilePath);
      expect(third).not.toBe(first);
      expect(third.data).toStrictEqual("next");
    });

    // `optimistic` used to be baked into the cached snapshot, which is what forced
    // the per-creatorId key. It is a cheap array-tail comparison, so it is now
    // asked separately - and must still distinguish the editing component.
    test("isOptimisticFor distinguishes the component that made the last patch", async () => {
      const syncEngine = await engineWithOneModule();
      const moduleFilePath = toModuleFilePath("/a.val.ts");

      expect(syncEngine.isOptimisticFor(moduleFilePath, "mine")).toBe(false);

      syncEngine.addPatch(
        moduleFilePath,
        "string",
        [{ op: "replace", path: [], value: "edited" }],
        Date.now(),
        "mine",
      );

      expect(syncEngine.isOptimisticFor(moduleFilePath, "mine")).toBe(true);
      expect(syncEngine.isOptimisticFor(moduleFilePath, "theirs")).toBe(false);
      expect(syncEngine.isOptimisticFor(moduleFilePath)).toBe(false);
    });
  });

  describe("subscribe / unsubscribe", () => {
    async function engineWithTwoModules() {
      const { s, c, config } = initVal();
      const tester = new SyncEngineTester(
        "fs",
        [
          c.define("/a.val.ts", s.string().minLength(2), "a"),
          c.define("/b.val.ts", s.string().minLength(2), "b"),
        ],
        config,
      );
      return tester.createInitializedSyncEngine();
    }

    // Unsubscribe used to splice by an index captured at subscribe time, so
    // removing an EARLIER listener shifted every later index and detached the
    // wrong callback - leaking dead listeners and silencing live ones. Every
    // render re-subscribes (subscribe() returns a fresh closure), so this fired
    // constantly.
    // Removing the FIRST listener alone looked fine - the survivors were still
    // in the array, just shifted. The damage showed up on the next unsubscribe,
    // whose captured index now pointed at somebody else.
    test("unsubscribing two listeners removes those two, not a bystander", async () => {
      const syncEngine = await engineWithTwoModules();
      const calls: string[] = [];
      const unsubscribeFirst = syncEngine.subscribe("all-sources")(() => {
        calls.push("first");
      });
      const unsubscribeSecond = syncEngine.subscribe("all-sources")(() => {
        calls.push("second");
      });
      syncEngine.subscribe("all-sources")(() => {
        calls.push("third");
      });

      unsubscribeFirst();
      unsubscribeSecond();
      syncEngine.setSources({
        [toModuleFilePath("/a.val.ts")]: "next",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      expect(calls).toEqual(["third"]);
    });

    test("unsubscribing twice does not detach a different listener", async () => {
      const syncEngine = await engineWithTwoModules();
      const calls: string[] = [];
      const unsubscribeFirst = syncEngine.subscribe("all-sources")(() => {
        calls.push("first");
      });
      syncEngine.subscribe("all-sources")(() => {
        calls.push("second");
      });

      unsubscribeFirst();
      unsubscribeFirst();
      syncEngine.setSources({
        [toModuleFilePath("/a.val.ts")]: "next",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      expect(calls).toEqual(["second"]);
    });

    // The multi-path branch indexed the PATH array with a LISTENER index
    // (`listeners[type]?.[p[idx]]`), so it was only ever correct for a single
    // path holding a single listener.
    test("a multi-path subscription detaches from every path it registered on", async () => {
      const syncEngine = await engineWithTwoModules();
      const paths = [
        toModuleFilePath("/a.val.ts"),
        toModuleFilePath("/b.val.ts"),
      ];
      let kept = 0;
      let removed = 0;
      syncEngine.subscribe(
        "sources",
        paths,
      )(() => {
        kept++;
      });
      const unsubscribe = syncEngine.subscribe(
        "sources",
        paths,
      )(() => {
        removed++;
      });

      unsubscribe();
      syncEngine.setSources({
        [toModuleFilePath("/a.val.ts")]: "next-a",
        [toModuleFilePath("/b.val.ts")]: "next-b",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      expect(removed).toBe(0);
      expect(kept).toBeGreaterThan(0);
    });

    // Listeners live in a Set and are removed by identity, so the CALLER's
    // identity cannot be what is registered: a Set collapses the same function
    // to one entry, and then the first unsubscribe silences the other
    // subscription too. Each call registers its own wrapper instead.
    test("the same callback subscribed twice is two independent subscriptions", async () => {
      const syncEngine = await engineWithTwoModules();
      let calls = 0;
      const listener = () => {
        calls++;
      };
      syncEngine.subscribe("all-sources")(listener);
      const unsubscribeSecond = syncEngine.subscribe("all-sources")(listener);

      unsubscribeSecond();
      syncEngine.setSources({
        [toModuleFilePath("/a.val.ts")]: "next",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      // The surviving subscription still fires. Collapsing the two would leave
      // this at 0.
      expect(calls).toBeGreaterThan(0);
    });

    test("overlapping multi-path subscriptions of one callback unsubscribe independently", async () => {
      const syncEngine = await engineWithTwoModules();
      const a = toModuleFilePath("/a.val.ts");
      const b = toModuleFilePath("/b.val.ts");
      let calls = 0;
      const listener = () => {
        calls++;
      };
      // Same callback, overlapping paths: `a` is in both, so the `a` bucket
      // holds two registrations of one function.
      syncEngine.subscribe("sources", [a])(listener);
      const unsubscribeBoth = syncEngine.subscribe("sources", [a, b])(listener);

      unsubscribeBoth();
      syncEngine.setSources({
        [a]: "next-a",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      expect(calls).toBeGreaterThan(0);
    });

    // useSyncExternalStore re-subscribes whenever the subscribe function's
    // identity changes, and nearly every call site calls subscribe() inline in
    // render - so a fresh closure per call meant every render tore down and
    // re-added every subscription.
    test("the same (type, path) returns the same subscribe function", async () => {
      const syncEngine = await engineWithTwoModules();
      const a = toModuleFilePath("/a.val.ts");
      const b = toModuleFilePath("/b.val.ts");

      expect(syncEngine.subscribe("source", a)).toBe(
        syncEngine.subscribe("source", a),
      );
      expect(syncEngine.subscribe("all-sources")).toBe(
        syncEngine.subscribe("all-sources"),
      );
      expect(syncEngine.subscribe("sources", [a, b])).toBe(
        syncEngine.subscribe("sources", [a, b]),
      );

      // Different targets must stay distinct.
      expect(syncEngine.subscribe("source", a)).not.toBe(
        syncEngine.subscribe("source", b),
      );
      expect(syncEngine.subscribe("source", a)).not.toBe(
        syncEngine.subscribe("render", a),
      );
      expect(syncEngine.subscribe("sources", [a, b])).not.toBe(
        syncEngine.subscribe("sources", [b, a]),
      );
    });

    // A shared subscribe function must still hand every subscriber its own
    // unsubscribe.
    test("a memoised subscribe function still unsubscribes individually", async () => {
      const syncEngine = await engineWithTwoModules();
      const calls: string[] = [];
      const subscribe = syncEngine.subscribe("all-sources");
      const unsubscribeFirst = subscribe(() => {
        calls.push("first");
      });
      subscribe(() => {
        calls.push("second");
      });

      unsubscribeFirst();
      syncEngine.setSources({
        [toModuleFilePath("/a.val.ts")]: "next",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      expect(calls).toEqual(["second"]);
    });

    // React unmounts subscribers in response to a store change, so a listener
    // unsubscribing mid-emit is normal. Mutating the collection while iterating
    // it would skip whatever came after.
    test("a listener that unsubscribes during an emit does not skip the next one", async () => {
      const syncEngine = await engineWithTwoModules();
      const calls: string[] = [];
      const unsubscribeSelf = syncEngine.subscribe("all-sources")(() => {
        calls.push("first");
        unsubscribeSelf();
      });
      syncEngine.subscribe("all-sources")(() => {
        calls.push("second");
      });

      syncEngine.setSources({
        [toModuleFilePath("/a.val.ts")]: "next",
      } as Record<ModuleFilePath, JSONValue | undefined>);

      expect(calls).toEqual(["first", "second"]);
    });
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

  describe("overlay emissions (what the host app's client components see)", () => {
    const CONTENT = "/content.val.ts" as const;
    /** Longer than OVERLAY_EMIT_DEBOUNCE_MS. */
    const flushOverlay = () =>
      new Promise((resolve) => setTimeout(resolve, 150));

    function setupOverlay() {
      const { s, c, config } = initVal();
      const valModule = c.define(CONTENT, s.object({ title: s.string() }), {
        title: "published",
      });
      const tester = new SyncEngineTester("fs", [valModule], config);
      const emitted: { moduleFilePath: string; source: unknown }[] = [];
      // 2nd arg is the overlay emitter (3rd is the validation worker factory).
      const engine = new ValSyncEngine(
        tester.createMockClient(),
        (moduleFilePath, source) => {
          emitted.push({ moduleFilePath, source });
        },
      );
      return { tester, engine, emitted };
    }

    test("emits the PATCHED source, not the committed one", async () => {
      // Regression: the emitter was handed the raw `/sources/~` module, which the
      // Studio requests with apply_patches:false — so every client component in
      // the host app rendered committed content while the server components on the
      // same page rendered drafts.
      const { tester, engine, emitted } = setupOverlay();
      await engine.init(
        "fs",
        tester.getBaseSha(),
        tester.getSchemasSha(),
        tester.getSourcesSha(),
        [],
        null,
        tester.getCommitSha(),
        tester.getNextNow(),
      );
      emitted.length = 0;

      engine.addPatch(
        toSourcePath(CONTENT),
        "object",
        [{ op: "replace", path: ["title"], value: "edited" }],
        tester.getNextNow(),
      );
      await flushOverlay();

      expect(emitted).toEqual([
        { moduleFilePath: CONTENT, source: { title: "edited" } },
      ]);
    });

    test("a burst of edits is ONE emission", async () => {
      // Every keystroke invalidates the source, and every emission clones a whole
      // module and re-renders every subscribed client component.
      const { tester, engine, emitted } = setupOverlay();
      await engine.init(
        "fs",
        tester.getBaseSha(),
        tester.getSchemasSha(),
        tester.getSourcesSha(),
        [],
        null,
        tester.getCommitSha(),
        tester.getNextNow(),
      );
      emitted.length = 0;

      for (const value of ["a", "ab", "abc", "abcd"]) {
        engine.addPatch(
          toSourcePath(CONTENT),
          "object",
          [{ op: "replace", path: ["title"], value }],
          tester.getNextNow(),
        );
      }
      await flushOverlay();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].source).toEqual({ title: "abcd" });
    });

    test("the emitted source is a copy, not the engine's own object", async () => {
      const { tester, engine, emitted } = setupOverlay();
      await engine.init(
        "fs",
        tester.getBaseSha(),
        tester.getSchemasSha(),
        tester.getSourcesSha(),
        [],
        null,
        tester.getCommitSha(),
        tester.getNextNow(),
      );
      emitted.length = 0;
      engine.addPatch(
        toSourcePath(CONTENT),
        "object",
        [{ op: "replace", path: ["title"], value: "edited" }],
        tester.getNextNow(),
      );
      await flushOverlay();

      (emitted[0].source as { title: string }).title = "mutated by the host";
      expect(engine.getSourceSnapshot(toModuleFilePath(CONTENT)).data).toEqual({
        title: "edited",
      });
    });
  });

  describe("renders from client-side schema instances", () => {
    const PAGES = "/pages.val.ts" as const;

    function setupRenderModule() {
      const { s, c, config } = initVal();
      const valModule = c.define(
        PAGES,
        s.record(s.object({ title: s.string() })).render({
          as: "list",
          select: ({ val }) => ({ title: val.title.toUpperCase() }),
        }),
        { a: { title: "first" }, b: { title: "second" } },
      );
      const tester = new SyncEngineTester("fs", [valModule], config);
      return { tester, config, valModule };
    }

    function itemsOf(engine: ValSyncEngine) {
      const render = engine.getRenderSnapshot(toModuleFilePath(PAGES));
      const atModule = render?.[PAGES as unknown as SourcePath];
      if (!atModule || atModule.status !== "success") {
        return null;
      }
      const data = atModule.data;
      return data.layout === "list" && data.parent === "record"
        ? data.items
        : null;
    }

    test("the user's select runs: renders exist without any server render", async () => {
      // Regression: the SPA threw the schema INSTANCES away in setValModules and
      // re-derived a deserializeSchema copy, which has no `select` — so renders
      // were null Studio-wide and every list layout silently fell back.
      const { tester, config, valModule } = setupRenderModule();
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [valModule]));

      expect(itemsOf(engine)).toEqual([
        ["a", { title: "FIRST", subtitle: undefined, image: undefined }],
        ["b", { title: "SECOND", subtitle: undefined, image: undefined }],
      ]);
    });

    test("renders follow the PATCHED source, so a row updates as you type", async () => {
      const { tester, config, valModule } = setupRenderModule();
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [valModule]));

      engine.addPatch(
        toSourcePath(PAGES),
        "record",
        [{ op: "replace", path: ["a", "title"], value: "edited" }],
        tester.getNextNow(),
      );

      // Recomputed from the patched source — something the server render path
      // could never do, since the Studio always sends apply_patches:false.
      expect(itemsOf(engine)).toEqual([
        ["a", { title: "EDITED", subtitle: undefined, image: undefined }],
        ["b", { title: "SECOND", subtitle: undefined, image: undefined }],
      ]);
    });

    test("without local modules, renders fall back to what the server sent", async () => {
      const { tester } = setupRenderModule();
      const engine = await tester.createInitializedSyncEngine();
      // No setValModules → no instances. The server sends none either, so this is
      // today's behaviour: nothing to render, and nothing crashes.
      expect(engine.getRenderSnapshot(toModuleFilePath(PAGES))).toBe(null);

      const serverRender: ReifiedRender = {
        [PAGES as unknown as SourcePath]: {
          status: "success",
          data: { layout: "list", parent: "record", items: [] },
        },
      };
      engine.setRenders({ [toModuleFilePath(PAGES)]: serverRender });
      expect(engine.getRenderSnapshot(toModuleFilePath(PAGES))).toEqual(
        serverRender,
      );
    });

    test("a .jsonValues() record renders the entries that are loaded", async () => {
      const { s, c, config } = initVal();
      const valModule = c.define(
        PAGES,
        s
          .record(s.object({ title: s.string() }))
          .jsonValues()
          .render({
            as: "list",
            select: ({ val }) => ({ title: val.title }),
          }),
        {
          "/a": c.json(() => Promise.resolve({ default: { title: "A" } })),
          "/b": c.json(() => Promise.resolve({ default: { title: "B" } })),
        },
      );
      const tester = new SyncEngineTester("fs", [valModule], config);
      tester.fakeJsonEntries[PAGES] = {
        "/a": { title: "A" },
        "/b": { title: "B" },
      };
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [valModule]));

      // Nothing loaded: every value is still an opaque marker, so there is
      // nothing to select from — but the render must not throw or bail out.
      expect(itemsOf(engine)).toEqual([]);

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      // Partial by construction: exactly the loaded key. The list renders the
      // remaining keys as skeletons, which is what makes windowing free.
      expect(itemsOf(engine)).toEqual([
        ["/a", { title: "A", subtitle: undefined, image: undefined }],
      ]);

      await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
      expect(itemsOf(engine)).toEqual([
        ["/a", { title: "A", subtitle: undefined, image: undefined }],
        ["/b", { title: "B", subtitle: undefined, image: undefined }],
      ]);
    });
  });

  describe("custom validation (client-side, from schema instances)", () => {
    const CONTENT = "/content.val.ts" as const;
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** A module with BOTH a structural rule and a custom validator on one field. */
    function setupCustom() {
      const { s, c, config } = initVal();
      const valModule = c.define(
        CONTENT,
        s.object({
          title: s
            .string()
            .minLength(20)
            .validate((src) =>
              src.includes("forbidden")
                ? "the word forbidden is banned"
                : false,
            ),
        }),
        { title: "a long enough title" },
      );
      const tester = new SyncEngineTester("fs", [valModule], config);
      return { tester, config, valModule };
    }

    const messagesAt = (engine: ValSyncEngine, path: string) =>
      (engine.getAllValidationErrorsSnapshot()?.[path as SourcePath] ?? []).map(
        (error) => error.message,
      );

    test("does NOT run on boot: loading a project must not execute user code", async () => {
      // The trigger policy: custom validation is for updates (and pre-publish),
      // never the load path — otherwise every boot and every HMR runs arbitrary
      // user functions for every module.
      const { tester, config } = setupCustom();
      const { s, c } = initVal();
      const alreadyBad = c.define(
        CONTENT,
        s.object({
          title: s
            .string()
            .validate((src) =>
              src.includes("forbidden")
                ? "the word forbidden is banned"
                : false,
            ),
        }),
        { title: "forbidden content" },
      );
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [alreadyBad]));
      await flush();

      expect(messagesAt(engine, `${CONTENT}?p="title"`)).toEqual([]);
    });

    test("runs on update, and MERGES with the structural errors", async () => {
      const { tester, config, valModule } = setupCustom();
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [valModule]));

      // "forbidden words" is BOTH too short (minLength 20) and banned by the
      // user's validator, so both errors must end up at the same path: structural
      // comes from the worker and publishes first, custom is merged in after, and
      // a merge that replaced instead would drop one of them.
      engine.addPatch(
        toSourcePath(CONTENT),
        "object",
        [{ op: "replace", path: ["title"], value: "forbidden words" }],
        tester.getNextNow(),
      );
      await flush();
      const bothErrors = messagesAt(engine, `${CONTENT}?p="title"`);
      expect(bothErrors).toHaveLength(2);
      expect(bothErrors).toEqual(
        expect.arrayContaining([
          "the word forbidden is banned",
          expect.stringContaining("20"),
        ]),
      );

      // Fixing the custom violation leaves the structural one behind...
      engine.addPatch(
        toSourcePath(CONTENT),
        "object",
        [{ op: "replace", path: ["title"], value: "short" }],
        tester.getNextNow(),
      );
      await flush();
      expect(messagesAt(engine, `${CONTENT}?p="title"`)).toEqual([
        expect.stringContaining("20"),
      ]);

      // ...and fixing both clears the path entirely.
      engine.addPatch(
        toSourcePath(CONTENT),
        "object",
        [
          {
            op: "replace",
            path: ["title"],
            value: "a perfectly fine title",
          },
        ],
        tester.getNextNow(),
      );
      await flush();
      expect(messagesAt(engine, `${CONTENT}?p="title"`)).toEqual([]);
    });

    test("validateAll({custom}) surfaces errors with no edit at all", async () => {
      const { tester, config } = setupCustom();
      const { s, c } = initVal();
      const alreadyBad = c.define(
        CONTENT,
        s.object({
          title: s
            .string()
            .validate((src) =>
              src.includes("forbidden")
                ? "the word forbidden is banned"
                : false,
            ),
        }),
        { title: "forbidden content" },
      );
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [alreadyBad]));

      await engine.validateAll({ custom: true });
      expect(messagesAt(engine, `${CONTENT}?p="title"`)).toEqual([
        "the word forbidden is banned",
      ]);
    });

    test("a validator on a .jsonValues() item loads the entries it needs", async () => {
      // The needs-keys round: a validator cannot run against an opaque marker, so
      // the walk reports the keys and the engine loads them before executing.
      const { s, c, config } = initVal();
      const PAGES = "/pages.val.ts" as const;
      const valModule = c.define(
        PAGES,
        s
          .record(
            s.object({
              title: s
                .string()
                .validate((src) =>
                  src.includes("forbidden") ? "banned title" : false,
                ),
            }),
          )
          .jsonValues(),
        {
          "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
          "/b": c.json(() =>
            Promise.resolve({ default: { title: "forbidden" } }),
          ),
        },
      );
      const tester = new SyncEngineTester("fs", [valModule], config);
      tester.fakeJsonEntries[PAGES] = {
        "/a": { title: "ok" },
        "/b": { title: "forbidden" },
      };
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [valModule]));

      await engine.validateAll({ custom: true });
      await flush();

      // The offending entry was never opened by a user: it was loaded because the
      // validator could not be trusted without it.
      expect(messagesAt(engine, `${PAGES}?p="/b"."title"`)).toEqual([
        "banned title",
      ]);
      expect(messagesAt(engine, `${PAGES}?p="/a"."title"`)).toEqual([]);
    });

    test("validatePatchResult catches a custom-only violation, synchronously", async () => {
      // `executeValidate` on a real instance runs the node's custom validators
      // too, so the main thread's "would this patch validate?" check gets them for
      // free — where a deserialized copy would have said the patch is fine.
      const { tester, config, valModule } = setupCustom();
      const engine = new ValSyncEngine(tester.createMockClient(), undefined);
      await engine.setValModules(makeValModules(config, [valModule]));

      const res = engine.validatePatchResult(toModuleFilePath(CONTENT), [
        {
          op: "replace",
          path: ["title"],
          value: "a forbidden but long enough title",
        },
      ]);
      expect(res).not.toBe(false);
      expect(
        Object.values(res as Record<string, { message: string }[]>)
          .flat()
          .map((error) => error.message),
      ).toContain("the word forbidden is banned");
    });

    test("no instances (no <ValModulesClient>) ⇒ no custom validation, no crash", async () => {
      const { tester } = setupCustom();
      const engine = await tester.createInitializedSyncEngine();

      engine.addPatch(
        toSourcePath(CONTENT),
        "object",
        [{ op: "replace", path: ["title"], value: "forbidden words" }],
        tester.getNextNow(),
      );
      await flush();

      // Structural validation still works (the serialized schema is enough for
      // it), but the user's function cannot run without the real instance.
      const messages = messagesAt(engine, `${CONTENT}?p="title"`);
      expect(messages).toEqual([expect.stringContaining("20")]);
      expect(messages).not.toContain("the word forbidden is banned");
    });
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

  describe("jsonValues", () => {
    const PAGES = "/pages.val.ts" as const;

    /**
     * A `.jsonValues()` record module: the source only carries lazy markers, so
     * the engine must fetch each entry's content via GET /json.
     */
    function setupJsonValues() {
      const { s, c, config } = initVal();
      const schema = s
        .record(s.object({ title: s.string(), order: s.number() }))
        .jsonValues();
      const valModule = c.define(PAGES, schema, {
        "/a": c.json(() =>
          Promise.resolve({ default: { title: "A", order: 1 } }),
        ),
        "/b": c.json(() =>
          Promise.resolve({ default: { title: "B", order: 2 } }),
        ),
      });
      const tester = new SyncEngineTester("fs", [valModule as any], config);
      tester.fakeJsonEntries[PAGES] = {
        "/a": { title: "A", order: 1 },
        "/b": { title: "B", order: 2 },
      };
      return { tester, config };
    }

    /** Lets the `/json` promise chain settle. */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    test("requestJsonEntry substitutes the loaded content into the source", async () => {
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      // Before loading, the entry is an opaque marker.
      const before = engine.getSourceSnapshot(toModuleFilePath(PAGES))
        .data as any;
      expect(Internal.isJson(before["/a"])).toBe(true);

      engine.requestJsonEntry(toModuleFilePath(PAGES), "/a");
      await flush();

      const after = engine.getSourceSnapshot(toModuleFilePath(PAGES))
        .data as any;
      expect(after["/a"]).toEqual({ title: "A", order: 1 });
      // the un-requested entry is untouched
      expect(Internal.isJson(after["/b"])).toBe(true);
      expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(1);
    });

    test("a loaded entry is not refetched", async () => {
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();
      engine.requestJsonEntry(toModuleFilePath(PAGES), "/a");
      await flush();
      engine.requestJsonEntry(toModuleFilePath(PAGES), "/a");
      engine.requestJsonEntry(toModuleFilePath(PAGES), "/a");
      await flush();
      expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(1);
    });

    test("a failed load is memoized: no refetch loop, and an error is exposed", async () => {
      // Regression: a failing entry used to be refetched on every remount and
      // rendered a spinner forever, because nothing was cached on failure.
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      engine.requestJsonEntry(toModuleFilePath(PAGES), "/missing");
      await flush();

      expect(
        engine.getJsonEntryError(toModuleFilePath(PAGES), "/missing"),
      ).toContain("Entry not found");
      expect(tester.jsonRequestCounts[`${PAGES}\0/missing`]).toBe(1);

      // Subsequent requests must NOT hit the endpoint again.
      engine.requestJsonEntry(toModuleFilePath(PAGES), "/missing");
      engine.requestJsonEntry(toModuleFilePath(PAGES), "/missing");
      await flush();
      expect(tester.jsonRequestCounts[`${PAGES}\0/missing`]).toBe(1);
    });

    test("retryJsonEntry clears the memo and refetches", async () => {
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      engine.requestJsonEntry(toModuleFilePath(PAGES), "/late");
      await flush();
      expect(
        engine.getJsonEntryError(toModuleFilePath(PAGES), "/late"),
      ).not.toBe(null);

      // The entry shows up server-side, then the user retries.
      tester.fakeJsonEntries[PAGES]["/late"] = { title: "Late", order: 3 };
      engine.retryJsonEntry(toModuleFilePath(PAGES), "/late");
      await flush();

      expect(engine.getJsonEntryError(toModuleFilePath(PAGES), "/late")).toBe(
        null,
      );
      expect(tester.jsonRequestCounts[`${PAGES}\0/late`]).toBe(2);
    });

    test("publish refetches loaded entries (a published edit must not revert)", async () => {
      // Regression: jsonEntryContents was only cleared on init/reset. A
      // content-only edit does not change the module source (bare markers), so
      // sourcesSha is unchanged and nothing refetched — after publish the
      // pre-edit content was re-substituted and the edit looked reverted.
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      expect(
        (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
      ).toEqual({ title: "A", order: 1 });

      // Edit the entry, then publish. The fake server commits it: the entry's
      // *.val.json now holds the new content, the module source is unchanged.
      const res = engine.addPatch(
        toSourcePath(PAGES),
        "record",
        [{ op: "replace", path: ["/a", "title"], value: "A edited" }],
        tester.getNextNow(),
      );
      expect(res.status).toBe("patch-added");
      tester.simulatePassingOfSeconds(5);
      await engine.sync(tester.getNextNow());
      await flush();
      const patchIds = tester.fakePatches.map((p) => p.patchId);
      tester.fakeJsonEntries[PAGES]["/a"] = { title: "A edited", order: 1 };
      const requestsBeforePublish =
        tester.jsonRequestCounts[`${PAGES}\0/a`] ?? 0;

      expect(
        await engine.publish(patchIds, undefined, tester.getNextNow()),
      ).toMatchObject({ status: "done" });
      await flush();

      expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(
        requestsBeforePublish + 1,
      );
      expect(
        (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
      ).toEqual({ title: "A edited", order: 1 });
    });

    test("a failing entry keeps its error when OTHER entries are invalidated", async () => {
      // Regression: markJsonEntriesStale cleared the whole module's error memo,
      // including keys the refetch it starts does not cover (a key that has only
      // ever failed has no cached content). That left the key with no content, no
      // error and nothing in flight — a spinner with nothing to retry.
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      engine.requestJsonEntry(toModuleFilePath(PAGES), "/missing");
      await flush();
      expect(
        engine.getJsonEntryError(toModuleFilePath(PAGES), "/missing"),
      ).not.toBe(null);
      const requestsBefore = tester.jsonRequestCounts[`${PAGES}\0/a`] ?? 0;

      // A key appears on disk: the module source moved, so its loaded entries are
      // marked stale and refetched.
      tester.fakeSources[PAGES]["/c"] = { [VAL_EXTENSION]: "json" };
      tester.fakeJsonEntries[PAGES]["/c"] = { title: "C", order: 3 };
      tester.simulatePassingOfSeconds(5);
      await tester.simulateStatCallback(engine);
      await flush();

      // The loaded entry WAS refetched...
      expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(requestsBefore + 1);
      // ...and the failing one still reports its error, with a retry to offer.
      expect(
        engine.getJsonEntryError(toModuleFilePath(PAGES), "/missing"),
      ).not.toBe(null);
    });

    test("a saved edit never flashes back to the pre-edit content", async () => {
      // Regression: the source sync after the last keystroke kicks off an entry
      // refetch. Save it before that lands and the response — produced BEFORE
      // the save — was still written into jsonEntryContents, while the patches
      // that made the content current had just been dropped. Every subscriber
      // saw the edit revert, until the re-pass refetched and it came back.
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      engine.addPatch(
        toSourcePath(PAGES),
        "record",
        [{ op: "replace", path: ["/a", "title"], value: "A edited" }],
        tester.getNextNow(),
      );
      tester.simulatePassingOfSeconds(5);

      // Hold every /json response back from here on, so the refetch the source
      // sync below starts is still in flight when the save lands.
      let landJsonResponses = () => {};
      tester.jsonResponseGate = new Promise<void>((resolve) => {
        landJsonResponses = () => resolve();
      });
      await engine.sync(tester.getNextNow());
      const patchIds = tester.fakePatches.map((p) => p.patchId);

      // What a subscribed field would read, emission by emission.
      const seen: unknown[] = [];
      const unsubscribe = engine.subscribe(
        "source",
        toModuleFilePath(PAGES),
      )(() => {
        seen.push(
          (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
        );
      });

      // Saving commits the edit: the entry file on disk now holds it.
      tester.fakeJsonEntries[PAGES]["/a"] = { title: "A edited", order: 1 };
      expect(
        await engine.publish(patchIds, undefined, tester.getNextNow()),
      ).toMatchObject({ status: "done" });

      landJsonResponses();
      await flush();
      await flush();
      unsubscribe();

      // Without this the assertion below is vacuous: no emissions at all would
      // pass it, and the test would quietly stop covering anything.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen).not.toContainEqual({ title: "A", order: 1 });
      expect(
        (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
      ).toEqual({ title: "A edited", order: 1 });
    });

    test("an entry invalidated mid-flight is refetched (a stale response must not win)", async () => {
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      engine.addPatch(
        toSourcePath(PAGES),
        "record",
        [{ op: "replace", path: ["/a", "title"], value: "A edited" }],
        tester.getNextNow(),
      );
      tester.simulatePassingOfSeconds(5);
      await engine.sync(tester.getNextNow());
      const patchIds = tester.fakePatches.map((p) => p.patchId);

      // Publish WITHOUT letting the sync-triggered refetch settle first, so the
      // entry is invalidated while a request is still in flight. That in-flight
      // response predates the publish and must not be the final value.
      tester.fakeJsonEntries[PAGES]["/a"] = { title: "A edited", order: 1 };
      await engine.publish(patchIds, undefined, tester.getNextNow());
      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      await flush();

      expect(
        (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
      ).toEqual({ title: "A edited", order: 1 });
    });

    test("ensureJsonEntry resolves once content is loaded", async () => {
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/b");
      expect(
        (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/b"],
      ).toEqual({ title: "B", order: 2 });

      // Already loaded: resolves immediately, no second request.
      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/b");
      expect(tester.jsonRequestCounts[`${PAGES}\0/b`]).toBe(1);
    });

    test("an UNLOADED entry renamed by a pending patch still loads (rename then reload)", async () => {
      // Regression: after a reload, a pending rename leaves the *marker* under
      // the new key. Requesting that key from /json 404s, because the committed
      // source only knows the old key. The engine must map back to the base key
      // — loading it there also lets the move patch relocate the content.
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      // Rename WITHOUT ever loading the entry (as after a fresh page load).
      engine.addPatch(
        toSourcePath(PAGES),
        "record",
        [{ op: "move", from: ["/a"], path: ["/renamed"] }],
        tester.getNextNow(),
      );
      expect(
        Internal.isJson(
          (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)[
            "/renamed"
          ],
        ),
      ).toBe(true);

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/renamed");
      await flush();

      // Fetched under the BASE key, not the renamed one.
      expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(1);
      expect(tester.jsonRequestCounts[`${PAGES}\0/renamed`]).toBeUndefined();
      expect(
        engine.getJsonEntryError(toModuleFilePath(PAGES), "/renamed"),
      ).toBe(null);
      const source = engine.getSourceSnapshot(toModuleFilePath(PAGES))
        .data as any;
      expect(source["/a"]).toBeUndefined();
      expect(source["/renamed"]).toEqual({ title: "A", order: 1 });
    });

    test("a move patch on a loaded entry carries real content to the new key", async () => {
      const { tester } = setupJsonValues();
      const engine = await tester.createInitializedSyncEngine();

      await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
      engine.addPatch(
        toSourcePath(PAGES),
        "record",
        [{ op: "move", from: ["/a"], path: ["/renamed"] }],
        tester.getNextNow(),
      );

      const source = engine.getSourceSnapshot(toModuleFilePath(PAGES))
        .data as any;
      expect(source["/a"]).toBeUndefined();
      // real content, NOT an opaque marker
      expect(source["/renamed"]).toEqual({ title: "A", order: 1 });
    });

    describe("batch loading", () => {
      test("requestJsonEntries loads a window in ONE request", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        engine.requestJsonEntries(toModuleFilePath(PAGES), ["/a", "/b"]);
        await flush();

        const source = engine.getSourceSnapshot(toModuleFilePath(PAGES))
          .data as any;
        expect(source["/a"]).toEqual({ title: "A", order: 1 });
        expect(source["/b"]).toEqual({ title: "B", order: 2 });
        // Two keys, ONE HTTP request — the point of the batch.
        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(1);
      });

      test("already-loaded and in-flight keys are not refetched", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
        const batchesAfterFirstLoad = tester.jsonBatchRequestCounts[PAGES] ?? 0;
        // /a is cached; only /b should go out.
        engine.requestJsonEntries(toModuleFilePath(PAGES), ["/a", "/b"]);
        // Re-rendering the same window while it is in flight must add nothing.
        engine.requestJsonEntries(toModuleFilePath(PAGES), ["/a", "/b"]);
        await flush();

        expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(1);
        expect(tester.jsonRequestCounts[`${PAGES}\0/b`]).toBe(1);
        // Two window calls, ONE additional request.
        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(
          batchesAfterFirstLoad + 1,
        );
      });

      test("single-entry requests in the same tick collapse into ONE request", async () => {
        // Regression: a record list renders a <Preview> per key and each one
        // triggers requestJsonEntry for its own entry, so opening a record with N
        // entries fired N requests. They must coalesce.
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        engine.requestJsonEntry(toModuleFilePath(PAGES), "/a");
        engine.requestJsonEntry(toModuleFilePath(PAGES), "/b");
        await flush();

        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(1);
        const source = engine.getSourceSnapshot(toModuleFilePath(PAGES))
          .data as any;
        expect(source["/a"]).toEqual({ title: "A", order: 1 });
        expect(source["/b"]).toEqual({ title: "B", order: 2 });
      });

      test("keys that exist only in a pending patch are never requested", async () => {
        // They have no committed content: their value comes from the patch, so
        // asking /json would 404 and wrongly mark the row errored.
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        engine.addPatch(
          toSourcePath(PAGES),
          "record",
          [{ op: "add", path: ["/drafted"], value: { title: "D", order: 3 } }],
          tester.getNextNow(),
        );
        engine.requestJsonEntries(toModuleFilePath(PAGES), ["/drafted"]);
        await flush();

        expect(tester.jsonRequestCounts[`${PAGES}\0/drafted`]).toBeUndefined();
        expect(
          engine.getJsonEntryError(toModuleFilePath(PAGES), "/drafted"),
        ).toBe(null);
        expect(
          (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)[
            "/drafted"
          ],
        ).toEqual({ title: "D", order: 3 });
      });

      test("ensureJsonEntries loads every committed entry and reports complete", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        const res = await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        expect(res).toEqual({ complete: true, errors: [] });
        const source = engine.getSourceSnapshot(toModuleFilePath(PAGES))
          .data as any;
        expect(source["/a"]).toEqual({ title: "A", order: 1 });
        expect(source["/b"]).toEqual({ title: "B", order: 2 });
        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(1);

        // Fully cached: resolves without another request.
        expect(
          await engine.ensureJsonEntries([toModuleFilePath(PAGES)]),
        ).toEqual({ complete: true, errors: [] });
        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(1);
      });

      test("ensureJsonEntries reports NOT complete when an entry fails", async () => {
        // The whole point: a guard that gates a delete must never read a failed
        // load as "no references found".
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        delete tester.fakeJsonEntries[PAGES]["/b"];

        const res = await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        expect(res.complete).toBe(false);
        expect(res.errors).toHaveLength(1);
        expect(res.errors[0]).toMatchObject({
          moduleFilePath: PAGES,
          key: "/b",
        });
        // The entry that DID load is still usable.
        expect(
          (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
        ).toEqual({ title: "A", order: 1 });
      });

      test("progress counts up across the run and resets when it settles", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        expect(engine.getJsonEntriesProgressSnapshot()).toEqual({
          status: "idle",
          loaded: 0,
          total: 0,
          percentage: 100,
        });

        const done = engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        const during = engine.getJsonEntriesProgressSnapshot();
        expect(during.status).toBe("loading");
        expect(during.total).toBe(2);
        expect(during.loaded).toBe(0);
        expect(during.percentage).toBe(0);

        await done;
        // Nothing in flight: the run is over and the next one starts from zero.
        expect(engine.getJsonEntriesProgressSnapshot()).toEqual({
          status: "idle",
          loaded: 0,
          total: 0,
          percentage: 100,
        });
      });

      test("progress notifies subscribers", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        let notified = 0;
        const unsubscribe = engine.subscribe("json-entries-progress")(() => {
          notified++;
        });

        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        expect(notified).toBeGreaterThan(0);
        unsubscribe();
      });

      test("publish refetches loaded entries in ONE batch, not one request each", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);

        engine.addPatch(
          toSourcePath(PAGES),
          "record",
          [{ op: "replace", path: ["/a", "title"], value: "A edited" }],
          tester.getNextNow(),
        );
        tester.simulatePassingOfSeconds(5);
        await engine.sync(tester.getNextNow());
        await flush();
        const patchIds = tester.fakePatches.map((p) => p.patchId);
        tester.fakeJsonEntries[PAGES]["/a"] = { title: "A edited", order: 1 };
        // Measured from just before publish: the sync above also refreshes the
        // module's entries (its own single batch).
        const batchesBefore = tester.jsonBatchRequestCounts[PAGES] ?? 0;
        const keyRequestsBefore = {
          a: tester.jsonRequestCounts[`${PAGES}\0/a`] ?? 0,
          b: tester.jsonRequestCounts[`${PAGES}\0/b`] ?? 0,
        };

        expect(
          await engine.publish(patchIds, undefined, tester.getNextNow()),
        ).toMatchObject({ status: "done" });
        await flush();

        // BOTH cached entries were invalidated and refetched...
        expect(tester.jsonRequestCounts[`${PAGES}\0/a`]).toBe(
          keyRequestsBefore.a + 1,
        );
        expect(tester.jsonRequestCounts[`${PAGES}\0/b`]).toBe(
          keyRequestsBefore.b + 1,
        );
        // ...in ONE request, not one per entry.
        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(batchesBefore + 1);
        expect(
          (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
        ).toEqual({ title: "A edited", order: 1 });
      });
    });

    describe("hand-edited entry files (jsonEntriesSha)", () => {
      /**
       * A `*.val.json` edited on disk changes nothing the client can otherwise
       * see: the module source is markers, and both sourcesSha and baseSha hash
       * that source. FS mode therefore reports a separate fingerprint of the entry
       * FILES, and a change in it means "refetch what you have cached".
       */
      // Real shas: only the entry-file fingerprint may differ, or the engine takes
      // the reset+init path and there is nothing cached left to invalidate.
      const statArgs = (tester: SyncEngineTester, jsonEntriesSha?: string) =>
        [
          "fs" as const,
          tester.getBaseSha(),
          tester.getSchemasSha(),
          tester.getSourcesSha(),
          tester.fakePatches.map((p) => p.patchId),
          null,
          tester.getCommitSha(),
          tester.getNextNow(),
          jsonEntriesSha,
        ] as const;

      test("a changed fingerprint refetches the cached entries", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        const batchesBefore = tester.jsonBatchRequestCounts[PAGES] ?? 0;

        // First stat carrying a fingerprint: nothing to invalidate yet.
        await engine.syncWithUpdatedStat(...statArgs(tester, "fingerprint-1"));
        await flush();
        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(batchesBefore);

        // Someone edits an entry file on disk → the fingerprint moves.
        tester.fakeJsonEntries[PAGES]["/a"] = {
          title: "edited on disk",
          order: 1,
        };
        await engine.syncWithUpdatedStat(...statArgs(tester, "fingerprint-2"));
        await flush();

        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(batchesBefore + 1);
        expect(
          (engine.getSourceSnapshot(toModuleFilePath(PAGES)).data as any)["/a"],
        ).toEqual({ title: "edited on disk", order: 1 });
      });

      test("an unchanged fingerprint refetches nothing", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);

        await engine.syncWithUpdatedStat(...statArgs(tester, "fingerprint-1"));
        await flush();
        const batchesAfterFirst = tester.jsonBatchRequestCounts[PAGES] ?? 0;

        await engine.syncWithUpdatedStat(...statArgs(tester, "fingerprint-1"));
        await engine.syncWithUpdatedStat(...statArgs(tester, "fingerprint-1"));
        await flush();

        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(batchesAfterFirst);
      });

      test("no fingerprint at all (http mode) changes nothing", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        const batchesBefore = tester.jsonBatchRequestCounts[PAGES] ?? 0;

        await engine.syncWithUpdatedStat(...statArgs(tester, undefined));
        await engine.syncWithUpdatedStat(...statArgs(tester, undefined));
        await flush();

        expect(tester.jsonBatchRequestCounts[PAGES]).toBe(batchesBefore);
      });
    });

    describe("load status (what a reference guard reads)", () => {
      test("incomplete until EVERY entry is loaded", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]),
        ).toEqual({ status: "incomplete", errors: [] });

        // A partially loaded record is still incomplete: a scan over it would
        // miss whatever the un-loaded entry holds.
        await engine.ensureJsonEntry(toModuleFilePath(PAGES), "/a");
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]).status,
        ).toBe("incomplete");

        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]),
        ).toEqual({ status: "complete", errors: [] });
      });

      test("no modules to load is complete (the common case: no requests at all)", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        expect(engine.getJsonEntriesLoadStatus([])).toEqual({
          status: "complete",
          errors: [],
        });
        expect(tester.jsonBatchRequestCounts[PAGES]).toBeUndefined();
      });

      test("a module whose source has not synced yet is incomplete", async () => {
        // Its key set is unknown, so "complete" would be a guess. Transient: boot
        // syncs every module's source.
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        expect(
          engine.getJsonEntriesLoadStatus([
            "/not-synced.val.ts" as ModuleFilePath,
          ]).status,
        ).toBe("incomplete");
      });

      test("a NULL jsonValues record has no entries to load (not incomplete forever)", async () => {
        // A nullable record whose value is null is not a record to enumerate. If
        // that read as incomplete, every guard depending on this module would sit
        // at "checking references" with no way to ever finish.
        const { s, c, config } = initVal();
        const valModule = c.define(
          PAGES,
          s
            .record(s.object({ title: s.string() }))
            .jsonValues()
            .nullable(),
          null,
        );
        const tester = new SyncEngineTester("fs", [valModule], config);
        const engine = await tester.createInitializedSyncEngine();

        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]),
        ).toEqual({ status: "complete", errors: [] });
        expect(
          await engine.ensureJsonEntries([toModuleFilePath(PAGES)]),
        ).toEqual({ complete: true, errors: [] });
      });

      test("a failed entry is an ERROR, never a quiet 'complete'", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        delete tester.fakeJsonEntries[PAGES]["/b"];

        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        const status = engine.getJsonEntriesLoadStatus([
          toModuleFilePath(PAGES),
        ]);
        expect(status.status).toBe("error");
        expect(status.errors).toHaveLength(1);
        expect(status.errors[0]).toMatchObject({
          moduleFilePath: PAGES,
          key: "/b",
        });
      });

      test("retryJsonEntries clears the failures and gets back to complete", async () => {
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();
        delete tester.fakeJsonEntries[PAGES]["/b"];

        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]).status,
        ).toBe("error");

        // Without clearing the memo, ensureJsonEntries would skip the failed key
        // forever (that memo is what stops the refetch loop).
        expect(
          await engine.ensureJsonEntries([toModuleFilePath(PAGES)]),
        ).toMatchObject({ complete: false });

        tester.fakeJsonEntries[PAGES]["/b"] = { title: "B", order: 2 };
        expect(
          await engine.retryJsonEntries([toModuleFilePath(PAGES)]),
        ).toEqual({ complete: true, errors: [] });
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]),
        ).toEqual({ status: "complete", errors: [] });
      });

      test("a publish makes it incomplete again until the refetch lands", async () => {
        // V15: the guard must not answer from content the publish invalidated.
        // The refetch clears the stale flag when it STARTS, so "not stale" alone
        // would read as complete while the old content is still in hand.
        const { tester } = setupJsonValues();
        const engine = await tester.createInitializedSyncEngine();

        await engine.ensureJsonEntries([toModuleFilePath(PAGES)]);
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]).status,
        ).toBe("complete");

        engine.addPatch(
          toSourcePath(PAGES),
          "record",
          [{ op: "replace", path: ["/a", "title"], value: "A edited" }],
          tester.getNextNow(),
        );
        tester.simulatePassingOfSeconds(5);
        await engine.sync(tester.getNextNow());
        await flush();
        const patchIds = tester.fakePatches.map((p) => p.patchId);
        tester.fakeJsonEntries[PAGES]["/a"] = { title: "A edited", order: 1 };

        await engine.publish(patchIds, undefined, tester.getNextNow());
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]).status,
        ).toBe("incomplete");

        await flush();
        expect(
          engine.getJsonEntriesLoadStatus([toModuleFilePath(PAGES)]).status,
        ).toBe("complete");
      });
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
  "/json": {
    GET: z.infer<Api["/json"]["GET"]["res"]> | ClientFetchErrors | null;
  };
  "/save": {
    POST: z.infer<Api["/save"]["POST"]["res"]> | ClientFetchErrors | null;
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
  /** Committed `.jsonValues()` entry content, by module then entry key. */
  fakeJsonEntries: Record<string, Record<string, unknown>> = {};
  /** How many times GET /json was called, keyed `${path}\0${key}`. */
  jsonRequestCounts: Record<string, number> = {};
  /** HTTP requests (not keys) served by the batch shapes of `/json`, per module. */
  jsonBatchRequestCounts: Record<string, number> = {};
  /**
   * Holds every `/json` response back until it resolves. Lets a test pin the
   * order two in-flight requests land in — which is otherwise a race, and the
   * race is what a response-ordering regression hides behind.
   */
  jsonResponseGate: Promise<void> | null = null;

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

  getJson(
    req: InferReq<Api["/json"]["GET"]["req"]>,
  ): z.infer<Api["/json"]["GET"]["res"]> {
    const path = req.query.path;
    const { key, keys, offset, limit } = req.query;
    const countKey = (k: string) => {
      this.jsonRequestCounts[`${path}\0${k}`] =
        (this.jsonRequestCounts[`${path}\0${k}`] ?? 0) + 1;
    };
    const available = this.fakeJsonEntries[path];
    if (key !== undefined) {
      countKey(key);
      if (available === undefined || !(key in available)) {
        return {
          status: 404,
          json: { message: `Entry not found: ${key} in ${path}` },
        };
      }
      return {
        status: 200,
        json: {
          path: path as ModuleFilePath,
          key,
          content: available[key],
        },
      };
    }
    // Batch shapes: one HTTP request, per-key outcomes.
    this.jsonBatchRequestCounts[path] =
      (this.jsonBatchRequestCounts[path] ?? 0) + 1;
    const allKeys = Object.keys(available ?? {});
    const isWindow = offset !== undefined && limit !== undefined;
    const requestedKeys = isWindow
      ? allKeys.slice(offset, offset + limit)
      : keys;
    if (requestedKeys === undefined) {
      return {
        status: 400,
        json: {
          message:
            "Exactly one of 'key', 'keys' or 'offset'+'limit' must be given",
        },
      };
    }
    const entries: { key: string; content: unknown }[] = [];
    const missing: string[] = [];
    for (const requestedKey of requestedKeys) {
      countKey(requestedKey);
      if (available !== undefined && requestedKey in available) {
        entries.push({ key: requestedKey, content: available[requestedKey] });
      } else {
        missing.push(requestedKey);
      }
    }
    return {
      status: 200,
      json: {
        path: path as ModuleFilePath,
        entries,
        missing,
        errors: [],
        ...(isWindow ? { offset, limit } : {}),
        total: allKeys.length,
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

  /**
   * The entry key an op targets, or `null` when it is a plain module-source op.
   * Classified off the committed module source: a `{_type:"json"}` marker at the
   * first segment is what makes that segment a `.jsonValues()` entry key.
   */
  private jsonEntryKeyOf(
    moduleFilePath: ModuleFilePath,
    opPath: string[],
  ): string | null {
    const source = this.fakeSources[moduleFilePath];
    const key = opPath[0];
    if (
      key === undefined ||
      source === null ||
      typeof source !== "object" ||
      Array.isArray(source)
    ) {
      return null;
    }
    return Internal.isJson(source[key]) ? key : null;
  }

  postSave(
    req: InferReq<Api["/save"]["POST"]["req"]>,
  ): z.infer<Api["/save"]["POST"]["res"]> {
    // Model fs-mode /save: apply the requested patches to the backing sources
    // and then delete every patch (fs mode deletes all of them), so a
    // subsequent /patches read returns empty.
    const requestedPatchIds = new Set(req.body.patchIds);
    const savedSources = { ...this.fakeSources };
    // A `.jsonValues()` entry's value lives in its own `*.val.json`, so an op
    // below an entry key rewrites THAT file and leaves the module source
    // byte-identical — which is what ValOps does server-side, and what makes a
    // content-only save invisible to sourcesSha.
    const savedJsonEntries: Record<
      string,
      Record<string, unknown>
    > = Object.fromEntries(
      Object.entries(this.fakeJsonEntries).map(([path, entries]) => [
        path,
        { ...entries },
      ]),
    );
    const sourceFilePatchErrors: Record<ModuleFilePath, { message: string }[]> =
      {};
    for (const patchData of this.fakePatches) {
      if (!patchData.patch || !requestedPatchIds.has(patchData.patchId)) {
        continue;
      }
      const moduleFilePath = patchData.path;
      const pushError = (message: string) => {
        if (!sourceFilePatchErrors[moduleFilePath]) {
          sourceFilePatchErrors[moduleFilePath] = [];
        }
        sourceFilePatchErrors[moduleFilePath].push({ message });
      };
      // File ops carry binary content rather than document mutations: the real
      // /save writes those to disk separately and filters them out before
      // applying the rest (applyPatch errors on them). A file-only patch
      // therefore leaves the source untouched instead of failing to save.
      const sourceFileOps: Patch = [];
      for (const op of patchData.patch) {
        if (op.op === "file") {
          continue;
        }
        const entryKey = this.jsonEntryKeyOf(moduleFilePath, op.path);
        if (entryKey === null) {
          sourceFileOps.push(op);
          continue;
        }
        const entries = savedJsonEntries[moduleFilePath];
        if (op.path.length > 1) {
          // Content op: rebase off the entry key and apply to the entry's file.
          const content = entries?.[entryKey];
          if (entries === undefined || content === undefined) {
            pushError(
              `No entry content for '${entryKey}' in ${moduleFilePath}`,
            );
            continue;
          }
          const rebased = {
            ...op,
            path: op.path.slice(1),
            ...("from" in op ? { from: op.from.slice(1) } : {}),
          } as Patch[number];
          const res = applyPatch(deepClone(content as JSONValue), this.ops, [
            rebased,
          ]);
          if (res.kind === "ok") {
            entries[entryKey] = res.value;
          } else {
            pushError(res.error.message);
          }
          continue;
        }
        // Whole-entry op. `replace` rewrites only the file (the thunk stays);
        // everything else also rewrites the `.val.ts`, so the marker moves with
        // it via `sourceFileOps`.
        if (entries === undefined) {
          savedJsonEntries[moduleFilePath] = {};
        }
        const entryFiles = savedJsonEntries[moduleFilePath];
        if (op.op === "replace") {
          entryFiles[entryKey] = op.value;
          continue;
        }
        if (op.op === "remove") {
          delete entryFiles[entryKey];
          sourceFileOps.push(op);
          continue;
        }
        if (op.op === "move" || op.op === "copy") {
          const fromKey = op.from[0];
          if (op.from.length !== 1 || fromKey === undefined) {
            pushError(
              `Cannot '${op.op}' a jsonValues entry from '${op.from.join(".")}'`,
            );
            continue;
          }
          entryFiles[entryKey] = entryFiles[fromKey];
          if (op.op === "move") {
            delete entryFiles[fromKey];
          }
          sourceFileOps.push(op);
          continue;
        }
        // `add`: a new `*.val.json` plus a `c.json(...)` thunk, so the module
        // source gains a MARKER rather than the content itself.
        entryFiles[entryKey] = op.value;
        sourceFileOps.push({
          ...op,
          value: { [VAL_EXTENSION]: "json" } as unknown as typeof op.value,
        });
      }
      if (sourceFileOps.length > 0) {
        const patchRes = applyPatch(
          deepClone(savedSources[moduleFilePath]),
          this.ops,
          sourceFileOps,
        );
        if (patchRes.kind === "ok") {
          savedSources[moduleFilePath] = patchRes.value;
        } else {
          pushError(patchRes.error.message);
        }
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
    this.fakeJsonEntries = savedJsonEntries;
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
      if (route === "/json" && method === "GET") {
        // Computed eagerly, so the request is counted when it is issued rather
        // than when the gate below lets the response through.
        const res = this.getJson(req);
        // NOTE: must be a Promise — the sync engine calls `.then()` on it.
        return this.jsonResponseGate === null
          ? Promise.resolve(res)
          : this.jsonResponseGate.then(() => res);
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
