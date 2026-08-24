import { initVal } from "@valbuild/core";
import { externalPatch, initTestSystem } from "./testSystem";
import { isNewerRevision, type Revision, type SourceRead } from "./types";
import type { SourcePeek } from "./SourceStore";

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

/**
 * The revision out of either read.
 *
 * Takes a `SourcePeek` as well as a `SourceRead` because the two must agree: a
 * caller is allowed to hold a revision from `peek` and hand it to `get`, and
 * vice versa. A helper that only accepted one would let them drift.
 */
function revisionOf(read: SourceRead | SourcePeek): Revision {
  if (
    read.status !== "resolved-head" &&
    read.status !== "unchanged" &&
    read.status !== "absent" &&
    read.status !== "ready"
  ) {
    throw new Error(`expected a revision, got ${read.status}`);
  }
  return read.revision;
}

describe("a read carries the head it was computed at", () => {
  it("answers a first read with the value and a head", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const read = await sourceStore.get(TITLE, null);

    expect(valueOf(read)).toBe("Hello");
    expect(typeof revisionOf(read).n).toBe("number");
    dispose();
  });

  it("answers `unchanged` when the head handed back is still current", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const first = await sourceStore.get(TITLE, null);
    const again = await sourceStore.get(TITLE, revisionOf(first));

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

    const stale = await sourceStore.get(TITLE, revisionOf(first));

    expect(valueOf(stale)).toBe("Changed");
    expect(isNewerRevision(revisionOf(stale), revisionOf(first))).toBe(true);
    dispose();
  });

  it("reports absence with a head too, so absence is datable", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const read = await sourceStore.get('/t.val.ts?p="missing"', null);

    if (read.status !== "absent") {
      throw new Error(`expected absent, got ${read.status}`);
    }
    // Dated, so a reader can tell "absent as of a revision I have moved past"
    // from "absent now" without having to re-ask to find out.
    expect(typeof read.revision.n).toBe("number");
    dispose();
  });
});

describe("revisions are orderable, which is what handles out-of-order replies", () => {
  it("advances the revision on every change to the module's source", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const before = revisionOf(await sourceStore.get(TITLE, null));
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "One" },
    ]);
    const after = revisionOf(await sourceStore.get(TITLE, null));

    expect(isNewerRevision(after, before)).toBe(true);
    expect(isNewerRevision(before, after)).toBe(false);
    // Not newer than itself: a reply that ties must be dropped, not accepted,
    // or two replies at one head could fight.
    expect(isNewerRevision(after, after)).toBe(false);
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
    let held: Revision = revisionOf(first);
    let shown = valueOf(first);
    for (const reply of [second, first]) {
      const revision = revisionOf(reply);
      if (!isNewerRevision(revision, held)) continue;
      held = revision;
      shown = valueOf(reply);
    }

    expect(shown).toBe("Newer");
    dispose();
  });

  it("says whether a held revision is still current, without a value", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const read = await sourceStore.get(TITLE, null);
    expect(await sourceStore.isCurrent(revisionOf(read))).toBe(true);

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);
    // The watchdog's question. Its only job is catching a LOST event — monotonic
    // acceptance already handles replies that merely arrive late.
    expect(await sourceStore.isCurrent(revisionOf(read))).toBe(false);
    dispose();
  });
});

describe("revisions are per module", () => {
  /**
   * The payoff of per-module rather than one global counter, and it retires
   * `openquestions.md` item 10's first bullet: a patch in module A used to make
   * every reader in the project stale, so each re-read once and got its unchanged
   * value back — "a wasted read, never wrong data".
   *
   * It matters most for `.jsonValues()`: one local `*.val.json` save marks every
   * entry stale, which under a global counter would make every mounted field in
   * the project re-read for content it does not show.
   */
  it("does not stale a reader of another module", async () => {
    const { c, s } = initVal();
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([
      module(),
      c.define("/other.val.ts", s.object({ name: s.string() }), {
        name: "Ada",
      }),
    ]);

    const other = await sourceStore.get('/other.val.ts?p="name"', null);

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);

    // Untouched module, so still current and still the cheap answer.
    expect(await sourceStore.isCurrent(revisionOf(other))).toBe(true);
    expect(
      await sourceStore.get('/other.val.ts?p="name"', revisionOf(other)),
    ).toMatchObject({ status: "unchanged" });
    dispose();
  });

  /**
   * And the safety property that falls out of making a revision a pair: a
   * revision for the wrong module can never produce a false `unchanged`. Under a
   * bare counter, module B at n=1 would look "current" to a read of module A at
   * n=1 and the reader would keep a value belonging to nothing.
   */
  it("never answers `unchanged` to a revision from another module", async () => {
    const { c, s } = initVal();
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([
      module(),
      c.define("/other.val.ts", s.object({ name: s.string() }), {
        name: "Ada",
      }),
    ]);

    const other = await sourceStore.get('/other.val.ts?p="name"', null);
    const wrongModule = await sourceStore.get(TITLE, revisionOf(other));

    expect(valueOf(wrongModule)).toBe("Hello");
    // And comparing them is an error rather than a silent `false`, which would
    // let a reader treat a foreign revision as "not newer" and keep stale data.
    expect(() =>
      isNewerRevision(revisionOf(wrongModule), revisionOf(other)),
    ).toThrow();
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

    const second = await sourceStore.get(TITLE, revisionOf(first));
    expect(valueOf(second)).toBe("Foreign");

    // Exactly one wake, and no second one provoked by the read that followed it.
    expect(activity.count("source:wake-listener", { since: before })).toBe(1);
    await listener.noMessages({ since: 1 });
    dispose();
  });
});

