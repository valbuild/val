import type { Page } from "@playwright/test";

/**
 * A camera-sized JPEG, made in the page so there is no fixture to keep.
 *
 * A gradient, so it compresses like a photo rather than like a flat colour,
 * with a red square in its top-left corner so a test can tell which way up the
 * result is.
 */
export async function makeJpeg(
  page: Page,
  { width, height }: { width: number; height: number },
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#3b2314");
      gradient.addColorStop(1, "#d9a25b");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, width / 8, width / 8);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      );
      if (!blob) throw new Error("no jpeg");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width, height },
  );
  return Buffer.from(base64, "base64");
}

/**
 * The same JPEG, saying in EXIF that it is to be shown turned.
 *
 * What a phone writes: the sensor's pixels as they came off it, plus an
 * Orientation tag. 6 is "turn a quarter clockwise to view", so a 3200x2000
 * file is a 2000x3200 photo, and its top-left corner ends up top-right.
 *
 * One APP1 segment straight after SOI, holding a big-endian TIFF header and an
 * IFD with the one tag.
 */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("not a JPEG");
  }
  const tiff = Buffer.concat([
    // "MM", 42, and the first IFD at offset 8
    Buffer.from("4d4d002a00000008", "hex"),
    // the IFD holds one entry
    Buffer.from("0001", "hex"),
    // Orientation (0x0112), a SHORT (3), one of them
    Buffer.from("0112000300000001", "hex"),
    // the value, padded to four bytes
    Buffer.from([0x00, orientation, 0x00, 0x00]),
    // no next IFD
    Buffer.from("00000000", "hex"),
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const length = exif.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]),
    exif,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}
