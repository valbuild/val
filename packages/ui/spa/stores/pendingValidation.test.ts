import { initVal } from "@valbuild/core";
import { initTestSystem, mfp } from "./testSystem";

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

/** Past the 300ms debounce, with room for the validation itself. */
const afterDebounce = () => new Promise((resolve) => setTimeout(resolve, 500));

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

    await afterDebounce();

    const seen = validationStore.peek(mfp("/t.val.ts"));
    if (seen.status !== "validated" || seen.errors === false) {
      throw new Error(
        `the publish gate would have had nothing to go on: ${JSON.stringify(seen)}`,
      );
    }
    expect(JSON.stringify(seen.errors)).toContain("at least 4 characters long");
    dispose();
  });

  it("costs one validation for a burst, not one per keystroke", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    const before = activity.position();
    for (let index = 0; index < 40; index++) {
      await patchStore.createPatch("/t.val.ts", [
        { op: "replace", path: ["title"], value: `Hello ${index}` },
      ]);
    }
    // Still nothing during the burst — the debounce has not elapsed.
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(0);

    await afterDebounce();

    // One pass over the pending modules, not forty.
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(1);
    dispose();
  });

  it("does not validate a module with nothing pending", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();
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
    await afterDebounce();

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
      const { sourceStore, patchStore, activity, dispose } = initTestSystem();
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
      await afterDebounce();

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