describe("the comparator must see everything that changes source", () => {
  /**
   * SPEC — currently failing, and the reason the comparator has to move out of
   * the patch store.
   *
   * `head.seq` is the patch store's CHAIN version. A source reset — a new commit,
   * `PUT /sources/~`, HMR, or a `.jsonValues()` entry file changing on disk —
   * replaces base source without touching the chain. So the value changes and the
   * comparator sits still, and a field quoting the head it correctly read at is
   * told `unchanged` about a value that is now wrong.
   *
   * `.jsonValues()` makes this likelier rather than different: an entry file
   * change cannot move `sourcesSha` either, because the module's source is
   * markers and the content sits behind a thunk `JSON.stringify` drops — which is
   * why `jsonEntriesSha` exists as a separate fingerprint.
   *
   * The fix is to give the SOURCE store its own revision, bumped by anything that
   * changes readable source, and leave the patch head describing the chain. The
   * patch chain structurally cannot see a base-source replacement, so it is the
   * wrong thing to compare against.
   */
  it("reports a value as changed after a source reset", async () => {
    const { c, s } = initVal();
    const { sourceStore, dispose } = initTestSystem();
    const withTitle = (title: string) =>
      c.define("/reset.val.ts", s.object({ title: s.string() }), { title });

    await sourceStore.testReceive([withTitle("authored")]);
    const first = await sourceStore.get('/reset.val.ts?p="title"', null);
    expect(valueOf(first)).toBe("authored");

    // The reset: same module, new base source.
    await sourceStore.testReceive([withTitle("changed on disk")]);

    const again = await sourceStore.get(
      '/reset.val.ts?p="title"',
      revisionOf(first),
    );
    // Not `unchanged`: what this field holds is no longer what the store holds.
    expect(valueOf(again)).toBe("changed on disk");
    dispose();
  });

  /** The same reset must also make a held head report itself out of date. */
  it("reports a held head as no longer current after a source reset", async () => {
    const { c, s } = initVal();
    const { sourceStore, dispose } = initTestSystem();
    const withTitle = (title: string) =>
      c.define("/reset2.val.ts", s.object({ title: s.string() }), { title });

    await sourceStore.testReceive([withTitle("authored")]);
    const read = await sourceStore.get('/reset2.val.ts?p="title"', null);
    expect(await sourceStore.isCurrent(revisionOf(read))).toBe(true);

    await sourceStore.testReceive([withTitle("changed on disk")]);

    // Otherwise the watchdog cannot catch it either, and nothing can.
    expect(await sourceStore.isCurrent(revisionOf(read))).toBe(false);
    dispose();
  });
});

/**
 * `peek` is the synchronous read, and that is what lets a mounting field paint
 * once.
 *
 * `openquestions.md` item 1 asked whether the host realm needed a synchronous
 * read: `get` is async, so a `useSyncExternalStore` hook cannot call it from
 * `getSnapshot`, and a field therefore rendered once with nothing and again a
 * microtask later — 32 mount renders against the engine's 16 in `bench/`. The
 * answer was that the synchronous read already existed and was discarding its
 * own answer.
 *
 * The rule these tests pin: **`peek` to render, `get` to demand.**
 */
describe("peek: the synchronous read", () => {
  it("carries the value, not just a status", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const seen = sourceStore.peek(TITLE);
    expect(seen).toMatchObject({ status: "ready", data: "Hello" });
    // And the same revision `get` would report, so a caller can hold one from
    // either and compare them.
    expect(revisionOf(seen)).toEqual(
      revisionOf(await sourceStore.get(TITLE, null)),
    );
    dispose();
  });

  it("sees a patch with no await in between", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);

    // No `await` between the patch landing and this read. That is the property a
    // synchronous `getSnapshot` depends on: source is applied before the event
    // that announces it, so a woken field can read immediately and cannot get a
    // pre-patch value.
    const seen = sourceStore.peek(TITLE);
    if (seen.status !== "ready") {
      throw new Error(`expected a value, got ${seen.status}`);
    }
    expect(seen.data).toBe("Changed");
    dispose();
  });

  /**
   * The reference-stability contract `useSyncExternalStore` requires: an
   * unchanged object-valued path must peek to the SAME object, or React tears on
   * every call. It holds because `peek` returns a reference into the store's own
   * source rather than a copy — which is also why the host realm keeps source.
   */
  it("returns the same object for an unchanged object-valued path", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const first = sourceStore.peek("/t.val.ts");
    const again = sourceStore.peek("/t.val.ts");
    if (first.status !== "ready" || again.status !== "ready") {
      throw new Error("expected a value both times");
    }
    expect(again.data).toBe(first.data);
    dispose();
  });

  /**
   * And it must NOT be the same object once the value moved, or a field that
   * compares references would never repaint.
   */
  it("returns a different object after a patch", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const before = sourceStore.peek("/t.val.ts");
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);
    const after = sourceStore.peek("/t.val.ts");
    if (before.status !== "ready" || after.status !== "ready") {
      throw new Error("expected a value both times");
    }
    expect(after.data).not.toBe(before.data);
    dispose();
  });
});

// The one case peek cannot answer — a `.jsonValues()` entry behind a network
// round trip, which is why `get` still exists and is still async — is asserted in
// `jsonValues.test.ts`, next to the module factory that can produce it.
