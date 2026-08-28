import { previewScope } from "./preview";
import { array } from "./schema/array";
import { object } from "./schema/object";
import { record } from "./schema/record";
import { string } from "./schema/string";
import { SourcePath } from "./val";

/**
 * `PreviewScope` is the mechanism that makes a preview proportional to what is
 * on screen rather than to the project. The two questions it answers are easy to
 * conflate, and conflating them either previews too much (no saving) or previews
 * a list with rows missing (a broken screen), so both are pinned here.
 */
describe("previewScope", () => {
  const sp = (path: string) => path as SourcePath;

  it("wants exactly the paths it was given", () => {
    const scope = previewScope([sp('/a.val.ts?p="title"')]);

    expect(scope.wants(sp('/a.val.ts?p="title"'))).toBe(true);
    expect(scope.wants(sp('/a.val.ts?p="body"'))).toBe(false);
    // The container is not wanted: a request for a field inside it is not a
    // request for the whole of it. This is the distinction that makes a
    // container's preview windowed rather than complete.
    expect(scope.wants(sp("/a.val.ts"))).toBe(false);
  });

  it("wants under both ancestors and descendants of a wanted path", () => {
    const scope = previewScope([sp('/a.val.ts?p="rows".2."title"')]);

    // Ancestors: recursion has to pass through them to reach what was asked for.
    expect(scope.wantsUnder(sp("/a.val.ts"))).toBe(true);
    expect(scope.wantsUnder(sp('/a.val.ts?p="rows"'))).toBe(true);
    expect(scope.wantsUnder(sp('/a.val.ts?p="rows".2'))).toBe(true);
    // Descendants: asking for a node asks for its subtree.
    expect(scope.wantsUnder(sp('/a.val.ts?p="rows".2."title"."x"'))).toBe(true);
    // Siblings: the whole point.
    expect(scope.wantsUnder(sp('/a.val.ts?p="rows".1'))).toBe(false);
    expect(scope.wantsUnder(sp('/a.val.ts?p="other"'))).toBe(false);
  });

  it("never crosses a module boundary", () => {
    const scope = previewScope([sp('/a.val.ts?p="title"')]);

    expect(scope.wantsUnder(sp("/b.val.ts"))).toBe(false);
    expect(scope.wants(sp('/b.val.ts?p="title"'))).toBe(false);
  });

  /**
   * The bug a string-prefix implementation has. `"title"` is a prefix of
   * `"titles"` as a STRING but not as a path, so `startsWith` would report the
   * sibling as wanted and quietly preview it.
   */
  it("compares segments, not string prefixes", () => {
    const scope = previewScope([sp('/a.val.ts?p="title"')]);

    expect(scope.wantsUnder(sp('/a.val.ts?p="titles"'))).toBe(false);
    expect(scope.wants(sp('/a.val.ts?p="titles"'))).toBe(false);
  });

  it("treats a key containing a dot as one segment", () => {
    const scope = previewScope([sp('/a.val.ts?p="a.b"."c"')]);

    expect(scope.wantsUnder(sp('/a.val.ts?p="a.b"'))).toBe(true);
    // `"a"` is not an ancestor of `"a.b"`: the dot is inside the key, not a
    // separator. A prefix comparison cannot tell those apart.
    expect(scope.wantsUnder(sp('/a.val.ts?p="a"'))).toBe(false);
  });

  it("wants everything when the module root is asked for", () => {
    const scope = previewScope(["/a.val.ts" as SourcePath]);

    expect(scope.wants(sp("/a.val.ts"))).toBe(true);
    expect(scope.wantsUnder(sp('/a.val.ts?p="anything".3'))).toBe(true);
  });
});

