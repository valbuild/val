import fs from "fs";
import os from "os";
import path from "path";
import {
  initVal,
  Internal,
  ModuleFilePath,
  SourcePath,
  ValModules,
} from "@valbuild/core";
import { ValOpsFS } from "./ValOpsFS";
import { checkModuleForStudio, fixForStudio } from "./studioValidation";
import { clearRemoteFileAnswers } from "./remoteFileCheck";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
  "base64",
);
const IMAGES = "/content/images.val.ts" as ModuleFilePath;
const REMOTE_IMAGES = "/content/remoteImages.val.ts" as ModuleFilePath;
const FILES = "/content/files.val.ts" as ModuleFilePath;
const VIDEOS = "/content/videos.val.ts" as ModuleFilePath;

/**
 * A hosted project's ops: http mode with no repository, so no PUBLISHED file
 * can be read (`ValOpsHttp.getBinaryFile` answers `null` without one). A
 * template's files are in the built site there, not the content service.
 */
class HostedOps extends ValOpsFS {
  override canReadPublishedFiles(): boolean {
    return false;
  }
  override async getBinaryFile(): Promise<null> {
    return null;
  }
}

const entryOf = (module: ModuleFilePath, key: string): SourcePath => {
  const path = Internal.createValPathOfItem(module, key);
  if (!path) {
    throw new Error(`no path for ${key}`);
  }
  return path;
};

/**
 * The media directory half of the Studio's full check: an `s.imagedir()`,
 * `s.filedir()` or `s.videodir()` checked by the entries it tracks, against a
 * real `ValOpsFS` and real files on disk.
 */
