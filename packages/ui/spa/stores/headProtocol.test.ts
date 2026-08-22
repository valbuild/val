import { initVal } from "@valbuild/core";
import { externalPatch, initTestSystem } from "./testSystem";
import { isNewerHead, type Head, type SourceRead } from "./types";

/**
 * The read protocol, and why it cannot cycle.
 *
 * `get` hands back the source AND the head it was computed at, and never
 * refuses. The head passed IN is a claim about what the caller has already
 * incorporated: `null` means "nothing yet", and anything else must have come
 * from a previous `get`. Suppression is per field INSTANCE, because one path can
 * be rendered twice and what is internal to one instance is foreign to the other.
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

/** The value out of a read, or a failure naming what came back instead. */
function valueOf(read: SourceRead): unknown {
  if (read.status !== "resolved-head") {
    throw new Error(`expected a value, got ${read.status}`);
  }
  return read.data;
}

function headOf(read: SourceRead): Head {
  if (read.status !== "resolved-head" && read.status !== "unchanged") {
    throw new Error(`expected a head, got ${read.status}`);
  }
  return read.head;
}

describe("a read carries the head it was computed at", () => {
  it("answers a first read with the value and a head", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const read = await sourceStore.get(TITLE, null);

    expect(valueOf(read)).toBe("Hello");
    expect(typeof headOf(read).seq).toBe("number");
    dispose();
  });

  it("answers `unchanged` when the head handed back is still current", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const first = await sourceStore.get(TITLE, null);
    const again = await sourceStore.get(TITLE, headOf(first));

    // No value marshalled: the caller's own copy is still right. Once source is
    // across a worker seam this is the difference between a read costing a
    // structured clone and costing nothing.
    expect(again).toMatchObject({ status: "unchanged" });
    dispose();
  });

  /**
   * The protocol change that removes the retry loop. The earlier version refused
   * a read whose quoted head had moved, so the caller had to re-ask — which
   * needed a retry cap and was the one way the design could hang.
   */
  it("answers a stale read with the current value, never a refusal", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const first = await sourceStore.get(TITLE, null);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);

    const stale = await sourceStore.get(TITLE, headOf(first));

    expect(valueOf(stale)).toBe("Changed");
    expect(isNewerHead(headOf(stale), headOf(first))).toBe(true);
    dispose();
  });

  it("reports absence with a head too, so absence is datable", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const read = await sourceStore.get('/t.val.ts?p="missing"', null);

    if (read.status !== "absent") {
      throw new Error(`expected absent, got ${read.status}`);
    }
    // Dated, so a reader can tell "absent as of a head I have moved past" from
    // "absent now" without having to re-ask to find out.
    expect(typeof read.head.seq).toBe("number");
    dispose();
  });
});

describe("heads are orderable, which is what handles out-of-order replies", () => {
  it("advances the sequence on every change to the chain", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const before = await patchStore.getHead();
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "One" },
    ]);
    const after = await patchStore.getHead();

    expect(isNewerHead(after, before)).toBe(true);
    expect(isNewerHead(before, after)).toBe(false);
    // Not newer than itself: a reply that ties must be dropped, not accepted,
    // or two replies at one head could fight.
    expect(isNewerHead(after, after)).toBe(false);
    dispose();
  });

  /**
   * Monotonic acceptance, which is the whole of out-of-order reply handling: keep
   * the newest head accepted, drop anything not newer. Safe precisely because a
   * drop can only happen once something better has arrived — so there is always
   * a value and it is always the newest. Modelled here as a field would do it.
   */
  it("keeps the newer value when replies land out of order", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const first = await sourceStore.get(TITLE, null);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Newer" },
    ]);
    const second = await sourceStore.get(TITLE, null);

    // The field's accept rule, applied with the replies deliberately reversed.
    let held: Head = headOf(first);
    let shown = valueOf(first);
    for (const reply of [second, first]) {
      const head = headOf(reply);
      if (!isNewerHead(head, held)) continue;
      held = head;
      shown = valueOf(reply);
    }

    expect(shown).toBe("Newer");
    dispose();
  });

  it("says whether a held head is still current, without a value", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const read = await sourceStore.get(TITLE, null);
    expect(await sourceStore.isCurrent(headOf(read))).toBe(true);

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);
    // The watchdog's question. Its only job is catching a LOST event — monotonic
    // acceptance already handles replies that merely arrive late.
    expect(await sourceStore.isCurrent(headOf(read))).toBe(false);
    dispose();
  });
});

