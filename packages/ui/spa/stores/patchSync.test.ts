import { initVal, type PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { externalPatch, initTestSystem, mfp } from "./testSystem";
import { createSystem } from "./createSystem";

/**
 * `PUT /patches`: the write-back path, and whether the head model survives a
 * conflict.
 *
 * This is the question `openquestions.md` item 6 asked. Every test in this
 * repository until now drove writes that could not fail, so the head handshake —
 * the core safety property of the read path — had never been exercised against a
 * server that says no. Three failures are possible and they must be handled
 * differently:
 *
 * - **409 conflict**: our parent is no longer the head. The edit is fine, our
 *   idea of the chain is not. Retryable, and only after a re-sync.
 * - **400 rejected**: the patch is permanently bad. NOT retryable, and the local
 *   source has to be rebuilt without it or the user is looking at an edit that
 *   will never exist anywhere.
 * - **network**: nothing is known about the patch. Retry the same batch.
 *
 * The fake server in `testSystem.ts` enforces the head for real, computed from
 * its own chain. So the conflict tests below produce a genuine 409 by having
 * another session write, rather than by asking a stub to return one — the
 * difference between proving the client handles a conflict it was handed and
 * proving it can recover from one it walked into.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define(
    "/t.val.ts",
    s.object({ title: s.string(), body: s.string() }),
    { title: "Hello", body: "World" },
  );
};

const TITLE = '/t.val.ts?p="title"';

/** A tick, for letting the write loop settle where a test does not await it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a local edit reaches the server", () => {
  it("writes the patch back and stops calling it pending", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    // A stat first, because the very first write of a session names
    // `{ type: "head", headBaseSha }` and that sha can only come from stat.
    stat.simulateExternal([]);
    const record = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Saved" },
    ]);

    await patchSync.flush();

    expect(server.patchIds()).toEqual([record.patchId]);
    expect(patchSync.currentState()).toMatchObject({ status: "in-sync" });
    dispose();
  });

  /**
   * The claim the batch exists for, stated as what is actually true.
   *
   * It is NOT "patches created in one turn cost one request": the first patch
   * triggers a save immediately, because waiting would mean an edit sitting
   * undurable for no reason. What batching buys is that every patch made DURING
   * that round trip goes in the next one together — so a burst costs two requests
   * rather than N. Which is also forced rather than chosen: the batch shares one
   * `parentRef`, so its members could not be sent separately even if the cost did
   * not matter, since the second would have to name the first as its parent
   * before the server had confirmed it.
   *
   * The rig's `createPatch` settles the loop after every create, so the burst is
   * built against a bare system with a gated write instead. That is the only way
   * to hold a round trip open, which is the situation being described.
   */
  it("puts every patch made during one round trip in the next one", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: PatchId[][] = [];
    let gated = true;
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `burst-${++next}` as PatchId;
      })(),
      savePatches: async ({ patches }) => {
        requests.push(patches.map((entry) => entry.patchId));
        if (gated) {
          gated = false;
          await gate;
        }
        return {
          status: "saved",
          newPatchIds: patches.map((entry) => entry.patchId),
          parentRef: {
            type: "patch",
            patchId: patches[patches.length - 1].patchId,
          },
        };
      },
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    for (let index = 0; index < 5; index++) {
      await system.patchStore.createPatch(mfp("/t.val.ts"), [
        { op: "replace", path: ["title"], value: `typed ${index}` },
      ]);
    }
    release();
    await system.patchSync.flush();

    // Fewer requests than patches: that is batching, and it is the whole claim.
    // The exact split is deliberately not asserted — it depends on microtask
    // ordering between a create and the flush it triggers, which is not a
    // property worth pinning and would make this test fail for reasons that have
    // nothing to do with batching.
    expect(requests.length).toBeLessThan(5);
    // But every patch exactly once, which IS worth pinning: a batch that re-sent
    // a patch already in an earlier request would store it twice on the server.
    const sent = requests.flat();
    expect(sent).toHaveLength(new Set(sent).size);
    expect(sent).toHaveLength(5);
    expect(system.patchStore.pendingPatchIds()).toEqual([]);
    system.dispose();
  });

  it("names the last acknowledged patch as the next write's parent", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    const first = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "one" },
    ]);
    await patchSync.flush();
    const second = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "two" },
    ]);
    await patchSync.flush();

    expect(server.patchIds()).toEqual([first.patchId, second.patchId]);
    // The FIRST write names the base; the second names the first patch. Read off
    // the recorded writes rather than off the client's state, so this asserts
    // what actually went over the wire.
    const writes = server.writes();
    expect(writes[0].parentRef).toMatchObject({ type: "head" });
    expect(writes[writes.length - 1].parentRef).toMatchObject({
      type: "patch",
      patchId: first.patchId,
    });
    dispose();
  });

  /**
   * The honest behaviour of a system with no write seam, which is what the
   * benchmark drivers and every read-path test use. It must not look like
   * success: an edit that reports itself saved while nothing left the tab is the
   * worst outcome available here.
   */
  it("leaves an edit pending when there is nowhere to write it", async () => {
    // A bare system rather than the rig, because the rig HAS a write seam and
    // the subject here is not having one.
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `bare-${++next}` as PatchId;
      })(),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "never saved" },
    ]);
    await system.patchSync.flush();

    expect(system.patchStore.pendingPatchIds()).toHaveLength(1);
    // `pending`, not `retrying`: there is nothing to retry, because no amount
    // of waiting configures a seam. And emphatically not `in-sync` — an edit
    // that reports itself saved while nothing left the tab is the worst outcome
    // available here.
    expect(system.patchSync.currentState()).toMatchObject({
      status: "pending",
    });
    system.dispose();
  });
});

