import fs from "fs";
import os from "os";
import path from "path";
import {
  initVal,
  Json,
  Schema,
  SelectorSource,
  Source,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { createFixPatch, mediaValue } from "./createFixPatch";
import type { FixFiles } from "./fixFiles";

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

/**
 * A video's derived fields are written one op each, and only the ones that are
 * missing: `alt`, `poster`, `captions` and the times share the object, and a
 * person typed them.
 */
describe("video:add-metadata", () => {
  const { s } = initVal();
  const pageSchema = s.object({ intro: s.video() });
  const moduleSchema = (pageSchema as unknown as Schema<SelectorSource>)[
    "executeSerialize"
  ]();
  let projectRoot: string;
  beforeAll(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-video-fix-"));
    fs.mkdirSync(path.join(projectRoot, "public", "val"), { recursive: true });
    for (const ext of ["mp4", "webm"]) {
      fs.copyFileSync(
        path.join(__dirname, "__fixtures__", "video", `tiny.${ext}`),
        path.join(projectRoot, "public", "val", `intro.${ext}`),
      );
    }
    fs.copyFileSync(
      path.join(__dirname, "__fixtures__", "video", "live.webm"),
      path.join(projectRoot, "public", "val", "recording.webm"),
    );
  });
  afterAll(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const fixFor = (intro: Record<string, Json>, apply = true) => {
    const moduleSource: Source = { intro };
    return createFixPatch(
      { projectRoot, remoteHost: "https://remote.val.build" },
      apply,
      '/page.val.ts?p="intro"' as SourcePath,
      {
        message: "Video metadata is missing",
        value: intro,
        fixes: ["video:add-metadata"],
      },
      {},
      moduleSource,
      moduleSchema,
    );
  };

  test("adds every missing derived field, and touches nothing authored", async () => {
    const res = await fixFor({
      path: "/public/val/intro.mp4",
      alt: "A test pattern",
      captions: [{ path: "/public/val/intro.en.vtt", srclang: "en" }],
    });
    expect(res?.patch).toEqual([
      { op: "add", path: ["intro", "mimeType"], value: "video/mp4" },
      { op: "add", path: ["intro", "width"], value: 64 },
      { op: "add", path: ["intro", "height"], value: 48 },
      { op: "add", path: ["intro", "duration"], value: 1 },
    ]);
    expect(res?.remainingErrors).toEqual([]);
  });

  test("a field that is already there is left alone", async () => {
    const res = await fixFor({
      path: "/public/val/intro.mp4",
      mimeType: "video/mp4",
      width: 640,
    });
    expect(res?.patch).toEqual([
      { op: "add", path: ["intro", "height"], value: 48 },
      { op: "add", path: ["intro", "duration"], value: 1 },
    ]);
  });

  test("a webm's size and length are read from the file", async () => {
    const res = await fixFor({ path: "/public/val/intro.webm" });
    expect(res?.patch).toEqual([
      { op: "add", path: ["intro", "mimeType"], value: "video/webm" },
      { op: "add", path: ["intro", "width"], value: 64 },
      { op: "add", path: ["intro", "height"], value: 48 },
      { op: "add", path: ["intro", "duration"], value: 1 },
    ]);
    expect(res?.remainingErrors).toEqual([]);
  });

  test("a recorded webm that does not declare its length: its duration is not guessed, nothing is written, and it says what to do", async () => {
    const res = await fixFor({ path: "/public/val/recording.webm" });
    expect(res?.patch).toEqual([]);
    expect(res?.remainingErrors).toEqual([
      expect.objectContaining({
        message:
          "Val could not read the duration of /public/val/recording.webm. Upload it again in the Val Studio, or add duration by hand.",
      }),
    ]);
  });

  test("a webm missing only its mime type gets it from the extension", async () => {
    const res = await fixFor({
      path: "/public/val/intro.webm",
      width: 64,
      height: 48,
      duration: 1,
    });
    expect(res?.patch).toEqual([
      { op: "add", path: ["intro", "mimeType"], value: "video/webm" },
    ]);
    expect(res?.remainingErrors).toEqual([]);
  });

  test("a file that is not there is reported, not patched", async () => {
    const res = await fixFor({ path: "/public/val/missing.mp4" });
    expect(res?.patch).toEqual([]);
    expect(res?.remainingErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          "Failed to read video metadata from /public/val/missing.mp4",
        ),
      }),
    ]);
  });

  test("a schema that is not a video at that path is reported, not guessed at", async () => {
    const res = await createFixPatch(
      { projectRoot, remoteHost: "https://remote.val.build" },
      true,
      '/page.val.ts?p="title"' as SourcePath,
      {
        message: "Video metadata is missing",
        value: { path: "/public/val/intro.mp4" },
        fixes: ["video:add-metadata"],
      },
      {},
      { title: "Hello" },
      (s.object({ title: s.string() }) as unknown as Schema<SelectorSource>)[
        "executeSerialize"
      ](),
    );
    expect(res?.patch).toEqual([]);
    expect(res?.remainingErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("is 'string', not a video"),
      }),
    ]);
  });
});

