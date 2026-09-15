import { initVal } from "../initVal";
import { previewScope } from "../preview";
import { ModuleFilePath, SourcePath } from "../val";

const { s } = initVal();

const module = "/content/footer.val.ts" as ModuleFilePath;
const at = (modulePath: string) =>
  `${module}?p=${modulePath}` as unknown as SourcePath;

/**
 * A value's SELF preview: what it is called, at its own path.
 *
 * Before this, a value's preview was reified only by its CONTAINER, so a value
 * with no container had none — `.preview(...)` on a module's own schema was
 * dead code, and the studio showed the file name with nothing a developer
 * wrote able to change it. Same for any field of an object, which reifies no
 * rows. See `PreviewNode` in `preview.ts`.
 */
describe("self preview", () => {
  test("a module root previews itself", () => {
    const schema = s
      .array(s.object({ title: s.string() }))
      .preview(({ val }) => ({
        title: "Footer links",
        subtitle: `${val.length} groups`,
      }));
    const res = schema["executePreview"](module, [
      { title: "Community" },
      { title: "Legal" },
    ]);
    expect(res[module]).toEqual({
      status: "success",
      data: {
        self: {
          title: "Footer links",
          subtitle: "2 groups",
          image: undefined,
        },
      },
    });
  });

  test("a field of an object previews itself", () => {
    const schema = s.object({
      hero: s
        .object({ heading: s.string() })
        .preview(({ val }) => ({ title: val.heading })),
    });
    const res = schema["executePreview"](module, {
      hero: { heading: "Content is code" },
    });
    expect(res[at('"hero"')]).toEqual({
      status: "success",
      data: {
        self: {
          title: "Content is code",
          subtitle: undefined,
          image: undefined,
        },
      },
    });
  });

  test("a leaf previews itself", () => {
    const schema = s.object({
      slug: s.string().preview(({ val }) => ({ title: `/${val}` })),
    });
    const res = schema["executePreview"](module, { slug: "launch" });
    expect(res[at('"slug"')]).toMatchObject({
      status: "success",
      data: { self: { title: "/launch" } },
    });
  });

  /**
   * The case that made `self` and `rows` two FIELDS rather than a union: a list
   * that previews its rows AND names itself for when it is nested in something.
   * One of them would have had to win.
   */
  test("a list can have both a self and rows at the same path", () => {
    const schema = s
      .array(
        s.object({ title: s.string() }).preview(({ val }) => ({
          title: val.title,
        })),
      )
      .preview(({ val }) => ({ title: `${val.length} sections` }));
    const res = schema["executePreview"](module, [{ title: "Hero" }]);
    const node = res[module];
    if (node?.status !== "success") {
      throw new Error("expected a preview");
    }
    expect(node.data.self).toMatchObject({ title: "1 sections" });
    expect(node.data.rows).toMatchObject({
      parent: "array",
      items: [[0, { title: "Hero" }]],
    });
  });

  /**
   * A row's preview lives in its container's `rows` and NOT also in its own
   * `self`: it is one closure, and running it twice per row is what the scoped
   * preview work exists to avoid. Counted rather than asserted structurally,
   * because the structure cannot tell one call from two.
   */
  test("a row is reified once, by its container", () => {
    let calls = 0;
    const schema = s.array(
      s.object({ name: s.string() }).preview(({ val }) => {
        calls++;
        return { title: val.name };
      }),
    );
    const res = schema["executePreview"](module, [
      { name: "Ada" },
      { name: "Grace" },
    ]);
    expect(calls).toBe(2);
    expect(res[at("0")]).toBeUndefined();
  });

  test("a record entry is likewise reified once", () => {
    let calls = 0;
    const schema = s.record(
      s.object({ name: s.string() }).preview(({ val }) => {
        calls++;
        return { title: val.name };
      }),
    );
    schema["executePreview"](module, { ada: { name: "Ada" } });
    expect(calls).toBe(1);
  });

  /**
   * The same rule when the row is ITSELF a container.
   *
   * A container both PASSES `selfIsReifiedByParent` to its items and can
   * RECEIVE it as one, and array and record — the two that pass it — were the
   * two that ignored it on the way in. So a list of lists, or a list of
   * records, ran the inner closure twice per row: once as the outer
   * container's row, and again as the inner container naming itself. The
   * leaked `self` also sat at a path its parent already answers for, which is
   * the shape `asSeenFromBelow` exists to keep out of the store.
   */
  test("a nested array is reified once, by its container", () => {
    let calls = 0;
    const schema = s.array(
      s.array(s.string()).preview(({ val }) => {
        calls++;
        return { title: `${val.length} items` };
      }),
    );
    const res = schema["executePreview"](module, [["a", "b"], ["c"]]);
    expect(calls).toBe(2);
    expect(res[at("0")]).toBeUndefined();
  });

  test("a nested record is reified once, by its container", () => {
    let calls = 0;
    const schema = s.array(
      s.record(s.string()).preview(({ val }) => {
        calls++;
        return { title: `${Object.keys(val).length} entries` };
      }),
    );
    const res = schema["executePreview"](module, [{ ada: "Ada" }]);
    expect(calls).toBe(1);
    expect(res[at("0")]).toBeUndefined();
  });

  test("a discriminated union previews itself through the matched variant", () => {
    const schema = s.object({
      block: s.discriminatedUnion(
        "type",
        s
          .object({ type: s.literal("text"), body: s.string() })
          .preview(({ val }) => ({ title: `Text: ${val.body}` })),
        s
          .object({ type: s.literal("image"), alt: s.string() })
          .preview(({ val }) => ({ title: `Image: ${val.alt}` })),
      ),
    });
    const res = schema["executePreview"](module, {
      block: { type: "image", alt: "A logo" },
    });
    expect(res[at('"block"')]).toMatchObject({
      status: "success",
      data: { self: { title: "Image: A logo" } },
    });
  });

  test("a closure that throws is an error at that path, not a dead module", () => {
    const schema = s.object({
      hero: s.object({ heading: s.string() }).preview(() => {
        throw new Error("boom");
      }),
      other: s
        .object({ heading: s.string() })
        .preview(({ val }) => ({ title: val.heading })),
    });
    const res = schema["executePreview"](module, {
      hero: { heading: "a" },
      other: { heading: "b" },
    });
    expect(res[at('"hero"')]).toEqual({ status: "error", message: "boom" });
    expect(res[at('"other"')]).toMatchObject({
      status: "success",
      data: { self: { title: "b" } },
    });
  });

  test("no `.preview()` means no self entry at all", () => {
    const schema = s.object({ hero: s.object({ heading: s.string() }) });
    expect(
      schema["executePreview"](module, { hero: { heading: "a" } }),
    ).toEqual({});
  });

  /**
   * Scope gates `self` on `wants`, not `wantsUnder`: a caller asking about a
   * CONTAINER wants its rows, and computing a self for every descendant on the
   * way past would run each closure for nothing.
   */
  test("a scope that does not want this path gets no self for it", () => {
    const schema = s.object({
      hero: s
        .object({ heading: s.string() })
        .preview(({ val }) => ({ title: val.heading })),
      footer: s
        .object({ heading: s.string() })
        .preview(({ val }) => ({ title: val.heading })),
    });
    const src = { hero: { heading: "a" }, footer: { heading: "b" } };
    const res = schema["executePreview"](
      module,
      src,
      previewScope([at('"hero"')]),
    );
    expect(res[at('"hero"')]).toMatchObject({
      status: "success",
      data: { self: { title: "a" } },
    });
    expect(res[at('"footer"')]).toBeUndefined();
  });
});