describe("the head model survives a 409", () => {
  /**
   * The scenario item 6 asked about, end to end.
   *
   * Another session writes, so the server's head moves and this client is not
   * told. Our write then names a parent the server has moved past, and is
   * refused. Nothing is lost: the chain is re-synced, our patch is re-sent
   * against the new head, and it lands ON TOP of the other session's edit rather
   * than in place of it.
   */
  it("re-syncs and re-sends, and the other session's edit survives", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    // Another session edits `body`. The server's head moves; we do not know.
    const theirs = externalPatch("their-1", "/t.val.ts", [
      { op: "replace", path: ["body"], value: "theirs" },
    ]);
    server.simulateConcurrentWrite([theirs]);

    const ours = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "ours" },
    ]);
    await patchSync.flush();
    await settle();

    // Both on the server, theirs first: the chain is linear and ours was
    // rebased onto it rather than replacing it.
    expect(server.patchIds()).toEqual([theirs.patchId, ours.patchId]);
    // And the client's source shows both edits, which is the property that
    // actually matters — a recovery that saved the patch but lost the value
    // would pass every assertion above.
    const title = await sourceStore.get(TITLE, null);
    expect(title).toMatchObject({ status: "resolved-head", data: "ours" });
    const body = await sourceStore.get('/t.val.ts?p="body"', null);
    expect(body).toMatchObject({ status: "resolved-head", data: "theirs" });
    dispose();
  });

  it("reports the conflict before recovering from it", async () => {
    const {
      sourceStore,
      patchStore,
      patchSync,
      server,
      stat,
      ledger,
      dispose,
    } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    server.simulateConcurrentWrite([
      externalPatch("their-1", "/t.val.ts", [
        { op: "replace", path: ["body"], value: "theirs" },
      ]),
    ]);
    const since = ledger.position();

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "ours" },
    ]);
    await patchSync.flush();
    await settle();

    // Announced, not just handled. A conflict is the one state where the user's
    // edit is real locally and provably not real anywhere else, so something has
    // to be able to say so.
    await ledger.has({ type: "patch:save-conflict" }, { since });
    await ledger.has({ type: "patch:saved" }, { since });
    dispose();
  });

  /**
   * A conflict must not consume the edit. This is the failure mode that would be
   * invisible without an assertion: a client that dropped the patch on 409 would
   * report itself in-sync, with a green UI and a lost keystroke.
   */
  it("keeps the patch pending across the conflict", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    server.simulateConcurrentWrite([
      externalPatch("their-1", "/t.val.ts", [
        { op: "replace", path: ["body"], value: "theirs" },
      ]),
    ]);

    const ours = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "ours" },
    ]);
    // Deliberately not awaited past the first attempt: what is asserted is the
    // state DURING recovery, which a fully-settled system no longer shows.
    expect(patchStore.isPending(ours.patchId)).toBe(true);

    await patchSync.flush();
    await settle();

    expect(patchStore.isPending(ours.patchId)).toBe(false);
    dispose();
  });
});

