import sharp from "sharp";
import { sharpImageProcessor, type SharpLike } from "./index";

/**
 * The sharp adapter, against sharp.
 *
 * The assertion this suite exists for is the first line of `processor`: the
 * real library is assigned to {@link SharpLike}, so if the structural type ever
 * describes a sharp that does not exist, this file stops compiling. Everything
 * below is what that adapter promises the image tool — including the two
 * "declined" answers, which are outcomes rather than failures and are therefore
 * the easiest things to get wrong.
 */

// Typed on the way in, deliberately. This is the compile-time half of the test.
const sharpLike: SharpLike = sharp;
const processor = sharpImageProcessor(sharpLike);

function solid(
  width: number,
  height: number,
  format: "png" | "jpeg" | "webp",
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 90 },
    },
  })
    [format]()
    .toBuffer();
}

describe("read", () => {
  it.each([
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("reads a %s", async (format, mimeType) => {
    const bytes = await solid(30, 20, format);

    expect(await processor.read(new Uint8Array(bytes))).toEqual({
      width: 30,
      height: 20,
      mimeType,
    });
  });

  it("answers null for bytes that are not an image", async () => {
    // Not an error: it is the answer to "is this an image", and the tool turns
    // it into a message the caller can act on rather than an internal failure.
    expect(await processor.read(new TextEncoder().encode("not an image"))).toBe(
      null,
    );
  });
});

describe("encode", () => {
  it("converts to webp", async () => {
    const png = await solid(40, 40, "png");

    const encoded = await processor.encode(new Uint8Array(png), {
      mimeType: "image/webp",
      quality: 0.8,
      resizeTo: null,
    });

    expect(encoded?.mimeType).toBe("image/webp");
    expect(await processor.read(encoded!.bytes)).toEqual({
      width: 40,
      height: 40,
      mimeType: "image/webp",
    });
  });

  it("scales down to the box it is given", async () => {
    const png = await solid(100, 50, "png");

    const encoded = await processor.encode(new Uint8Array(png), {
      mimeType: "image/webp",
      quality: 0.8,
      resizeTo: { width: 20, height: 10 },
    });

    expect(await processor.read(encoded!.bytes)).toMatchObject({
      width: 20,
      height: 10,
    });
  });

  it("never enlarges, even when asked to", async () => {
    // `fitWithin` never asks for an upscale, so this is about the adapter not
    // being the thing that introduces one if a future caller does.
    const png = await solid(10, 10, "png");

    const encoded = await processor.encode(new Uint8Array(png), {
      mimeType: "image/webp",
      quality: 0.8,
      resizeTo: { width: 500, height: 500 },
    });

    expect(await processor.read(encoded!.bytes)).toMatchObject({
      width: 10,
      height: 10,
    });
  });

  it("declines a format it cannot produce", async () => {
    const png = await solid(10, 10, "png");

    expect(
      await processor.encode(new Uint8Array(png), {
        mimeType: "image/jxl",
        quality: 0.8,
        resizeTo: null,
      }),
    ).toBe(null);
  });

  it("declines rather than throwing on bytes it cannot decode", async () => {
    // A failed optimisation must never become a failed upload.
    expect(
      await processor.encode(new TextEncoder().encode("nonsense"), {
        mimeType: "image/webp",
        quality: 0.8,
        resizeTo: null,
      }),
    ).toBe(null);
  });
});
