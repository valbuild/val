import { initVal } from "../initVal";
import { Internal } from "../index";
import { hasMediaSchema } from "./hasRemoteFileSchema";
import { deserializeSchema } from "./deserialize";
import { SourcePath } from "../val";
import { ValidationError } from "./validation/ValidationError";

const { s, c } = initVal();

const path = "/test.val.ts" as SourcePath;

describe("s.record().external()", () => {
  test("serializes the label, and deserializing carries it back", () => {
    const schema = s.record(s.object({ title: s.string() })).external("posts");
    const serialized = schema["executeSerialize"]();

    expect(serialized.type).toBe("record");
    expect(serialized).toMatchObject({ external: "posts" });

    // Round trip: a deserialized schema that dropped the label would walk an
    // external record as if its entries were local.
    expect(deserializeSchema(serialized)["executeSerialize"]()).toMatchObject({
      external: "posts",
    });
  });

  test("a record without .external() has no label", () => {
    expect(s.record(s.string())["executeSerialize"]()).not.toHaveProperty(
      "external",
      expect.anything(),
    );
  });

  test("the c.external() marker validates", () => {
    const schema = s.record(s.string()).external("posts");
    expect(schema["executeValidate"](path, c.external())).toBe(false);
  });

  test("entries written inline are reported as an external:upload fix", () => {
    const schema = s.record(s.string()).external("posts");
    // Deliberately legal at the type level — see ExternalRecordWritableSrc: a
    // type error here would be a dead end, so validation reports it instead.
    // The runtime accepts more than `Src` describes: inline entries are legal at
    // the `c.define` call (see InlineEntriesFor), and this is what reports them.
    const errors = schema["executeValidate"](path, {
      hello: "world",
    } as never);

    expect(errors).not.toBe(false);
    const byPath = errors as Record<SourcePath, ValidationError[]>;
    const paths = Object.keys(byPath) as SourcePath[];
    expect(paths).toHaveLength(1);
    expect(byPath[paths[0]][0].fixes).toEqual(["external:upload"]);
    expect(byPath[paths[0]][0].message).toContain("val external upload");
  });

  test("every inline entry is reported, at its own path", () => {
    const schema = s.record(s.string()).external("posts");
    const errors = schema["executeValidate"](path, { a: "1", b: "2" } as never);
    // Per key, not once for the record: that is what lets a fix be applied to
    // one entry, and puts the error somewhere the editor can navigate to.
    expect(Object.keys(errors as Record<string, unknown>)).toHaveLength(2);
  });

  test("a non-object source is a schema error", () => {
    const schema = s.record(s.string()).external("posts");
    const errors = schema["executeValidate"](path, "nope" as never) as Record<
      SourcePath,
      ValidationError[]
    >;
    expect(errors).not.toBe(false);
    expect(Object.values(errors)[0][0].schemaError).toBe(true);
  });

  test("is available on every record-derived schema", () => {
    // A router is a RecordSchema with a ValRouter, a gallery one with media
    // options — so all of them get external storage from the one method.
    const images = s.images({
      accept: "image/*",
      directory: "/public/val/gallery",
    });
    const files = s.files({
      accept: "application/pdf",
      directory: "/public/val/docs",
    });

    expect(
      s.record(s.string()).external("a")["executeSerialize"](),
    ).toMatchObject({ external: "a" });
    expect(images.external("b")["executeSerialize"]()).toMatchObject({
      external: "b",
      // The flavour marker survives alongside the external one.
      mediaType: "images",
    });
    expect(files.external("c")["executeSerialize"]()).toMatchObject({
      external: "c",
      mediaType: "files",
    });
  });

  test("keeps readonly, and readonly comes first", () => {
    // `.readonly()` must precede `.external()`: the latter freezes the flag into
    // the source marker, and afterwards there is no `.readonly()` left to call.
    expect(
      s.record(s.string()).readonly().external("posts")["executeSerialize"](),
    ).toMatchObject({ readonly: true, external: "posts" });
  });

  test("refuses to combine with .jsonValues()", () => {
    expect(() => s.record(s.string()).jsonValues().external("posts")).toThrow(
      /cannot be combined/,
    );
  });

  test("accepts entries written inline at the c.define call", () => {
    // A type error here would be a dead end for the author, so this must
    // compile; validation is what reports it, as the test above asserts.
    const mod = c.define(
      "/test.val.ts",
      s.record(s.string()).external("test"),
      { this: "should not fail on the type level" },
    );
    expect(mod).toBeDefined();
  });

  test("requires a label", () => {
    expect(() => s.record(s.string()).external("")).toThrow(/requires a label/);
  });
});

