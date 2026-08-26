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
});
