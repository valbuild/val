import { initVal } from "@valbuild/core";
import {
  externalPatch,
  initTestSystem,
  patchIds,
  type Cursor,
} from "./testSystem";
import type { PatchRecord } from "./types";

describe("store test rig", () => {
  it("todo smoke test", async () => {
    const { c, s } = initVal();
    const {
      sourceStore,
      patchStore,
      stat,
      // ledger and listeners are only in test system, the stores are special test instances that have extra methods not used / needed by the real stores
      ledger,
      listeners,
      dispose,
    } = initTestSystem();
    const testPatches = {
      firstBatch: [
        externalPatch("external-1", "/test.val.ts", [
          { op: "replace", path: ["field"], value: "external" },
        ]),
      ],
    } satisfies Record<string, PatchRecord[]>;
    await sourceStore.testReceive([
      c.define(
        "/test.val.ts",
        s.object({ field: s.string(), nonVisibleField: s.string() }),
        {
          field: "initial",
          nonVisibleField: "initial",
        },
      ),
    ]);
    await ledger.has({ type: "source:init", sources: ["/test.val.ts"] });

    // Reading before any patch: the head is empty, and the value is the source
    // as defined. This is the baseline the external patch below moves off.
    const emptyHead = await patchStore.getHead();
    expect(emptyHead).toMatchObject({ type: "empty" });
    // `null`, not `emptyHead`. The head passed to `get` is a claim about what the
    // caller has already INCORPORATED, so the only two legal values are `null`
    // ("I hold nothing") and a head a previous `get` returned. Quoting a head
    // obtained any other way — `getHead()`, say — asserts something untrue, and
    // the store will answer `unchanged` to a caller that has nothing.
    expect(await sourceStore.get('/test.val.ts?p="field"', null)).toMatchObject(
      {
        status: "resolved-head",
        data: "initial",
      },
    );

    const fieldListener = listeners.set('/test.val.ts?p="field"');
    const nonVisibleFieldListener = listeners.set(
      '/test.val.ts?p="nonVisibleField"',
    );
    const nonVisibleCheck1: Cursor = await nonVisibleFieldListener.noMessages();
    stat.simulateExternal(testPatches.firstBatch); // patches are available in memory, and we simulate that stat receives them - simulate is only for testing external patch events
    await ledger.has({
      type: "stat:receive",
      patches: patchIds(testPatches.firstBatch),
    });
    await ledger.has({
      type: "patch:receive",
      patches: patchIds(testPatches.firstBatch),
    });
    await ledger.has({
      type: "source:patch-apply",
      success: patchIds(testPatches.firstBatch),
    });
    await fieldListener.didReceive({
      type: "external-patch",
      // also exclusion so we can check if we did get something
    });
    const nonVisibleCheck2 = await nonVisibleFieldListener.noMessages({
      since: nonVisibleCheck1,
    });
    const head1 = await patchStore.getHead();
    expect(head1).toMatchObject({
      // not sure if head needs to be this complicated?
      type: "external-complete", // external-complete, external-partial, external-failed?
      patch: testPatches.firstBatch.slice(-1)[0],
    });
    // Quoting nothing gets the value, and the REVISION it was computed at. The
    // patch head is not the comparator: it describes the chain, and the chain
    // cannot see a base-source replacement.
    const fieldResult1 = await sourceStore.get('/test.val.ts?p="field"', null);
    expect(fieldResult1).toMatchObject({
      status: "resolved-head",
      data: "external",
      revision: { module: "/test.val.ts" },
    });
    if (fieldResult1.status !== "resolved-head") {
      throw new Error("expected a value");
    }

    // Quoting the revision just handed back gets the cheap answer: what you hold
    // is right, and no value is marshalled. That is the only reason to pass one.
    expect(
      await sourceStore.get('/test.val.ts?p="field"', fieldResult1.revision),
    ).toMatchObject({ status: "unchanged" });

    // And a read quoting a revision the module has moved past is ANSWERED, not
    // refused. The earlier protocol refused and made the caller re-ask, which
    // needed a retry cap and was the one way this design could hang. A reader
    // with two reads in flight keeps the newest revision it accepted and drops
    // the rest — see `isNewerRevision`.
    expect(
      await sourceStore.get('/test.val.ts?p="field"', {
        module: fieldResult1.revision.module,
        n: fieldResult1.revision.n - 1,
      }),
    ).toMatchObject({
      status: "resolved-head",
      data: "external",
      revision: { module: "/test.val.ts" },
    });

    //
    await patchStore.createPatch(
      "/test.val.ts",
      [
        {
          op: "replace",
          path: ["field"],
          value: "updated",
        },
      ],
      {
        // optionally add more testing data which we can use to explore behavior in the system
        author: "test",
      },
    );
    await fieldListener.didReceive({
      type: "internal-patch",
    });
    const head2 = await patchStore.getHead();
    expect(head2).toMatchObject({ type: "internal-complete" });
    const fieldValue2 = await sourceStore.get('/test.val.ts?p="field"', null);
    expect(fieldValue2).toMatchObject({
      status: "resolved-head",
      data: "updated",
    });
    const nonVisibleCheck3 = await nonVisibleFieldListener.noMessages({
      since: nonVisibleCheck2,
    });
    expect(nonVisibleCheck3).toBe(0);

    // A path that is genuinely not in the source is `absent`, which is a
    // different answer from "the module has not loaded" — the whole reason the
    // two statuses are separate.
    expect(
      await sourceStore.get('/test.val.ts?p="missing"', null),
    ).toMatchObject({ status: "absent" });
    expect(await sourceStore.get('/other.val.ts?p="field"', null)).toEqual({
      status: "module-loading",
    });

    dispose();

    // Example search index testing:
    // await searchStore.buildIndex();
    // await ledger.has(
    //   { type: "search:build-index" },
    //   {
    //     excludeSince: ledgerPositionPreIndex,
    //   },
    // );
    // await ledger.has(
    //   {
    //     type: "search:build-index",
    //     new: ["/test.val.ts"],
    //     all: ["/test.val.ts"], // optional
    //   },
    //   {
    //     excludeSince: ledgerPositionPreIndex,
    //   },
    // Other stores of interest: validation errors, patch-set, search, ... also have test methods
  });
});