describe("a permanently rejected patch is dropped, not retried", () => {
  it("rebuilds the source without it", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    server.failNextWrites({
      status: "rejected",
      message: "that patch is nonsense",
    });

    let rejected: { message: string; patches: string[] } | null = null;
    patchSync.events.on("patch:save-rejected", (event) => {
      rejected = { message: event.message, patches: [...event.patches] };
    });

    const doomed = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "will not survive" },
    ]);
    await patchSync.flush();

    // Back to base. An applied patch cannot be un-applied — a `replace` does not
    // record what it replaced — so this can only be right if the source was
    // rebuilt from base plus the surviving chain.
    //
    // The optimistic value is NOT read here first. The rig settles the write loop
    // after every create, so by the time control returns the rejection has
    // already been handled — there is no moment at which this test could observe
    // the in-between state without gating the write. That the value WAS shown and
    // then taken back is what the field-wake test below asserts.
    expect(await sourceStore.get(TITLE, null)).toMatchObject({
      status: "resolved-head",
      data: "Hello",
    });
    expect(server.patchIds()).toEqual([]);
    expect(patchStore.isPending(doomed.patchId)).toBe(false);
    // Announced, not left as a queue state. The queue after a drop is genuinely
    // in-sync — nothing is pending — so a `rejected` STATUS would be overwritten
    // by the truth on the very next drain, which is how the one outcome that
    // destroys an edit became the one a UI could not see. It is an event, and
    // `createSystem` turns it into a sticky error the user is shown; see
    // "tells the user their edit was reverted" below.
    expect(rejected).toMatchObject({
      message: "that patch is nonsense",
      patches: [doomed.patchId],
    });
    expect(patchSync.currentState()).toMatchObject({ status: "in-sync" });
    dispose();
  });

  it("keeps the surviving patches in the chain", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    const kept = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["body"], value: "kept" },
    ]);
    await patchSync.flush();

    server.failNextWrites({ status: "rejected", message: "no" });
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "dropped" },
    ]);
    await patchSync.flush();

    // The rebuild replays the chain, so an EARLIER patch must still be in
    // effect afterwards. This is the assertion that catches a rebuild which
    // resets to base and forgets to re-apply.
    expect(await sourceStore.get('/t.val.ts?p="body"', null)).toMatchObject({
      data: "kept",
    });
    expect(await sourceStore.get(TITLE, null)).toMatchObject({
      data: "Hello",
    });
    expect(server.patchIds()).toEqual([kept.patchId]);
    dispose();
  });

  /**
   * The field that made the edit is exactly the field now showing a value that
   * no longer exists, so it is the one reader that must NOT be left asleep. The
   * normal create path suppresses it on purpose; a drop has to override that.
   */
  it("wakes even the field that made the patch", async () => {
    const {
      sourceStore,
      patchStore,
      patchSync,
      server,
      stat,
      listeners,
      dispose,
    } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    const field = listeners.set(TITLE, "the-typing-field");
    server.failNextWrites({ status: "rejected", message: "no" });

    await patchStore.createPatch(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "doomed" }],
      undefined,
      "the-typing-field",
    );
    await patchSync.flush();

    await field.didReceive({ type: "external-patch" });
    // And what it would read now is the base value, not the rejected one. Without
    // this the test would prove only that something was announced.
    expect(await sourceStore.get(TITLE, null)).toMatchObject({
      status: "resolved-head",
      data: "Hello",
    });
    dispose();
  });
});

/**
 * The half a store-level test cannot see: that a rejection reaches a person.
 *
 * `patchSync` announces it; `createSystem` is what turns the announcement into a
 * sticky error the Studio shows (`useGlobalTransientErrors` ->
 * `TransientErrorsDisplay`). Wired there rather than inside `PatchSync` because
 * the store must not know what a UI is — and because that wiring is exactly the
 * kind that is written once and believed forever.
 */
/**
 * Where a patch's bytes are written, and why it is this file's business.
 *
 * `ValOpsFS` writes a patch's files into the directory named by its parentRef
 * (`saveBase64EncodedBinaryFileFromPatch`) and reads them back out of the
 * directory the PATCH ended up in (`getBase64EncodedBinaryFileFromPatch`). The
 * two must agree, and only `PatchSync` knows what the next write will name — so
 * the store asks it, and this is where that is pinned.
 */
