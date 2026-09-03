import { initVal } from "@valbuild/core";
import { initTestSystem, mfp } from "./testSystem";
import type { ValidationStore } from "./ValidationStore";

/**
 * Modules with pending changes are validated without anyone looking at them.
 *
 * Everything else in this system is demand-driven, and should stay that way.
 * "Can this project be published" is the exception: no field is behind that
 * question, the publish button asks it, and it is about every pending change —
 * including ones made in a view that has since been closed, in another tab, or
 * by the AI. Answered from on-screen demand alone, an invalid edit could sit in
 * the chain with the publish button offering to ship it.
 *
 * The cost has to stay off the keystroke, though, which is the other half of
 * what is pinned here.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string().minLength(4) }), {
    title: "Hello",
  });
};

/**
 * Waits for the store's own `validation:result` event for each module in
 * `moduleFilePaths` — not a sleep past the debounce.
 *
 * Nothing here needs to guess how long a pass takes: the event that means
 * "yes" already exists, so waiting for it resolves the instant the pass
 * completes rather than after a fixed padding chosen to outlast it. The
 * timeout is a failure detector, not the mechanism — a run this slow means
 * something is actually stuck.
 *
 * Two tests below keep the REAL 300ms debounce, and deliberately: they are what
 * proves the default wiring arms and fires at all. The ones that assert
 * counting over a burst drive the pass by hand instead, because a count is not
 * a claim about elapsed time — see `manualPendingValidation`.
 */
function afterValidated(
  validationStore: ValidationStore,
  moduleFilePaths: readonly string[],
  timeoutMs = 5_000,
): Promise<void> {
  const remaining = new Set(moduleFilePaths);
  if (remaining.size === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(
        new Error(
          `validation never finished for: ${[...remaining].join(", ")}`,
        ),
      );
    }, timeoutMs);
    const off = validationStore.events.on("validation:result", (event) => {
      remaining.delete(event.moduleFilePath);
      if (remaining.size === 0) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

describe("validation of pending modules", () => {
  it("validates an edited module nothing is watching", async () => {
    const { sourceStore, patchStore, validationStore, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);

    // No listener, no field, nobody reading: just an edit that makes the module
    // invalid.
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "no" },
    ]);
    expect(validationStore.peek(mfp("/t.val.ts"))).toMatchObject({
      status: "stale",
    });

    await afterValidated(validationStore, ["/t.val.ts"]);

    const seen = validationStore.peek(mfp("/t.val.ts"));
    if (seen.status !== "validated" || seen.errors === false) {
      throw new Error(
        `the publish gate would have had nothing to go on: ${JSON.stringify(seen)}`,
      );
    }
    expect(JSON.stringify(seen.errors)).toContain("at least 4 characters long");
    dispose();
  });

  /**
   * Forty patches arm ONE pass, and the pass validates once.
   *
   * Both halves used to be inferred from a race: the burst was run against the
   * real 300ms debounce and the test asserted that nothing had validated yet.
   * That is a claim about wall-clock time — 40 awaited writes measured ~100ms
   * on an idle box, so it passed with a margin nobody chose, and it went red on
   * a CI runner where something other than CPU stretched the burst past 300ms.
   *
   * Driving the pass by hand says the same thing exactly. `armed` is the
   * coalescing itself rather than a shadow of it, so a regression that armed a
   * pass per patch fails with `40` instead of failing one run in fifty.
   */
  it("costs one validation for a burst, not one per keystroke", async () => {
    const {
      sourceStore,
      patchStore,
      validationStore,
      activity,
      pendingValidation,
      dispose,
    } = initTestSystem({ manualPendingValidation: true });
    await sourceStore.testReceive([module()]);

    const before = activity.position();
    for (let index = 0; index < 40; index++) {
      await patchStore.createPatch("/t.val.ts", [
        { op: "replace", path: ["title"], value: `Hello ${index}` },
      ]);
    }
    // One pass armed for the whole burst — the property, asserted directly.
    expect(pendingValidation.armed).toBe(1);
    // And nothing has validated, because nothing runs a pass but this test.
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(0);

    expect(pendingValidation.fire()).toBe(1);
    await afterValidated(validationStore, ["/t.val.ts"]);

    // One pass over the pending modules, not forty.
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(1);
    dispose();
  });

  it("does not validate a module with nothing pending", async () => {
    const { sourceStore, patchStore, validationStore, activity, dispose } =
      initTestSystem();
    const { c, s } = initVal();
    await sourceStore.testReceive([
      module(),
      c.define("/other.val.ts", s.object({ name: s.string() }), {
        name: "untouched",
      }),
    ]);

    const before = activity.position();
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "no" },
    ]);
    await afterValidated(validationStore, ["/t.val.ts"]);

    // The edited module only. A project's other modules are not the publish
    // gate's business, and validating them would put whole-project cost back on
    // every edit.
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(1);
    dispose();
  });

  /**
   * The pass costs one validation per TOUCHED module, and nothing per untouched
   * one — measured, because this is the one term in it that grows.
   *
   * Counted rather than timed: what matters is the shape, and a wall-clock
   * assertion on a loaded CI box measures the box. `O(touched)` is the intended
   * cost and is what the publish gate needs; anything multiplied by the chain
   * length or by the project's size would put whole-project work back on a burst
   * of typing, which is exactly what the debounce above exists to prevent.
   */
  it("scales with the modules touched, not with the project or the chain", async () => {
    const { c, s } = initVal();
    const PROJECT = 30;
    const modules = Array.from({ length: PROJECT }, (_, index) =>
      c.define(`/m${index}.val.ts`, s.object({ title: s.string() }), {
        title: `Module ${index}`,
      }),
    );

    /** `[modules touched, chain length, validations]`, collected then asserted. */
    const measured: [number, number, number][] = [];
    for (const touched of [1, 3, 10]) {
      const {
        sourceStore,
        patchStore,
        validationStore,
        activity,
        pendingValidation,
        dispose,
      } = initTestSystem({ manualPendingValidation: true });
      await sourceStore.testReceive(modules);

      const before = activity.position();
      // Several patches per module, so the chain is longer than the set of
      // modules it touches: the count must follow the modules, not the chain.
      const ROUNDS = 4;
      for (let round = 0; round < ROUNDS; round++) {
        for (let index = 0; index < touched; index++) {
          await patchStore.createPatch(`/m${index}.val.ts`, [
            { op: "replace", path: ["title"], value: `edit ${round}` },
          ]);
        }
      }
      // One pass, fired once the whole burst is in: on the real debounce a pass
      // that fired MID-burst validated the modules touched so far, the next
      // patches marked them stale again, and the following pass validated them
      // a second time — so the count came out above `touched` and the test read
      // as a scaling regression rather than as the race it was.
      expect(pendingValidation.armed).toBe(1);
      pendingValidation.fire();
      await afterValidated(
        validationStore,
        Array.from({ length: touched }, (_, index) => `/m${index}.val.ts`),
      );

      measured.push([
        touched,
        touched * ROUNDS,
        activity.count("validation:schema-validate", { since: before }),
      ]);
      dispose();
    }

    // Asserted as a whole so a failure shows every case: one validation per
    // touched module, whatever the chain length or the project size.
    expect(measured).toEqual([
      [1, 4, 1],
      [3, 12, 3],
      [10, 40, 10],
    ]);
  });
});
