import { initVal } from "@valbuild/core";
import type { PatchId } from "@valbuild/core";
import { externalPatch, initTestSystem, patchIds } from "./testSystem";

/** Let the fetch a stat kicked off actually come back. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A server that names an unpublished change and then does not send it.
 *
 * This is the studio half of the reported failure. The fs patch store counted
 * the directories on disk to announce and walked the parent links between them
 * to deliver, so one lost record made it announce 410 changes and hand over 359.
 * The store no longer produces that disagreement — but the studio's reaction to
 * it was its own bug, and a worse one:
 *
 * `fetching` is what stops a second request going out for an id already in
 * flight. Ids were removed from it only when they came back as a record or as an
 * error, so the 51 that came back as neither stayed in it forever. That is not
 * "retry later", it is never again: no further request was ever made for them,
 * no error was ever raised, the chain never settled, and the studio sat on
 * "Loading unpublished changes…" for as long as the tab was open.
 */
describe("changes the server announced and did not send", () => {
  const module = () => {
    const { c, s } = initVal();
    return c.define("/t.val.ts", s.object({ title: s.string() }), {
      title: "published",
    });
  };

  const setup = async () => {
    const system = initTestSystem();
    await system.sourceStore.testReceive([module()]);
    return system;
  };

  it("settles the chain instead of waiting on them forever", async () => {
    const { patchStore, server, dispose } = await setup();

    server.simulateAnnouncedNotDelivered(["never-sent" as PatchId]);
    await settle();

    const head = await patchStore.getHead();
    // `-partial` is the waiting state, and it is the one that never ended.
    expect(head.type).toBe("external-failed");
    dispose();
  });

  it("tells the person editing, because their work is not on screen", async () => {
    const { server, status, dispose } = await setup();

    server.simulateAnnouncedNotDelivered(["never-sent" as PatchId]);
    await settle();

    const [error] = status.current().errors;
    expect(error?.message).toBe("An unpublished change could not be loaded.");
    expect(error?.details).toContain("Reload before editing");
    dispose();
  });

  it("counts them, so the report matches what happened", async () => {
    const { server, status, dispose } = await setup();

    server.simulateAnnouncedNotDelivered([
      "a" as PatchId,
      "b" as PatchId,
      "c" as PatchId,
    ]);
    await settle();

    expect(status.current().errors[0]?.message).toBe(
      "3 unpublished changes could not be loaded.",
    );
    dispose();
  });

  it("keeps the changes that did arrive", async () => {
    const { sourceStore, stat, server, dispose } = await setup();

    const delivered = externalPatch("delivered", "/t.val.ts", [
      { op: "replace", path: ["title"], value: "from another tab" },
    ]);
    stat.simulateExternal([delivered]);
    server.simulateAnnouncedNotDelivered(["never-sent" as PatchId]);
    await settle();

    // A partial answer is still an answer. Discarding what did arrive would turn
    // one missing change into every change missing.
    const read = await sourceStore.get('/t.val.ts?p="title"', null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected a value, got ${read.status}`);
    }
    expect(read.data).toBe("from another tab");
    expect(patchIds([delivered])).toEqual(["delivered"]);
    dispose();
  });

  it("does not re-report the same failure on every stat", async () => {
    const { server, status, dispose } = await setup();

    server.simulateAnnouncedNotDelivered(["never-sent" as PatchId]);
    await settle();
    server.simulateAnnouncedNotDelivered([]);
    await settle();

    // The id is settled as failed, so nothing asks for it again — which is what
    // stops a permanent server fault becoming a permanent stream of toasts.
    expect(status.current().errors).toHaveLength(1);
    dispose();
  });

  describe("changes the server threw away because it could not read them", () => {
    it("tells the person editing, because the fields just went back", async () => {
      const { server, status, dispose } = await setup();

      server.simulateServerRemovedUnreadable([
        { patchId: "unreadable" as PatchId, reason: "there is no patch.json" },
      ]);
      await settle();

      const [error] = status.current().errors;
      expect(error?.message).toBe(
        "An unpublished change was removed because the server could not read it.",
      );
      expect(error?.details).toContain("patches.repair.log");
      dispose();
    });

    it("counts them", async () => {
      const { server, status, dispose } = await setup();

      server.simulateServerRemovedUnreadable([
        { patchId: "a" as PatchId, reason: "gone" },
        { patchId: "b" as PatchId, reason: "gone" },
      ]);
      await settle();

      expect(status.current().errors[0]?.message).toBe(
        "2 unpublished changes were removed because the server could not read them.",
      );
      dispose();
    });

    /**
     * Distinct from a discard by another session, which is silent because
     * somebody meant it. This is work disappearing on its own.
     */
    it("says nothing when a change is simply discarded elsewhere", async () => {
      const { patchStore, stat, server, status, dispose } = await setup();

      const foreign = externalPatch("foreign", "/t.val.ts", [
        { op: "replace", path: ["title"], value: "will be discarded" },
      ]);
      stat.simulateExternal([foreign]);
      await settle();
      await patchStore.getHead();

      server.simulateForeignDiscard(["foreign" as PatchId]);
      await settle();

      expect(status.current().errors).toEqual([]);
      dispose();
    });
  });

  /**
   * The other half of the rule, and the reason this is not simply "absence is an
   * error".
   *
   * An id stat has stopped naming is how a deleted patch is observed — the fetch
   * answers with nothing for it, and that silence means "gone", not "broken".
   * The two cases are told apart by whether stat announced the id, and getting
   * that backwards would resurrect deleted edits as permanent failures.
   */
  it("still treats a change stat stopped naming as deleted", async () => {
    const { patchStore, stat, server, dispose } = await setup();

    const foreign = externalPatch("foreign", "/t.val.ts", [
      { op: "replace", path: ["title"], value: "will be discarded" },
    ]);
    stat.simulateExternal([foreign]);
    await settle();

    server.simulateForeignDiscard(["foreign" as PatchId]);
    await settle();

    expect((await patchStore.getHead()).type).toBe("empty");
    dispose();
  });
});