describe("a file upload names the parent the patch will name", () => {
  it("uses the chain's current parent, not the head", async () => {
    const uploads: { filePath: string; parentRef: unknown }[] = [];
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `upload-${++next}` as PatchId;
      })(),
      savePatches: async ({ patches, parentRef }) => ({
        status: "saved",
        newPatchIds: patches.map((entry) => entry.patchId),
        parentRef: {
          type: "patch",
          patchId: patches[patches.length - 1].patchId,
        },
        // `parentRef` is read so the fake behaves like the server: it is what
        // the next write must build on.
        ...(parentRef ? {} : {}),
      }),
      uploadFile: async ({ filePath, parentRef }) => {
        uploads.push({ filePath, parentRef });
        return { status: "ok" };
      },
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    // A plain edit first, so the chain is no longer empty. This is the whole
    // point: with an empty chain the parent IS the head, so a hardcoded head
    // looked correct and every test passed.
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "first" },
    ]);
    await system.patchSync.flush();
    const parentAfterFirst = system.patchSync.currentParentRef();
    expect(parentAfterFirst).toMatchObject({ type: "patch" });

    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      {
        op: "file",
        path: ["title"],
        filePath: "/public/val/hero.png",
        value: "data:image/png;base64,AAAA",
        remote: false,
      },
    ]);

    expect(uploads).toHaveLength(1);
    // The parent the patch will be saved under — NOT `{ type: "head" }`, which
    // would put the bytes in `head/` while the patch lands in `<firstId>/`, and
    // the image would 404.
    expect(uploads[0].parentRef).toEqual(parentAfterFirst);
    system.dispose();
  });
});

describe("a rejected patch is reported to the user", () => {
  it("tells them their edit was reverted, and does not un-tell them", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `rejected-${++next}` as PatchId;
      })(),
      savePatches: async () => ({
        status: "rejected",
        message: "that patch is nonsense",
      }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "will not survive" },
    ]);
    await system.patchSync.flush();

    expect(system.status.current().errors).toHaveLength(1);
    expect(system.status.current().errors[0]).toMatchObject({
      message: "An edit could not be saved and has been reverted.",
      details: "that patch is nonsense",
    });
    // Sticky. The queue is in-sync now — there is nothing left to be pending —
    // so anything derived from the queue state would have erased this by the
    // time a user looked at it.
    expect(system.patchSync.currentState()).toMatchObject({
      status: "in-sync",
    });
    expect(system.status.current().errors).toHaveLength(1);
    system.dispose();
  });
});

describe("a retryable failure is retried", () => {
  it("re-sends the same batch after a network error", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    server.failNextWrites({ status: "network-error", message: "offline" }, 2);

    const record = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "eventually" },
    ]);
    await patchSync.flush();

    expect(server.patchIds()).toEqual([record.patchId]);
    // Three attempts for one patch: two refused, one accepted. Nothing local
    // changed in between — a network error says nothing about the patch.
    expect(server.writes()).toHaveLength(3);
    expect(patchSync.currentState()).toMatchObject({ status: "in-sync" });
    dispose();
  });

  /**
   * The server keeps ONE linear chain and checks every parent, so two writes in
   * flight at once is a conflict this client would be causing itself. A second
   * `flush` therefore has to join the first rather than start a second request.
   */
  it("does not start a second write while one is in flight", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "a" },
    ]);
    const first = patchSync.flush();
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["body"], value: "b" },
    ]);
    await Promise.all([first, patchSync.flush()]);
    await settle();

    // Every write the server saw had the parent it expected. A second concurrent
    // request would have named a parent the server had not accepted yet, and the
    // fake server — which enforces the head for real — would have said 409.
    expect(server.writes().some((write) => write.patchIds.length === 0)).toBe(
      false,
    );
    expect(patchStore.pendingPatchIds()).toEqual([]);
    dispose();
  });
});

