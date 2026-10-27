import {
  checkDemoUpload,
  dataUrlSize,
  DEMO_UPLOAD_LIMITS,
  DEMO_UPLOADS_OFF,
} from "./demoUploads";

function dataUrlOf(mimeType: string, bytes: number): string {
  return `data:${mimeType};base64,${Buffer.alloc(bytes).toString("base64")}`;
}

describe("dataUrlSize", () => {
  test.each([0, 1, 2, 3, 4, 1000, 1001, 1002])(
    "decodes the size of %i bytes without decoding them",
    (bytes) => {
      expect(dataUrlSize(dataUrlOf("image/webp", bytes))).toEqual({
        mimeType: "image/webp",
        bytes,
      });
    },
  );

  test("reads past parameters before ;base64", () => {
    expect(
      dataUrlSize(
        `data:application/vnd.apple.mpegurl;charset=utf-8;base64,${Buffer.from("abc").toString("base64")}`,
      ),
    ).toEqual({ mimeType: "application/vnd.apple.mpegurl", bytes: 3 });
  });

  test("is null for anything that is not a base64 data URL", () => {
    expect(dataUrlSize("data:text/plain,hello")).toBeNull();
    expect(dataUrlSize("/public/val/a.png")).toBeNull();
  });
});

describe("checkDemoUpload", () => {
  test("refuses every upload where the demo cannot take them", () => {
    expect(checkDemoUpload(false, { data: dataUrlOf("image/png", 1) })).toBe(
      DEMO_UPLOADS_OFF,
    );
  });

  test("takes an image at the cap and refuses one over it, by its uploaded size", () => {
    expect(
      checkDemoUpload(true, {
        data: dataUrlOf("image/webp", DEMO_UPLOAD_LIMITS.image),
      }),
    ).toBeNull();
    expect(
      checkDemoUpload(true, {
        data: dataUrlOf("image/webp", DEMO_UPLOAD_LIMITS.image + 1),
      }),
    ).toBe(
      "This image is 10 MB, and the demo takes images up to 10 MB. Try a smaller image.",
    );
  });

  test("gives a video, and a stream's files, the video cap", () => {
    const overImageCap = DEMO_UPLOAD_LIMITS.image * 2;
    expect(
      checkDemoUpload(true, { data: dataUrlOf("video/mp4", overImageCap) }),
    ).toBeNull();
    expect(
      checkDemoUpload(true, {
        data: dataUrlOf("video/mp4", DEMO_UPLOAD_LIMITS.video + 1),
      }),
    ).toMatch(/^This video is 100 MB, .* Try a shorter clip\.$/);
  });

  test("always lets a delete through: it is how a failed upload rolls back", () => {
    expect(checkDemoUpload(true, { data: null })).toBeNull();
    expect(checkDemoUpload(false, { data: null })).toBeNull();
  });
});
