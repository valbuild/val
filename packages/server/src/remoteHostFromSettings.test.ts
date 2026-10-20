import { initVal, Internal, ModuleFilePath } from "@valbuild/core";
import { checkRemoteRef } from "./checkRemoteRef";
import { createDefaultValFSHost, type FixHandlerContext } from "./fixHandlers";
import type { Service } from "./Service";
import { openRemoteUploadSession, uploadBytesToRemote } from "./remoteUpload";

const PLATFORM = "https://3f9a2c1.valstart.dev/_val";
const BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
  "base64",
);
const { s } = initVal();
const IMAGE = s.image().remote()["executeSerialize"]();
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const HERO = Internal.createValPathOfItem(PAGE, "hero")!;

/**
 * Where a ref's host comes from when tooling writes one: the project's
 * settings (a Hosted project's files are in R2 and served at its own
 * address), and, when an existing ref is re-derived, the ref itself.
 */
describe("the host a new or re-derived ref names", () => {
  test("an upload names the host the project's settings give", async () => {
    const uploads: string[] = [];
    const ctx: FixHandlerContext = {
      sourcePath: HERO,
      validationError: { message: "" },
      valModule: {
        path: Internal.parentOfSourcePath(HERO),
        source: { hero: null },
        schema: s
          .object({ hero: s.image().remote().nullable() })
          ["executeSerialize"](),
        errors: false,
      },
      projectRoot: "/project",
      fix: true,
      // The upload asks nothing of the service.
      service: {} as Service,
      valFiles: [],
      moduleFilePath: PAGE,
      file: PAGE.slice(1),
      // A `val login` token on disk, without a disk.
      fs: {
        ...createDefaultValFSHost(),
        fileExists: () => true,
        readFile: () => JSON.stringify({ pat: "token" }),
      },
      remoteFiles: {},
      remoteFilesCounter: 0,
      project: "org/site",
      remote: {
        remoteHost: "https://remote.val.build",
        getSettings: async () => ({
          success: true,
          data: {
            publicProjectId: "3f9a2c1",
            remoteFileBuckets: [{ bucket: "r2" }],
            remoteHost: PLATFORM,
          },
        }),
        uploadFile: async (_project, bucket) => {
          uploads.push(bucket);
          return { success: true };
        },
      },
    };
    const session = await openRemoteUploadSession(ctx);
    if (!session.success) throw new Error("no session");
    if (IMAGE.type !== "image") throw new Error("not an image schema");
    const res = await uploadBytesToRemote(
      ctx,
      session.session,
      "public/val/hero.png",
      BYTES,
      { width: 1, height: 1, mimeType: "image/png" },
      IMAGE,
    );
    expect(
      res.success && res.ref.startsWith(`${PLATFORM}/file/p/3f9a2c1/b/r2/`),
    ).toBe(true);
    expect(uploads).toEqual(["r2"]);
  });

  test("a stale ref is re-derived on the host it was already on", async () => {
    if (IMAGE.type !== "image") throw new Error("not an image schema");
    const fileHash = Internal.remote.getFileHash(BYTES);
    // Made for no metadata at all, so 1x1 PNG metadata makes it stale.
    const ref = Internal.remote.createRemoteRef(PLATFORM, {
      publicProjectId: "3f9a2c1",
      coreVersion: Internal.VERSION.core ?? "unknown",
      bucket: "r2",
      validationHash: "0000",
      fileHash,
      filePath: "public/val/hero.png",
    });
    const res = await checkRemoteRef(
      // What the CLI passes; the ref's own host has to win.
      "https://remote.val.build",
      ref,
      "/project",
      IMAGE,
      { width: 1, height: 1, mimeType: "image/png" },
      async () => ({ status: "success", fileBuffer: BYTES, fileHash }),
    );
    expect(res.status).toBe("fix-required");
    expect(res.status === "fix-required" && res.ref.startsWith(PLATFORM)).toBe(
      true,
    );
  });
});