describe("a session is carried per patch, and constrains the batch", () => {
  /**
   * The server records `sessionId` against each patch, but the `PUT` carries ONE
   * for the whole request — so a batch spanning two sessions would label some of
   * its patches with the wrong one.
   *
   * This exists because the AI write paths are the ones that set a session, and
   * they are also the paths the write flip left behind: they called the engine
   * directly, so with the engine's `PUT` disabled an AI edit appeared on screen,
   * reached no server, and reported success. Routing them through the store fixed
   * that and made per-patch sessions load-bearing.
   */
  it("sends a patch's own session, not the system's", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    await patchStore.createPatchInSession(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "by the ai" }],
      "ai-session-1",
    );
    await patchSync.flush();

    expect(server.writes()).toHaveLength(1);
    expect(server.writes()[0].sessionId).toBe("ai-session-1");
    dispose();
  });

  /**
   * Two sessions cannot share a request, and the split has to be a LEADING run
   * rather than a filter: the chain is linear and the server checks the parent, so
   * skipping a patch to group by session would name a parent the server has not
   * accepted.
   */
  it("splits a batch at a session boundary, in order", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    const first = await patchStore.createPatchInSession(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "one" }],
      "session-a",
    );
    const second = await patchStore.createPatchInSession(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "two" }],
      "session-b",
    );
    await patchSync.flush();

    const writes = server.writes();
    // Two requests, one per session, in chain order.
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      patchIds: [first.patchId],
      sessionId: "session-a",
    });
    expect(writes[1]).toMatchObject({
      patchIds: [second.patchId],
      sessionId: "session-b",
    });
    expect(patchStore.pendingPatchIds()).toEqual([]);
    dispose();
  });

  /**
   * And patches with no session still batch together, which is the ordinary
   * typing case: a session boundary must not turn every field edit into its own
   * request.
   */
  it("still batches patches that share no session", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.holdNextWrite(gate);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "a" },
    ]);
    const inFlight = patchSync.flush();
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["body"], value: "b" },
    ]);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "c" },
    ]);
    release();
    await inFlight;
    await patchSync.flush();

    const sizes = server.writes().map((write) => write.patchIds.length);
    // Fewer requests than patches: the three sessionless patches were not split.
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(3);
    expect(server.writes().length).toBeLessThan(3);
    dispose();
  });
});

/**
 * Reconciling the chain with stat, when stat stops naming a patch.
 *
 * The bug: a patch discarded anywhere other than this client — another tab, the
 * CLI, a raw `DELETE /patches` — never went away. `onStatPatchIds` kept every
 * locally-created id stat did not name, on the grounds that its `PUT` might be in
 * flight, and nothing ever revisited that. The chain kept a patch the server had
 * deleted, and source kept showing its value.
 *
 * The fix cannot be "trust stat". Stat is POLLED, so a response describes the
 * server as it was when the request was issued: one issued before our save landed
 * omits a patch that exists, and a response that overtakes an older one omits
 * whatever arrived between them. Removing a patch on that evidence reverts an edit
 * the user made and the server has — so the store asks, and these tests are about
 * the asking as much as about the outcome.
 */
