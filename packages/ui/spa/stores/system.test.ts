import { initVal } from "@valbuild/core/src/initVal";

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
    } = initTestSystem();
    const testPatches = {
      firstBatch: [],
    } satisfies Record<string, Patch[]>;
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
    const fieldListener = listeners.set('/test.val.ts?"field"');
    const nonVisibleFieldListener = listeners.set(
      '/test.val.ts?"nonVisibleField"',
    );
    const nonVisibleCheck1 = nonVisibleFieldListener.noMessages();
    stat.simulateExternal(testPatches.firstBatch); // patches are available in memory, and we simulate that stat receives them - simulate is only for testing external patch events
    await ledger.has({ type: "stat:receive", patches: testPatches.firstBatch });
    await ledger.has({
      type: "patch-receive",
      patches: testPatches.firstBatch,
    });
    await ledger.has({
      type: "source:patch-apply",
      success: testPatches.firstBatch,
    });
    await fieldListener.didReceive({
      type: "external-patch",
      // also exclusion so we can check if we did get something
    });
    const nonVisibleCheck2 = await nonVisibleFieldListener.noMessages({
      since: nonVisibleCheck1,
    });
    const head1 = await patchStore.getHead();
    expect(head1).toLooseEqual({
      // not sure if head needs to be this complicated?
      type: "external-complete", // external-complete, external-partial, external-failed?
      patch: testPatches.firstBatch.slice(-1)[0],
    });
    // When we get something from system, we need to pass in what we believe is the head
    // the reason we want to do this is to know when we need to compute
    const fieldResult1 = await sourceStore.get('/test.val.ts?"field"', head1);
    expect(fieldResult1).toEqual({
      status: "resolved-head", // if head was wrong: "resolved-out-of-date",
      data: "initial",
    });

    //
    await patchStore.createPatch(
      "/test.val.ts",
      [
        {
          type: "replace",
          path: "/field",
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
    const fieldValue2 = await sourceStore.get('/test.val.ts?"field"', head2);
    expect(fieldValue2).toEqual("updated");
    const nonVisibleCheck3 = await nonVisibleFieldListener.noMessages({
      since: nonVisibleCheck2,
    });

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