describe("scoped executePreview", () => {
  const sp = (path: string) => path as SourcePath;

  function listSchema() {
    let calls = 0;
    const schema = array(object({ name: string() })).preview(({ val }) => {
      calls++;
      return { title: val.name };
    });
    return { schema, calls: () => calls };
  }

  const rows = [{ name: "Ada" }, { name: "Grace" }, { name: "Alan" }];

  it("previews every row with no scope, as it always did", () => {
    const { schema, calls } = listSchema();

    const res = schema["executePreview"](sp("/test.val.ts"), rows);

    expect(calls()).toBe(3);
    const at = res[sp("/test.val.ts")];
    if (at?.status !== "success" || at.data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(at.data.items.map(([index]) => index)).toEqual([0, 1, 2]);
  });

  it("previews one row when only that row is wanted", () => {
    const { schema, calls } = listSchema();

    const res = schema["executePreview"](
      sp("/test.val.ts"),
      rows,
      previewScope([sp("/test.val.ts?p=1")]),
    );

    expect(calls()).toBe(1);
    const at = res[sp("/test.val.ts")];
    if (at?.status !== "success" || at.data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(at.data.items).toEqual([
      [1, { title: "Grace", subtitle: undefined, image: undefined }],
    ]);
  });

  it("previews every row when the list itself is wanted", () => {
    const { schema, calls } = listSchema();

    const res = schema["executePreview"](
      sp("/test.val.ts"),
      rows,
      previewScope([sp("/test.val.ts")]),
    );

    // A list VIEW asks for the container and needs all of it. Windowing here
    // would be a list with rows missing.
    expect(calls()).toBe(3);
    const at = res[sp("/test.val.ts")];
    if (at?.status !== "success" || at.data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(at.data.items.map(([index]) => index)).toEqual([0, 1, 2]);
  });

  /**
   * A throwing preview closure used to produce an error at the CONTAINER and no
   * items at all, so one bad row took out the whole list. Now it is per row —
   * matching what `record` already did — because windowing made the per-item
   * loop the natural place for the try.
   */
  it("keeps the rows a throwing preview did not touch", () => {
    const schema = array(object({ name: string() })).preview(({ val }) => {
      if (val.name === "Grace") {
        throw new Error("nope");
      }
      return { title: val.name };
    });

    const res = schema["executePreview"](sp("/test.val.ts"), rows);

    const at = res[sp("/test.val.ts")];
    if (at?.status !== "success" || at.data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(at.data.items.map(([index]) => index)).toEqual([0, 2]);
    expect(res[sp("/test.val.ts?p=1")]).toEqual({
      status: "error",
      message: "nope",
    });
  });

  it("windows a record to the wanted entry", () => {
    let calls = 0;
    const schema = record(object({ name: string() })).preview(
      ({ key, val }) => {
        calls++;
        return { title: `${key}: ${val.name}` };
      },
    );
    const src = { a: { name: "Ada" }, b: { name: "Grace" } };

    const res = schema["executePreview"](
      sp("/test.val.ts"),
      src,
      previewScope([sp('/test.val.ts?p="b"')]),
    );

    expect(calls).toBe(1);
    const at = res[sp("/test.val.ts")];
    if (at?.status !== "success" || at.data.parent !== "record") {
      throw new Error("expected a record preview");
    }
    expect(at.data.items.map(([key]) => key)).toEqual(["b"]);
  });

  /**
   * The nested case, which is the one the whole exercise is for: `handboka` has
   * a `preview` at two array levels, so an unscoped preview of one visible
   * section walks every chapter and every section.
   */
  it("prunes sibling subtrees in a nested list", () => {
    let outer = 0;
    let inner = 0;
    const schema = array(
      object({
        title: string(),
        sections: array(object({ heading: string() })).preview(({ val }) => {
          inner++;
          return { title: val.heading };
        }),
      }),
    ).preview(({ val }) => {
      outer++;
      return { title: val.title };
    });
    const src = [
      { title: "One", sections: [{ heading: "1.1" }, { heading: "1.2" }] },
      { title: "Two", sections: [{ heading: "2.1" }, { heading: "2.2" }] },
    ];

    schema["executePreview"](
      sp("/test.val.ts"),
      src,
      previewScope([sp('/test.val.ts?p=1."sections".0')]),
    );

    // One chapter of two, one section of two within it.
    expect(outer).toBe(1);
    expect(inner).toBe(1);
  });
});
