import { initVal } from "@valbuild/core";
import { initTestSystem, mfp, sp } from "./testSystem";

/**
 * How much work does one thing cost?
 *
 * The premise of the whole rewrite is that a keystroke's cost should be
 * proportional to the edited field rather than to the project. That is a claim
 * about HOW MANY times each expensive operation runs, so these tests assert
 * counts and nothing else.
 *
 * Every expectation here is read off a claim in `architecture.md` or a store's
 * own doc comment. Where a count comes out higher than the claim, the claim is
 * what is wrong — and that is the finding.
 */

const blogs = () => {
  const { c, s } = initVal();
  return c.define(
    "/blogs.val.ts",
    s.object({ title: s.string(), body: s.string() }),
    { title: "Hello", body: "World" },
  );
};

const authors = () => {
  const { c, s } = initVal();
  return c.define("/authors.val.ts", s.object({ name: s.string() }), {
    name: "Ada",
  });
};

/**
 * A module that actually declares a render.
 *
 * Needed because `RenderStore` no longer crosses the host seam for a module
 * whose schema declares no render — so a test about how many host calls a render
 * costs has to use a module that can produce one, or it measures nothing.
 */
const rendered = () => {
  const { c, s } = initVal();
  return c.define(
    "/rendered.val.ts",
    s.array(s.object({ title: s.string() })).render({
      as: "list",
      select: ({ val }) => ({ title: val.title }),
    }),
    [{ title: "one" }, { title: "two" }],
  );
};

describe("cost of intake", () => {
  it("clones and serializes each module exactly once, and computes nothing", async () => {
    const { sourceStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([blogs(), authors()]);

    expect(activity.count("source:clone-module")).toBe(2);
    expect(activity.count("host:serialize-schema")).toBe(2);
    // One receive for the batch, not one per module.
    expect(activity.count("schema:receive")).toBe(1);

    // Lazy is the point: intake marks things stale and computes nothing.
    expect(activity.count("host:execute-render")).toBe(0);
    expect(activity.count("validation:schema-validate")).toBe(0);
    expect(activity.count("host:execute-validate")).toBe(0);
    expect(activity.count("search:build-index")).toBe(0);
    expect(activity.count("search:gather-snapshot")).toBe(0);
    dispose();
  });
});

describe("cost of one keystroke", () => {
  it("costs one clone, one apply, and one woken field", async () => {
    const { sourceStore, patchStore, activity, listeners, dispose } =
      initTestSystem();

    await sourceStore.testReceive([blogs(), authors()]);
    // Two fields mounted in the edited module, one in another module.
    listeners.set('/blogs.val.ts?p="title"');
    listeners.set('/blogs.val.ts?p="body"');
    listeners.set('/authors.val.ts?p="name"');

    const before = activity.position();
    await patchStore.createPatch("/blogs.val.ts", [
      { op: "replace", path: ["title"], value: "Hello World" },
    ]);

    expect(activity.count("patch:create", { since: before })).toBe(1);
    expect(activity.count("source:apply-patch", { since: before })).toBe(1);
    // The module is cloned once to apply the patch to. Not once per mounted
    // field — that per-field clone is defect #3 in the old engine's diagnosis.
    expect(activity.count("source:clone-module", { since: before })).toBe(1);
    // The registry is walked once, and exactly the one affected field is woken.
    expect(activity.count("source:scan-listeners", { since: before })).toBe(1);
    expect(activity.count("source:wake-listener", { since: before })).toBe(1);

    // Nothing else in the system may do work on a keystroke.
    expect(activity.count("host:execute-render", { since: before })).toBe(0);
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(0);
    expect(activity.count("search:build-index", { since: before })).toBe(0);
    expect(activity.count("search:gather-snapshot", { since: before })).toBe(0);
    dispose();
  });

  /**
   * CLAIM (`PatchSetStore`): patch sets are wanted "only when someone opens the
   * review or publish UI", and "folding them together would put patch-set
   * bookkeeping on the keystroke path to serve a screen that is usually not
   * open — which is the shape of the problem this architecture exists to
   * remove."
   */
  it("does no patch-set bookkeeping", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([blogs()]);
    const before = activity.position();
    await patchStore.createPatch("/blogs.val.ts", [
      { op: "replace", path: ["title"], value: "Hello World" },
    ]);

    expect(activity.count("patch-set:insert", { since: before })).toBe(0);
    dispose();
  });

  it("costs the same per keystroke over a burst of 40", async () => {
    const { sourceStore, patchStore, activity, listeners, dispose } =
      initTestSystem();

    await sourceStore.testReceive([blogs(), authors()]);
    listeners.set('/blogs.val.ts?p="title"');

    const before = activity.position();
    for (let index = 0; index < 40; index++) {
      await patchStore.createPatch("/blogs.val.ts", [
        { op: "replace", path: ["title"], value: `Hello ${index}` },
      ]);
    }

    expect(activity.count("source:apply-patch", { since: before })).toBe(40);
    expect(activity.count("source:clone-module", { since: before })).toBe(40);
    expect(activity.count("source:wake-listener", { since: before })).toBe(40);
    // The whole point of lazy: 40 keystrokes, zero renders, zero validations.
    expect(activity.count("host:execute-render", { since: before })).toBe(0);
    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(0);
    dispose();
  });

  it("does no work in a module it did not touch", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([blogs(), authors()]);
    const before = activity.position();
    await patchStore.createPatch("/blogs.val.ts", [
      { op: "replace", path: ["title"], value: "Hello World" },
    ]);

    expect(
      activity.count("source:clone-module", {
        since: before,
        subject: "/authors.val.ts",
      }),
    ).toBe(0);
    dispose();
  });
});

