import { Internal, type SerializedImageSchema } from "@valbuild/core";
import sharp from "sharp";
import {
  MEDIA_PATH,
  REMOTE_GALLERY_PATH,
  GALLERY_PATH,
  callErr,
  callOk,
  setup,
} from "../tools/toolsFixture";
import { createValImageTools } from "./imageTools";
import { sharpImageProcessor } from "../sharp";
import {
  resetBucketRotation,
  type RemoteSettingsLoader,
} from "./remoteUploadTarget";

/**
 * Images that live on Val's content host.
 *
 * The bytes do not go there when the image is added — they go into the patch
 * store like any other pending file, and publish pushes them. So what is
 * testable here is everything that decides WHERE they will go and what the
 * content points at meanwhile: the ref, and the validation hash baked into it.
 *
 * The one thing faked is the project's settings, which is a call to the content
 * host asking which project and which buckets. A suite that made that call
 * would be testing the network.
 */

const processor = sharpImageProcessor(sharp);

const PUBLIC_PROJECT_ID = "proj-abc123";
const BUCKETS = ["01", "02"];

const settings: RemoteSettingsLoader = async () => ({
  status: "success",
  publicProjectId: PUBLIC_PROJECT_ID,
  buckets: BUCKETS,
});

function toolsWith(loadRemoteSettings: RemoteSettingsLoader = settings) {
  return setup({
    extraTools: createValImageTools(processor, { loadRemoteSettings }),
  });
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 30, b: 170 },
    },
  })
    .png()
    .toBuffer();
}

async function pngBase64(width: number, height: number): Promise<string> {
  return `data:image/png;base64,${(await png(width, height)).toString("base64")}`;
}

async function sourceOf(
  tools: Awaited<ReturnType<typeof toolsWith>>["tools"],
  moduleFilePath: string,
): Promise<Record<string, unknown>> {
  return (await callOk(tools, "get_source", { moduleFilePath })) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  // The rotation is process-global, so without this the bucket a test gets
  // depends on how many tests ran before it.
  resetBucketRotation();
});

describe("a remote gallery", () => {
  test("writes a remote ref that splits back into its parts", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: REMOTE_GALLERY_PATH,
      imageBase64: await pngBase64(16, 12),
      filename: "banner.png",
      alt: "a banner",
    })) as Record<string, unknown>;

    expect(result.remote).toBe(true);
    const ref = result.filePath as string;

    // Round-tripped rather than matched against a regex: `splitRemoteRef` is
    // what publish uses to find these bytes again, so it agreeing is the
    // property that matters.
    const split = Internal.remote.splitRemoteRef(ref);
    expect(split).toMatchObject({
      status: "success",
      // `projectId` on the way back out, `publicProjectId` on the way in — the
      // ref carries the public one under a shorter name.
      projectId: PUBLIC_PROJECT_ID,
      bucket: expect.stringMatching(/^0[12]$/),
      // `public/...`, no leading slash — the shape the ref encodes.
      filePath: expect.stringMatching(
        /^public\/val\/remote\/banner_[0-9a-f]{5}\.png$/,
      ),
    });
    if (split.status !== "success") return;
    expect(split.fileHash).toBe(Internal.remote.getFileHash(await png(16, 12)));
  });

  test("keys the gallery entry by the ref, not the path", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: REMOTE_GALLERY_PATH,
      imageBase64: await pngBase64(16, 12),
      filename: "banner.png",
    })) as Record<string, unknown>;

    const gallery = await sourceOf(tools, REMOTE_GALLERY_PATH);
    expect(Object.keys(gallery)).toEqual([result.filePath]);
    expect(gallery[result.filePath as string]).toMatchObject({
      width: 16,
      height: 12,
      mimeType: "image/png",
    });
  });

  test("bakes a validation hash the validator will agree with", async () => {
    // The failure this guards against is silent and permanent: the hash is
    // computed here from a SYNTHESIZED image schema and recomputed later from
    // whatever the validator resolves, and a mismatch means a file that
    // uploads fine and never validates. Computed both ways and compared.
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: REMOTE_GALLERY_PATH,
      imageBase64: await pngBase64(16, 12),
      filename: "banner.png",
    })) as Record<string, unknown>;
    const split = Internal.remote.splitRemoteRef(result.filePath as string);
    if (split.status !== "success") throw new Error("expected a remote ref");

    // What `handleRemoteGalleryFileUpload` synthesizes for a gallery entry: an
    // image schema carrying the RECORD's accept and directory. `s.images()`
    // defaults accept to "image/*".
    const expected: SerializedImageSchema = {
      type: "image",
      opt: false,
      options: { accept: "image/*", directory: "/public/val/remote" },
    };
    expect(split.validationHash).toBe(
      Internal.remote.getValidationHash(
        Internal.VERSION.core || "unknown",
        expected,
        "png",
        {
          width: 16,
          height: 12,
          mimeType: "image/png",
        },
        split.fileHash,
        new TextEncoder(),
      ),
    );
  });

  test("spreads files across the buckets it was given", async () => {
    const { tools } = toolsWith();
    const buckets: string[] = [];

    for (const name of ["one.png", "two.png", "three.png"]) {
      const result = (await callOk(tools, "upload_image", {
        moduleFilePath: REMOTE_GALLERY_PATH,
        // Different sizes so the content hash differs and each is a new entry.
        imageBase64: await pngBase64(8 + buckets.length, 8),
        filename: name,
      })) as Record<string, unknown>;
      const split = Internal.remote.splitRemoteRef(result.filePath as string);
      if (split.status !== "success") throw new Error("expected a remote ref");
      buckets.push(split.bucket);
    }

    expect(new Set(buckets).size).toBe(BUCKETS.length);
  });
});

