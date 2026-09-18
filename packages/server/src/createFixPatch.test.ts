import {
  initVal,
  Schema,
  SelectorSource,
  Source,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { createFixPatch, mediaValue } from "./createFixPatch";

/**
 * The value the four remote fixes replace a media field with.
 *
 * Each of them wrote this shape out by hand, and `image:check-remote` was left
 * behind writing `{_type, _ref, metadata}` when the shape changed — a fix that
 * would have put a marker object back into a user's file. Hence one name, and a
 * test on it.
 */
describe("mediaValue", () => {
  test("puts the metadata beside the path, not inside it", () => {
    expect(
      mediaValue("https://remote.val.build/file/p/x/hero.png", {
        width: 944,
        height: 944,
        mimeType: "image/png",
      }),
    ).toEqual({
      path: "https://remote.val.build/file/p/x/hero.png",
      width: 944,
      height: 944,
      mimeType: "image/png",
    });
  });

  test("a media value with no metadata is just a path", () => {
    expect(mediaValue("/public/val/hero.png", undefined)).toEqual({
      path: "/public/val/hero.png",
    });
  });

  test("keeps the authored fields the fix is not about", () => {
    // `alt` and `hotspot` share the object with the derived fields now, so a
    // whole-value fix must carry them across.
    expect(
      mediaValue("/public/val/hero.png", {
        width: 8,
        height: 8,
        mimeType: "image/png",
        alt: "A hero",
        hotspot: { x: 0.5, y: 0.3 },
      }),
    ).toEqual({
      path: "/public/val/hero.png",
      width: 8,
      height: 8,
      mimeType: "image/png",
      alt: "A hero",
      hotspot: { x: 0.5, y: 0.3 },
    });
  });

  test("the path the fix names wins over a stray one in the metadata", () => {
    expect(
      mediaValue("/public/val/new.png", { path: "/public/val/old.png" }),
    ).toEqual({ path: "/public/val/new.png" });
  });

  test("metadata that is not an object is ignored rather than spread", () => {
    expect(mediaValue("/public/val/hero.png", "nonsense")).toEqual({
      path: "/public/val/hero.png",
    });
    expect(mediaValue("/public/val/hero.png", [1, 2])).toEqual({
      path: "/public/val/hero.png",
    });
  });
});

/**
 * A view's pointer can only disagree with its schema in hand-written JSON — in
 * a `.val.ts` the source type is the literal path, so a mismatch does not
 * compile. When it does happen there is nothing to decide: the schema names the
 * module, so the one correct value is already known and gets written.
 */
describe("view:check-module", () => {
  const { s, c } = initVal();
  const otherVal = c.define("/other.val.ts", s.string(), "hi");
  const pageSchema = s.object({
    title: s.string(),
    shared: s.view(otherVal),
  });
  const moduleSchema = (pageSchema as unknown as Schema<SelectorSource>)[
    "executeSerialize"
  ]();
  const moduleSource: Source = {
    title: "Hello",
    shared: { view: "/wrong.val.ts" },
  };
  const validationError: ValidationError = {
    message:
      "This view points at '/wrong.val.ts', but its schema says '/other.val.ts'",
    value: { view: "/wrong.val.ts" },
    fixes: ["view:check-module"],
  };

  test("writes the module the schema names", async () => {
    const res = await createFixPatch(
      { projectRoot: "/tmp", remoteHost: "https://remote.val.build" },
      true,
      '/page.val.ts?p="shared"' as SourcePath,
      validationError,
      {},
      moduleSource,
      moduleSchema,
    );
    expect(res?.patch).toEqual([
      {
        op: "replace",
        path: ["shared"],
        value: { view: "/other.val.ts" },
      },
    ]);
    expect(res?.remainingErrors).toEqual([]);
  });

  test("without --fix it reports what the fix would write, and patches nothing", async () => {
    const res = await createFixPatch(
      { projectRoot: "/tmp", remoteHost: "https://remote.val.build" },
      false,
      '/page.val.ts?p="shared"' as SourcePath,
      validationError,
      {},
      moduleSource,
      moduleSchema,
    );
    expect(res?.patch).toEqual([]);
    expect(res?.remainingErrors).toEqual([
      expect.objectContaining({
        message:
          "This view points at the wrong module. Expected '/other.val.ts'.",
      }),
    ]);
  });

  test("a schema that is not a view at that path is reported, not guessed at", async () => {
    const res = await createFixPatch(
      { projectRoot: "/tmp", remoteHost: "https://remote.val.build" },
      true,
      '/page.val.ts?p="title"' as SourcePath,
      validationError,
      {},
      moduleSource,
      moduleSchema,
    );
    expect(res?.patch).toEqual([]);
    expect(res?.remainingErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("is 'string', not a view"),
      }),
    ]);
  });
});