describe("the Studio's full check of a media directory", () => {
  const { s, c, config } = initVal();
  let root: string;

  const setup = (
    sources: {
      images?: Record<string, unknown>;
      remoteImages?: Record<string, unknown>;
      files?: Record<string, unknown>;
      videos?: Record<string, unknown>;
    },
    Ops: typeof ValOpsFS = ValOpsFS,
  ) => {
    const valModules: ValModules = {
      config,
      modules: [
        {
          def: () =>
            Promise.resolve({
              // Typed by the schema when written inline; built per test here.
              default: c.define(
                IMAGES,
                s.imagedir("/public/val/images"),
                (sources.images ?? {}) as never,
              ),
            }),
        },
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                REMOTE_IMAGES,
                s.imagedir("/public/val/remote").remote(),
                (sources.remoteImages ?? {}) as never,
              ),
            }),
        },
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                FILES,
                s.filedir("/public/val/files", {
                  accept: "application/pdf,text/plain",
                }),
                (sources.files ?? {}) as never,
              ),
            }),
        },
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                VIDEOS,
                s.videodir("/public/val/videos"),
                (sources.videos ?? {}) as never,
              ),
            }),
        },
      ],
    };
    return new Ops("http://localhost:4000", root, valModules, {
      config,
    });
  };

  const inputOf = async (ops: ValOpsFS, moduleFilePath: ModuleFilePath) => ({
    moduleFilePath,
    schemas: await ops.getSchemas(),
    sources: (await ops.getSources()).sources,
    fileLastUpdatedByPatchId: {},
  });

  beforeEach(() => {
    clearRemoteFileAnswers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-mediadir-"));
    for (const dir of ["images", "files", "videos"]) {
      fs.mkdirSync(path.join(root, "public/val", dir), { recursive: true });
    }
    fs.writeFileSync(path.join(root, "public/val/images/ok.png"), PNG);
    fs.writeFileSync(path.join(root, "public/val/images/wrong.png"), PNG);
    fs.writeFileSync(path.join(root, "public/val/files/doc.pdf"), "%PDF-1.4");
    for (const module of [IMAGES, REMOTE_IMAGES, FILES, VIDEOS]) {
      fs.mkdirSync(path.dirname(path.join(root, module)), { recursive: true });
      fs.writeFileSync(path.join(root, module), "");
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const OK = { width: 1, height: 1, mimeType: "image/png", alt: null };
  const imagesWithProblems = {
    "/public/val/images/ok.png": OK,
    "/public/val/images/wrong.png": { ...OK, width: 8 },
    "/public/val/images/gone.png": OK,
  };

  test("an entry whose file is gone, and one whose size is wrong, are reported at their keys", async () => {
    const ops = setup({ images: imagesWithProblems });
    const res = await checkModuleForStudio(ops, await inputOf(ops, IMAGES));
    expect(res).toEqual({
      status: "ok",
      errors: {
        [entryOf(IMAGES, "/public/val/images/gone.png")]: [
          expect.objectContaining({
            message: expect.stringContaining("The file is gone"),
            fixes: ["images:check-all-files"],
          }),
        ],
        [entryOf(IMAGES, "/public/val/images/wrong.png")]: [
          expect.objectContaining({
            message: "Does not match the file: width 8 → 1.",
            fixes: ["images:check-all-files"],
          }),
        ],
      },
      remoteHosts: [],
    });
  });

  test("Fix removes an entry whose file is gone, and touches no other", async () => {
    const ops = setup({ images: imagesWithProblems });
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops, IMAGES)),
        sourcePath: entryOf(IMAGES, "/public/val/images/gone.png"),
        fix: "images:check-all-files",
      }),
    ).toEqual({
      status: "ok",
      patch: [{ op: "remove", path: ["/public/val/images/gone.png"] }],
      remainingErrors: [],
    });
  });

  test("in a hosted project, an entry it cannot read is not called gone, and Fix removes nothing", async () => {
    // What a fresh hosted project looked like: every template image and video
    // read as "gone", with a Fix that removed it from the directory.
    const ops = setup(
      {
        images: imagesWithProblems,
        videos: {
          "/public/val/videos/dusk.mp4": {
            mimeType: "video/mp4",
            width: 1280,
            height: 640,
            duration: 8,
            alt: null,
          },
        },
      },
      HostedOps,
    );
    for (const module of [IMAGES, VIDEOS]) {
      expect(
        await checkModuleForStudio(ops, await inputOf(ops, module)),
      ).toEqual({ status: "ok", errors: {}, remoteHosts: [] });
    }
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops, IMAGES)),
        sourcePath: entryOf(IMAGES, "/public/val/images/gone.png"),
        fix: "images:check-all-files",
      }),
    ).toEqual({ status: "not-found" });
  });

  test("Fix rewrites a wrong entry from its bytes, keeping what was authored", async () => {
    const ops = setup({ images: imagesWithProblems });
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops, IMAGES)),
        sourcePath: entryOf(IMAGES, "/public/val/images/wrong.png"),
        fix: "images:check-all-files",
      }),
    ).toEqual({
      status: "ok",
      patch: [
        {
          op: "replace",
          path: ["/public/val/images/wrong.png"],
          value: OK,
        },
      ],
      remainingErrors: [],
    });
  });

  test("an entry that is fine is not fixed", async () => {
    const ops = setup({ images: imagesWithProblems });
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops, IMAGES)),
        sourcePath: entryOf(IMAGES, "/public/val/images/ok.png"),
        fix: "images:check-all-files",
      }),
    ).toEqual({ status: "not-found" });
  });

  test("a file entry is checked by its type", async () => {
    const ops = setup({
      files: { "/public/val/files/doc.pdf": { mimeType: "text/plain" } },
    });
    const res = await checkModuleForStudio(ops, await inputOf(ops, FILES));
    expect(
      res.status === "ok" &&
        res.errors[entryOf(FILES, "/public/val/files/doc.pdf")],
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("mimeType text/plain"),
        fixes: ["files:check-all-files"],
      }),
    ]);
  });

  test("a video entry whose file is gone is reported, with no fix", async () => {
    const ops = setup({
      videos: {
        "/public/val/videos/gone.mp4": {
          mimeType: "video/mp4",
          width: 640,
          height: 360,
          duration: 1,
        },
      },
    });
    const res = await checkModuleForStudio(ops, await inputOf(ops, VIDEOS));
    expect(
      res.status === "ok" &&
        res.errors[entryOf(VIDEOS, "/public/val/videos/gone.mp4")],
    ).toEqual([expect.not.objectContaining({ fixes: expect.anything() })]);
  });

  test("a remote entry is asked of its host, and only whether it is there", async () => {
    const ref =
      "http://127.0.0.1:9/file/p/proj/b/01/v/1.0.0/h/abcd/f/0123456789ab/p/public/val/remote/remote.png";
    const ops = setup({ remoteImages: { [ref]: OK } });
    const res = await checkModuleForStudio(
      ops,
      await inputOf(ops, REMOTE_IMAGES),
    );
    expect(res).toEqual({
      status: "ok",
      errors: {},
      remoteHosts: [
        expect.objectContaining({
          host: "http://127.0.0.1:9",
          status: "unreachable",
          sourcePaths: [entryOf(REMOTE_IMAGES, ref)],
        }),
      ],
    });
  });
});