describe("a remote single field", () => {
  test("points the field at the ref, with its dimensions beside it", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: MEDIA_PATH,
      path: ["remoteHero"],
      imageBase64: await pngBase64(10, 20),
      filename: "hero.png",
      alt: "the hero",
    })) as Record<string, unknown>;

    const media = await sourceOf(tools, MEDIA_PATH);
    expect(media.remoteHero).toMatchObject({
      path: result.filePath,
      width: 10,
      height: 20,
      mimeType: "image/png",
      alt: "the hero",
    });
  });

  test("hashes against the field's own schema, not a gallery's", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: MEDIA_PATH,
      path: ["remoteHero"],
      imageBase64: await pngBase64(10, 20),
      filename: "hero.png",
    })) as Record<string, unknown>;
    const split = Internal.remote.splitRemoteRef(result.filePath as string);
    if (split.status !== "success") throw new Error("expected a remote ref");

    const schemas = (await callOk(tools, "get_all_schema", {})) as Record<
      string,
      { items: Record<string, SerializedImageSchema> }
    >;
    expect(split.validationHash).toBe(
      Internal.remote.getValidationHash(
        Internal.VERSION.core || "unknown",
        // The real serialized schema, straight out of the registry — a copy
        // written here by hand would agree with itself and prove nothing.
        schemas[MEDIA_PATH].items.remoteHero,
        "png",
        { width: 10, height: 20, mimeType: "image/png" },
        split.fileHash,
        new TextEncoder(),
      ),
    );
  });
});

describe("local images are untouched by any of this", () => {
  test("a local gallery still gets a plain path and no settings call", async () => {
    // The loader throws, so reaching it at all fails the test: a local upload
    // must not ask the content host anything.
    const { tools } = toolsWith(async () => {
      throw new Error("a local upload must not resolve remote settings");
    });

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageBase64: await pngBase64(6, 6),
      filename: "local.png",
    })) as Record<string, unknown>;

    expect(result.remote).toBe(false);
    expect(result.filePath).toMatch(
      /^\/public\/val\/test\/local_[0-9a-f]{5}\.png$/,
    );
  });
});

describe("when the project cannot say where to put it", () => {
  test("reports the loader's refusal rather than writing anything", async () => {
    const { tools } = toolsWith(async () => ({
      status: "error",
      code: "forbidden",
      message:
        "This project stores its images remotely, and uploading one needs you to be logged in. Run `npx val login` in the project directory, then try again.",
    }));

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: REMOTE_GALLERY_PATH,
      imageBase64: await pngBase64(6, 6),
      filename: "nope.png",
    });

    expect(err.code).toBe("forbidden");
    expect(err.message).toMatch(/val login/);
    expect(await sourceOf(tools, REMOTE_GALLERY_PATH)).toEqual({});
  });
});
