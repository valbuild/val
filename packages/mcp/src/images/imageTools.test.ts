import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  ALT_GALLERY_PATH,
  CONVERTING_GALLERY_PATH,
  ENCODED_GALLERY_PATH,
  GALLERY_PATH,
  ITEMS_PATH,
  MEDIA_PATH,
  PAGES_PATH,
  STRICT_GALLERY_PATH,
  callErr,
  callOk,
  setup,
} from "../tools/toolsFixture";
import { createValImageTools } from "./imageTools";
import { sharpImageProcessor } from "../sharp";
import type { ValImageProcessor } from "./types";

/**
 * Uploading an image, seen through the registry's `call`.
 *
 * Driven with the real `sharp` adapter rather than a stub, because almost
 * everything that can go wrong here is about the bytes agreeing with what is
 * written down about them — the stored width, the mime type, the extension the
 * filename gets, the content hash in it. A stub that returned plausible numbers
 * would pass while none of that lined up.
 *
 * The one stub is {@link declining}, for the branch where an encoder gives up:
 * making the real one fail needs bytes it cannot read, and those never reach
 * the encoder because `read` rejects them first.
 */

const processor = sharpImageProcessor(sharp);

function toolsWith(imageProcessor: ValImageProcessor = processor) {
  return setup({ extraTools: createValImageTools(imageProcessor) });
}

/** A solid rectangle, big enough to be worth downscaling. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

async function pngBase64(width: number, height: number): Promise<string> {
  return `data:image/png;base64,${(await png(width, height)).toString("base64")}`;
}

async function webpBase64(width: number, height: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 90 },
    },
  })
    .webp()
    .toBuffer();
  return `data:image/webp;base64,${bytes.toString("base64")}`;
}

/** What a source or gallery entry looks like once read back. */
async function sourceOf(
  tools: Awaited<ReturnType<typeof toolsWith>>["tools"],
  moduleFilePath: string,
): Promise<Record<string, unknown>> {
  const data = await callOk(tools, "get_source", { moduleFilePath });
  return data as Record<string, unknown>;
}