describe("cost of reading", () => {
  /**
   * CLAIM (`ValidationStore`): "Concurrent readers of one module share a single
   * validation", and a cached result is served without recomputing.
   */
  it("validates a module once however many times it is read", async () => {
    const { sourceStore, validationStore, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([blogs()]);
    const before = activity.position();

    await validationStore.validate(mfp("/blogs.val.ts"));
    await validationStore.validate(mfp("/blogs.val.ts"));
    await validationStore.validate(mfp("/blogs.val.ts"));

    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(1);
    expect(activity.count("validation:cache-hit", { since: before })).toBe(2);
    dispose();
  });

  it("validates once for concurrent readers", async () => {
    const { sourceStore, validationStore, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([blogs()]);
    const before = activity.position();

    await Promise.all([
      validationStore.validate(mfp("/blogs.val.ts")),
      validationStore.validate(mfp("/blogs.val.ts")),
      validationStore.validate(mfp("/blogs.val.ts")),
      validationStore.validate(mfp("/blogs.val.ts")),
      validationStore.validate(mfp("/blogs.val.ts")),
    ]);

    expect(
      activity.count("validation:schema-validate", { since: before }),
    ).toBe(1);
    expect(
      activity.count("validation:share-in-flight", { since: before }),
    ).toBe(4);
    dispose();
  });

  /**
   * CLAIM (`RenderStore`): "In-flight requests, so N fields asking at once
   * produce ONE host call", and one request "fills the cache for every path in
   * the module".
   */
  it("renders a module once for concurrent readers of different paths", async () => {
    const { sourceStore, renderStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([rendered()]);
    const before = activity.position();

    await Promise.all([
      renderStore.get(sp("/rendered.val.ts?p=0")),
      renderStore.get(sp("/rendered.val.ts?p=1")),
      renderStore.get(sp("/rendered.val.ts?p=0")),
    ]);

    expect(activity.count("host:execute-render", { since: before })).toBe(1);
    dispose();
  });

  /**
   * CLAIM (`SchemaStore.declaresRender`): a module that cannot render is never
   * sent to the host to be rendered.
   *
   * Measured, not guessed: mounting 260 fields across 141 modules in Chromium
   * spent ~2.3ms of 3.1ms inside `executeRender` on modules that returned an
   * empty result. In a real project most modules declare no render, so most of
   * that work was provably wasted.
   */
  it("never asks the host to render a module that declares no render", async () => {
    const { sourceStore, renderStore, activity, listeners, dispose } =
      initTestSystem();

    await sourceStore.testReceive([blogs(), authors()]);
    // Both routes to a render: a field mounting, and a caller asking.
    listeners.set('/blogs.val.ts?p="title"');
    const read = await renderStore.get(sp('/blogs.val.ts?p="title"'));

    expect(activity.count("host:execute-render")).toBe(0);
    // And the answer is the same one the host would have produced from an empty
    // render, so nothing downstream can tell the difference.
    expect(read.status).toBe("no-render-at-path");
    dispose();
  });

  it("serves a second render read from cache", async () => {
    const { sourceStore, renderStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([rendered()]);
    await renderStore.get(sp("/rendered.val.ts?p=0"));

    const before = activity.position();
    await renderStore.get(sp("/rendered.val.ts?p=0"));

    expect(activity.count("host:execute-render", { since: before })).toBe(0);
    expect(activity.count("render:cache-hit", { since: before })).toBe(1);
    dispose();
  });
});

describe("cost of the whole-project operations", () => {
  /**
   * CLAIM (`architecture.md`): indexing "never happens as a side effect of an
   * edit", so "the clone is paid per search session, not per keystroke".
   */
  it("gathers the project snapshot only when asked", async () => {
    const { sourceStore, patchStore, buildSearchIndex, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([blogs(), authors()]);
    for (let index = 0; index < 5; index++) {
      await patchStore.createPatch("/blogs.val.ts", [
        { op: "replace", path: ["title"], value: `Hello ${index}` },
      ]);
    }
    expect(activity.count("search:gather-snapshot")).toBe(0);
    expect(activity.count("search:build-index")).toBe(0);

    await buildSearchIndex();
    expect(activity.count("search:gather-snapshot")).toBe(1);
    expect(activity.count("search:build-index")).toBe(1);
    dispose();
  });
});