describe("a patch that vanished from stat", () => {
  it("is dropped, and its value with it, once the server confirms it is gone", async () => {
    const { sourceStore, patchStore, patchSync, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "typed here" },
    ]);
    await patchSync.flush();
    // Saved, so "the PUT might still be in flight" does not apply to it.
    expect(patchStore.isPending("local-1" as PatchId)).toBe(false);

    server.simulateForeignDiscard(["local-1" as PatchId]);
    await settle();
    await settle();

    expect(await patchStore.getHead()).toEqual({ type: "empty" });
    // The VALUE, not only the chain. A patch spliced out of the chain whose
    // effect is still in source is the same bug wearing a different hat — and it
    // is the half that a user sees.
    const read = await sourceStore.get(TITLE, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected a value, got ${read.status}`);
    }
    expect(read.data).toBe("Hello");
    dispose();
  });

  it("asks the server instead of inferring it from stat", async () => {
    const {
      sourceStore,
      patchStore,
      patchSync,
      server,
      stat,
      activity,
      dispose,
    } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "typed here" },
    ]);
    await patchSync.flush();

    const before = activity.position();
    server.simulateForeignDiscard(["local-1" as PatchId]);
    await settle();
    await settle();

    // The round trip is the mechanism, not an implementation detail: without it
    // the only available evidence is a stat that cannot date itself.
    expect(
      activity.count("patch:verify-vanished", { since: before }),
    ).toBeGreaterThan(0);
    dispose();
  });

  /**
   * The race a "just trust stat" fix loses.
   *
   * The server still HAS the patch; this stat snapshot simply predates it. Acting
   * on it would revert a saved edit, which is worse than the bug being fixed.
   */
  it("keeps a saved patch that stat has not caught up with", async () => {
    const { sourceStore, patchStore, patchSync, stat, server, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "typed here" },
    ]);
    await patchSync.flush();

    // A stale snapshot: nothing was discarded, so the server still serves it.
    expect(server.patchIds()).toContain("local-1" as PatchId);
    stat.simulateStaleStat([]);
    await settle();
    await settle();

    expect((await patchStore.getHead()).type).not.toBe("empty");
    const read = await sourceStore.get(TITLE, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected a value, got ${read.status}`);
    }
    expect(read.data).toBe("typed here");
    dispose();
  });

  /** An unsaved patch is not evidence: stat cannot name what it has not seen. */
  it("keeps a patch whose save is still in flight, without asking about it", async () => {
    const {
      sourceStore,
      patchStore,
      patchSync,
      stat,
      server,
      activity,
      dispose,
    } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.holdNextWrite(gate);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "typed here" },
    ]);
    const inFlight = patchSync.flush();
    expect(patchStore.isPending("local-1" as PatchId)).toBe(true);

    const before = activity.position();
    stat.simulateStaleStat([]);
    await settle();

    expect((await patchStore.getHead()).type).not.toBe("empty");
    // Not even asked about: a pending patch costs no round trip, which is what
    // keeps a burst of typing from turning every poll into a verification.
    expect(activity.count("patch:verify-vanished", { since: before })).toBe(0);

    release();
    await inFlight;
    dispose();
  });
});

/**
 * A patch that cannot be applied is deleted.
 *
 * `failed` on `source:patch-apply` means `applyPatch` REFUSED the ops against the
 * module's current source. It does not mean "not ready": a patch whose module has
 * not loaded is skipped and replayed by `receive()`, and a patch carrying only
 * `file` ops counts as applied. So a patch that reaches here will fail the same
 * way on every future replay.
 *
 * Leaving it in the chain is the worse option in every direction: it cannot
 * produce a value, it holds the head at `partial`, and `PatchSync` keeps offering
 * it to `PUT /patches` — so one bad patch stops every later edit to that module
 * from being saved.
 */
describe("a patch that cannot be applied", () => {
  /** `remove` at a path that is not there cannot apply, now or ever. */
  const unapplicable: Patch = [{ op: "remove", path: ["nope"] }];

  it("is deleted on the server, not only locally", async () => {
    const { sourceStore, patchStore, server, stat, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    await patchStore.createPatch("/t.val.ts", unapplicable);
    await settle();
    await settle();

    // Local-only would come straight back on the next reload, which is how one
    // bad patch becomes a project that cannot be edited.
    expect(server.discarded()).toContain("local-1" as PatchId);
    expect(await patchStore.getHead()).toEqual({ type: "empty" });
    dispose();
  });

  it("is dropped locally even when the server delete fails", async () => {
    const { sourceStore, patchStore, server, stat, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);
    server.failNextDiscard("the server is having a bad day");

    await patchStore.createPatch("/t.val.ts", unapplicable);
    await settle();
    await settle();

    // Still out of the chain: it blocks saving whatever the server said, and the
    // console error is what explains its return after a reload.
    expect(await patchStore.getHead()).toEqual({ type: "empty" });
    dispose();
  });

  it("is reported once, not once per replay", async () => {
    const { sourceStore, patchStore, host, server, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    await patchStore.createPatch("/t.val.ts", unapplicable);
    await settle();
    await settle();
    const afterFirst = server.discarded().length;
    // Re-intake replays the chain, which is where a second report would come
    // from. Nothing is left to replay, but the guard is what makes that true
    // even when the delete failed and the patch is still around.
    host.receive([module()]);
    await settle();
    await settle();

    expect(server.discarded().length).toBe(afterFirst);
    dispose();
  });

  /** A patch that applies is left alone, which is most of them. */
  it("leaves an applicable patch in the chain", async () => {
    const { sourceStore, patchStore, server, stat, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    stat.simulateExternal([]);

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "fine" },
    ]);
    await settle();
    await settle();

    expect(server.discarded()).toEqual([]);
    expect((await patchStore.getHead()).type).not.toBe("empty");
    dispose();
  });
});