describe("upload_image", () => {
  test("is not registered unless the host adds it", async () => {
    const { tools } = setup();

    expect(tools.list().map((tool) => tool.name)).not.toContain("upload_image");

    const res = await tools.call(
      "upload_image",
      { moduleFilePath: GALLERY_PATH },
      { auth: null, sessionId: null },
    );
    expect(res).toMatchObject({ status: "error", code: "unknown-tool" });
  });

  test("is registered once it is", async () => {
    const { tools } = toolsWith();

    expect(tools.list().map((tool) => tool.name)).toContain("upload_image");
  });

  test("adds an image to a gallery, keyed by the file it wrote", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageBase64: await pngBase64(24, 16),
      filename: "Photo Of A Thing.png",
      alt: "a thing",
    })) as Record<string, unknown>;

    // The extension comes from the bytes and the suffix from their hash, so a
    // caller cannot make two different images share a name — and the directory
    // is the gallery's, not the default.
    expect(result.filePath).toMatch(
      /^\/public\/val\/test\/photoofathing_[0-9a-f]{5}\.png$/,
    );
    expect(result).toMatchObject({
      width: 24,
      height: 16,
      mimeType: "image/png",
      reEncoded: false,
    });

    const gallery = await sourceOf(tools, GALLERY_PATH);
    expect(gallery[result.filePath as string]).toEqual({
      width: 24,
      height: 16,
      mimeType: "image/png",
      alt: "a thing",
      // Stamped by the server on a file that is still a draft, so the Studio
      // and the file endpoint serve it out of the patch store rather than
      // looking for it in a working tree it is not in yet.
      patch_id: result.patchId,
    });
  });

  test("puts an image in a field, with its dimensions beside it", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: MEDIA_PATH,
      path: ["hero"],
      imageBase64: await pngBase64(12, 9),
      filename: "hero.png",
      alt: "the hero",
    })) as Record<string, unknown>;

    const media = await sourceOf(tools, MEDIA_PATH);
    expect(media.hero).toEqual({
      path: result.filePath,
      width: 12,
      height: 9,
      mimeType: "image/png",
      alt: "the hero",
      // Stamped by the server on a file that is still a draft, so that the
      // Studio and the file endpoint know to serve it out of the patch store
      // rather than looking for it in the working tree.
      patch_id: result.patchId,
    });
  });

  test("a gallery-backed field gets the path, the gallery gets the rest", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: MEDIA_PATH,
      path: ["thumbnail"],
      imageBase64: await pngBase64(8, 8),
      filename: "thumb.png",
    })) as Record<string, unknown>;

    // Two modules written, and the split between them is the point: a second
    // copy of the dimensions on the field is how two copies of one fact get to
    // disagree.
    const media = await sourceOf(tools, MEDIA_PATH);
    // The path and nothing else — not even the `patch_id` the other cases get,
    // because the field's patch carries no bytes: the gallery's does.
    expect(media.thumbnail).toEqual({ path: result.filePath });

    const gallery = await sourceOf(tools, GALLERY_PATH);
    expect(gallery[result.filePath as string]).toEqual({
      width: 8,
      height: 8,
      mimeType: "image/png",
      alt: null,
      patch_id: expect.any(String),
    });

    // Reported rather than hidden: the field's own check reads the PUBLISHED
    // gallery, so until both changes are published it cannot see the entry
    // that was written a moment ago. Saying so is the honest answer — and the
    // alternative, refusing, would make a gallery-backed field unfillable.
    expect(result.unresolvedValidationErrors).toMatch(
      /gallery does not have an image/,
    );
  });

  test("reads the image off disk when given a path", async () => {
    const { tools, rootDir } = toolsWith();
    const onDisk = path.join(rootDir, "source-image.png");
    fs.writeFileSync(onDisk, await png(20, 20));

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageFilePath: onDisk,
    })) as Record<string, unknown>;

    // The filename defaults to the one on disk, so the stored file is
    // recognisable rather than a bare hash.
    expect(result.filePath).toMatch(
      /^\/public\/val\/test\/source-image_[0-9a-f]{5}\.png$/,
    );
    expect(result).toMatchObject({ width: 20, height: 20 });
  });

  test("the uploaded bytes are what the metadata describes", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageBase64: await pngBase64(33, 11),
    })) as Record<string, unknown>;

    // Read back through the tools rather than off disk: an uploaded file is not
    // in the working tree until the patch is published, it is in the patch
    // store — and `validate_content` is what resolves it. If the bytes were
    // never stored, or stored under another id, this is where it shows.
    expect(
      await callOk(tools, "validate_content", {
        moduleFilePath: GALLERY_PATH,
      }),
    ).toMatchObject({ valid: true });
    expect(result).toMatchObject({ width: 33, height: 11 });
  });

  test("converts and downscales when the gallery asks for it", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: ENCODED_GALLERY_PATH,
      imageBase64: await pngBase64(64, 32),
      filename: "big.png",
    })) as Record<string, unknown>;

    // The fixture gallery asks for webp inside 8x8. Everything downstream of
    // the conversion has to follow it: the stored dimensions, the mime type and
    // the extension all describe the converted file rather than the original.
    expect(result).toMatchObject({
      width: 8,
      height: 4,
      mimeType: "image/webp",
      reEncoded: true,
    });
    expect(result.filePath).toMatch(
      /^\/public\/val\/encoded\/big_[0-9a-f]{5}\.webp$/,
    );
    expect(
      await callOk(tools, "validate_content", {
        moduleFilePath: ENCODED_GALLERY_PATH,
      }),
    ).toMatchObject({ valid: true });
  });

  test("does not convert anything unless the schema asked", async () => {
    // `encode` is off by default, and the plain gallery does not ask. The bytes
    // that were handed over are the bytes that get stored — same as the Studio,
    // where an upload is only ever converted by a schema that says so.
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageBase64: await pngBase64(4000, 4000),
      filename: "huge.png",
    })) as Record<string, unknown>;

    // Well past the 2560 default bound, and still untouched: the default is
    // off, not "downscale anything large".
    expect(result).toMatchObject({
      width: 4000,
      height: 4000,
      mimeType: "image/png",
      reEncoded: false,
    });
    expect(result.filePath).toMatch(/\.png$/);
  });

  test("converts a source `accept` would refuse, when the schema offers to", async () => {
    // The combination `accept` and `encode` exist to serve together: this
    // gallery stores only webp AND says it will convert. A PNG is therefore an
    // upload, not a refusal — checking the source against `accept` would
    // refuse the very image the conversion was there to handle.
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: CONVERTING_GALLERY_PATH,
      imageBase64: await pngBase64(20, 10),
      filename: "shot.png",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      mimeType: "image/webp",
      reEncoded: true,
    });
    expect(result.filePath).toMatch(
      /^\/public\/val\/converting\/shot_[0-9a-f]{5}\.webp$/,
    );
    expect(
      await callOk(tools, "validate_content", {
        moduleFilePath: CONVERTING_GALLERY_PATH,
      }),
    ).toMatchObject({ valid: true });
  });

  test("refuses a source `accept` would refuse when nothing converts it", async () => {
    // Same `accept`, no `encode`. Refused on what WOULD BE STORED, and refused
    // here rather than by validation: `ImageSchema` reports a mime-type
    // mismatch as server-repairable, so nothing downstream would stop it.
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: STRICT_GALLERY_PATH,
      imageBase64: await webpBase64(20, 10),
      filename: "shot.webp",
    });

    expect(err.code).toBe("validation-failed");
    expect(err.message).toMatch(/only accepts image\/png/);
    expect(err.message).toMatch(/encode/);
    expect(await sourceOf(tools, STRICT_GALLERY_PATH)).toEqual({});
  });

  test("asks for alt text when the gallery requires it", async () => {
    // Found against the example app, whose gallery declares
    // `alt: s.string().minLength(4)`. Without this the upload got as far as
    // saving and came back with a validation error about a `null` the caller
    // never chose — true, and no help at all in working out what to do.
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: ALT_GALLERY_PATH,
      imageBase64: await pngBase64(6, 6),
      filename: "described.png",
    });

    expect(err.code).toBe("invalid-args");
    expect(err.message).toMatch(/requires alt text/);
    expect(await sourceOf(tools, ALT_GALLERY_PATH)).toEqual({});
  });

  test("takes the image once the alt text is there", async () => {
    const { tools } = toolsWith();

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: ALT_GALLERY_PATH,
      imageBase64: await pngBase64(6, 6),
      filename: "described.png",
      alt: "a small blue square",
    })) as Record<string, unknown>;

    const gallery = await sourceOf(tools, ALT_GALLERY_PATH);
    expect(gallery[result.filePath as string]).toMatchObject({
      alt: "a small blue square",
    });
    expect(
      await callOk(tools, "validate_content", {
        moduleFilePath: ALT_GALLERY_PATH,
      }),
    ).toMatchObject({ valid: true });
  });

  test("does not ask for alt text when the gallery does not", async () => {
    // The default alt schema is a nullable string, so `null` is a real answer
    // and an upload without alt is not a mistake.
    const { tools } = toolsWith();

    await callOk(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageBase64: await pngBase64(6, 6),
      filename: "undescribed.png",
    });

    expect(
      await callOk(tools, "validate_content", { moduleFilePath: GALLERY_PATH }),
    ).toMatchObject({ valid: true });
  });

  test("uploads the original when the encoder declines", async () => {
    // A failed optimisation must never become a failed upload.
    const declining: ValImageProcessor = {
      read: (bytes) => processor.read(bytes),
      encode: async () => null,
    };
    const { tools } = toolsWith(declining);

    const result = (await callOk(tools, "upload_image", {
      moduleFilePath: ENCODED_GALLERY_PATH,
      imageBase64: await pngBase64(64, 32),
      filename: "big.png",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      width: 64,
      height: 32,
      mimeType: "image/png",
      reEncoded: false,
    });
  });

  test("refuses bytes that are not an image", async () => {
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageBase64: Buffer.from("this is not a png").toString("base64"),
    });

    expect(err.code).toBe("invalid-args");
    expect(err.message).toMatch(/not an image/);
    // Nothing was added, which is the half that matters.
    expect(await sourceOf(tools, GALLERY_PATH)).toEqual({});
  });

  test.each([
    ["neither", {}],
    ["both", { imageBase64: "AAAA", imageFilePath: "/tmp/nope.png" }],
  ])("refuses %s source given", async (_name, args) => {
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      ...args,
    });

    expect(err.code).toBe("invalid-args");
    expect(err.message).toMatch(/imageFilePath|imageBase64/);
  });

  test("says so when the file is not there", async () => {
    const { tools, rootDir } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      imageFilePath: path.join(rootDir, "no-such-file.png"),
    });

    expect(err.code).toBe("not-found");
  });

  test("refuses a module that is not a gallery", async () => {
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: PAGES_PATH,
      imageBase64: await pngBase64(4, 4),
    });

    expect(err.code).toBe("invalid-args");
    expect(err.message).toMatch(/not an image gallery/);
  });

  test("refuses a path that is not an image field", async () => {
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: ITEMS_PATH,
      path: ["0", "label"],
      imageBase64: await pngBase64(4, 4),
    });

    expect(err.code).toBe("invalid-args");
    expect(err.message).toMatch(/not an image/);
  });

  test("points at the gallery when asked to write inside one", async () => {
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: GALLERY_PATH,
      path: ["/public/val/test/anything.png"],
      imageBase64: await pngBase64(4, 4),
    });

    expect(err.code).toBe("invalid-args");
    expect(err.message).toMatch(/empty path/);
  });

  test("refuses a module that does not exist", async () => {
    const { tools } = toolsWith();

    const err = await callErr(tools, "upload_image", {
      moduleFilePath: "/test/nope.val.ts",
      imageBase64: await pngBase64(4, 4),
    });

    expect(err.code).toBe("not-found");
  });
});