describe("suppression is per field instance", () => {
  /** Rule 4: a field's own write never wakes it, so typing cannot feed itself. */
  it("does not wake the field that made the edit", async () => {
    const { sourceStore, patchStore, listeners, ledger, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);

    const editor = listeners.set(TITLE, "editor");
    const quiet = await editor.noMessages();

    await patchStore.createPatch(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "Typed" }],
      undefined,
      "editor",
    );
    await ledger.has({ type: "source:patch-apply" });

    await editor.noMessages({ since: quiet });
    dispose();
  });

  /**
   * And the case that makes instance granularity necessary rather than merely
   * safer: a studio field and an inline overlay are two components showing one
   * path. Session-level "internal" would leave the overlay stale.
   */
  it("wakes the other instance on the same path", async () => {
    const { sourceStore, patchStore, listeners, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const studio = listeners.set(TITLE, "studio");
    const overlay = listeners.set(TITLE, "overlay");
    const quietStudio = await studio.noMessages();

    await patchStore.createPatch(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "Typed in studio" }],
      undefined,
      "studio",
    );

    await overlay.didReceive({ type: "internal-patch" });
    await studio.noMessages({ since: quietStudio });
    dispose();
  });

  it("wakes every instance for a foreign edit", async () => {
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const studio = listeners.set(TITLE, "studio");
    const overlay = listeners.set(TITLE, "overlay");

    stat.simulateExternal([
      externalPatch("ext-1", "/t.val.ts", [
        { op: "replace", path: ["title"], value: "From elsewhere" },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["ext-1"] });

    // Nobody here caused it, so nobody is left asleep.
    await studio.didReceive({ type: "external-patch" });
    await overlay.didReceive({ type: "external-patch" });
    dispose();
  });

  it("counts one wake per instance woken, not per path", async () => {
    const { sourceStore, patchStore, listeners, activity, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);

    listeners.set(TITLE, "studio");
    listeners.set(TITLE, "overlay");
    const before = activity.position();

    await patchStore.createPatch(
      "/t.val.ts",
      [{ op: "replace", path: ["title"], value: "Typed" }],
      undefined,
      "studio",
    );

    // Two instances registered, one of them the author: exactly one wake.
    expect(activity.count("source:wake-listener", { since: before })).toBe(1);
    dispose();
  });
});

describe("cycles are prevented structurally", () => {
  /** Rule 3: a patch that cannot apply changed nothing, so it wakes nobody. */
  it("wakes nobody for a patch that failed to apply", async () => {
    const { sourceStore, patchStore, listeners, ledger, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);

    const listener = listeners.set('/t.val.ts?p="title"', "reader");
    const quiet = await listener.noMessages();

    // `remove` on a path that is not there cannot apply.
    await patchStore.createPatch("/t.val.ts", [
      { op: "remove", path: ["nope"] },
    ]);
    await ledger.has({ type: "source:patch-apply" });

    await listener.noMessages({ since: quiet });
    dispose();
  });

  /**
   * Rule 2, as an assertion about work rather than about events: a read never
   * causes a further read. `source:read-path` is counted once per `get`, so a
   * read that provoked another would show up as two.
   */
  it("does not read again as a result of reading", async () => {
    const { sourceStore, activity, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const before = activity.position();
    await sourceStore.get(TITLE, null);

    expect(activity.count("source:read-path", { since: before })).toBe(1);
    dispose();
  });

  /**
   * Rule 1 end to end: one foreign edit produces one wake, and the read that
   * follows it produces no further event. So the graph is
   * `event → read → reply`, and it stops.
   */
  it("settles after one event and one read", async () => {
    const { sourceStore, stat, listeners, activity, ledger, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);

    const listener = listeners.set(TITLE, "reader");
    const first = await sourceStore.get(TITLE, null);

    const before = activity.position();
    stat.simulateExternal([
      externalPatch("ext-2", "/t.val.ts", [
        { op: "replace", path: ["title"], value: "Foreign" },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["ext-2"] });
    await listener.didReceive({ type: "external-patch" });

    const second = await sourceStore.get(TITLE, headOf(first));
    expect(valueOf(second)).toBe("Foreign");

    // Exactly one wake, and no second one provoked by the read that followed it.
    expect(activity.count("source:wake-listener", { since: before })).toBe(1);
    await listener.noMessages({ since: 1 });
    dispose();
  });
});