/**
 * A fix reads bytes through `config.files`, not from the disk under
 * `projectRoot`, so it can run where there is no disk: http mode, and the
 * platform's Worker. These run with a `projectRoot` that does not exist, so a
 * read that slipped past `files` fails the test rather than passing by luck.
 */
describe("files", () => {
  // A 1×1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
    "base64",
  );
  const config = (files: FixFiles) => ({
    projectRoot: "/does/not/exist",
    remoteHost: "https://remote.val.build",
    files,
  });
  const unused = () => Promise.reject(new Error("not expected in this test"));

  test("image metadata is read through files", async () => {
    const read: string[] = [];
    const res = await createFixPatch(
      config({
        readFile: async (filePath) => {
          read.push(filePath);
          return png;
        },
        readVideoMetadata: unused,
        saveRemoteFile: unused,
      }),
      true,
      '/content/page.val.ts?p="hero"' as SourcePath,
      {
        message: "Image metadata is missing",
        value: { path: "/public/val/hero.png" },
        fixes: ["image:add-metadata"],
      },
      {},
    );
    expect(read).toEqual(["/public/val/hero.png"]);
    expect(res?.patch).toEqual([
      { op: "add", path: ["hero", "width"], value: 1 },
      { op: "add", path: ["hero", "height"], value: 1 },
      { op: "add", path: ["hero", "mimeType"], value: "image/png" },
    ]);
    expect(res?.remainingErrors).toEqual([]);
  });

  test("video metadata is read through files", async () => {
    const read: string[] = [];
    const res = await createFixPatch(
      config({
        readFile: unused,
        readVideoMetadata: async (filePath) => {
          read.push(filePath);
          return {
            mimeType: "video/mp4",
            width: 1920,
            height: 1080,
            duration: 12.5,
          };
        },
        saveRemoteFile: unused,
      }),
      true,
      '/content/page.val.ts?p="intro"' as SourcePath,
      {
        message: "Video metadata is missing",
        value: { path: "/public/val/intro.mp4" },
        fixes: ["video:add-metadata"],
      },
      {},
    );
    expect(read).toEqual(["/public/val/intro.mp4"]);
    expect(res?.patch).toEqual(
      expect.arrayContaining([
        { op: "add", path: ["intro", "width"], value: 1920 },
        { op: "add", path: ["intro", "height"], value: 1080 },
      ]),
    );
    expect(res?.remainingErrors).toEqual([]);
  });

  test("a downloaded remote file is saved through files, at its project path", async () => {
    const saved: { url: string; filePath: string }[] = [];
    const ref =
      "https://remote.val.build/file/p/3f9a2c1/b/01/v/0.136.2/h/9c41e0b2d7aa/f/3fa9c81be402/p/public/val/hero_3fa9c.png";
    const res = await createFixPatch(
      config({
        readFile: unused,
        readVideoMetadata: unused,
        saveRemoteFile: async (url, filePath) => {
          saved.push({ url, filePath });
          return { status: "success" };
        },
      }),
      true,
      '/content/page.val.ts?p="hero"' as SourcePath,
      {
        message: "Remote file should be local",
        value: { path: ref, width: 1, height: 1, mimeType: "image/png" },
        fixes: ["image:download-remote"],
      },
      {},
    );
    expect(saved).toEqual([
      { url: ref, filePath: "public/val/hero_3fa9c.png" },
    ]);
    expect(res?.patch).toEqual([
      {
        op: "replace",
        path: ["hero"],
        value: {
          path: "/public/val/hero_3fa9c.png",
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
      },
    ]);
  });

  test("a file that cannot be read is an error, not a silent pass", async () => {
    await expect(
      createFixPatch(
        config({
          readFile: () => Promise.reject(new Error("ENOENT")),
          readVideoMetadata: unused,
          saveRemoteFile: unused,
        }),
        true,
        '/content/page.val.ts?p="hero"' as SourcePath,
        {
          message: "Image metadata is missing",
          value: { path: "/public/val/hero.png" },
          fixes: ["image:add-metadata"],
        },
        {},
      ),
    ).rejects.toThrow("ENOENT");
  });
});