describe("external file refs", () => {
  const ref = Internal.createExternalFileRef({
    label: "documents",
    fileHash: "a1b2c3d4e5f6",
    filePath: "/public/val/docs/report_a1b2c.pdf",
  });

  test("carries the virtual path, and gives it back", () => {
    // The same idea as a remote ref: the file's logical identity survives
    // wherever its bytes live, so moving between storage modes is mechanical.
    const parts = Internal.splitExternalFileRef(ref);
    expect(parts).toMatchObject({
      status: "success",
      label: "documents",
      fileHash: "a1b2c3d4e5f6",
      filePath: "public/val/docs/report_a1b2c.pdf",
    });
  });

  test("is remote by the media rule, so media.ts needs no change", () => {
    // `isRemote` is `!path.startsWith("/public")` — the ref does not, so
    // mediaUrl returns it as-is for Val's route to serve.
    expect(ref.startsWith("/public")).toBe(false);
    expect(Internal.mediaUrl({ path: ref })).toBe(ref);
  });

  test("rejects a path outside /public, and path traversal", () => {
    expect(() =>
      Internal.createExternalFileRef({
        label: "documents",
        fileHash: "abc",
        filePath: "/etc/passwd",
      }),
    ).toThrow(/under '\/public'/);
    expect(
      Internal.splitExternalFileRef(
        "/api/val/external/d/f/abc/p/public/val/../../etc/passwd",
      ).status,
    ).toBe("error");
  });

  test("a non-ref is an error, not a throw", () => {
    expect(Internal.splitExternalFileRef("/public/val/x.pdf").status).toBe(
      "error",
    );
    expect(Internal.isExternalFileRef(ref)).toBe(true);
    expect(Internal.isExternalFileRef("/public/val/x.pdf")).toBe(false);
  });
});

describe("hasMediaSchema", () => {
  test("finds a plain image or file field", () => {
    expect(
      hasMediaSchema(s.object({ hero: s.image() })["executeSerialize"]()),
    ).toBe(true);
  });

  test("finds a GALLERY, which has no image schema inside it", () => {
    // The case a walk over the item TYPE would miss: `item` is width/height/
    // mimeType metadata and the file is named by the record's key. Getting this
    // wrong once already committed remote refs with no bytes behind them.
    const gallery = s.images({
      accept: "image/*",
      directory: "/public/val/g",
    });
    expect(hasMediaSchema(gallery["executeSerialize"]())).toBe(true);
  });

  test("finds an inline richtext image, which lives in a constructor arg", () => {
    const rt = s.richtext({ inline: { img: true } });
    expect(hasMediaSchema(rt["executeSerialize"]())).toBe(true);
  });

  test("says no when there is no media", () => {
    expect(
      hasMediaSchema(
        s.object({ title: s.string(), n: s.number() })["executeSerialize"](),
      ),
    ).toBe(false);
    expect(hasMediaSchema(s.record(s.string())["executeSerialize"]())).toBe(
      false,
    );
  });

  test("looks through arrays and records", () => {
    expect(
      hasMediaSchema(s.array(s.object({ f: s.file() }))["executeSerialize"]()),
    ).toBe(true);
    expect(
      hasMediaSchema(
        s.record(s.object({ i: s.image() }))["executeSerialize"](),
      ),
    ).toBe(true);
  });
});
