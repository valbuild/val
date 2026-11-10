import { runConvertSessionImage } from "./convertSessionImage";

const png = new File([new Uint8Array(2000)], "photo.png", {
  type: "image/png",
});
const webp = new File([new Uint8Array(500)], "photo.webp", {
  type: "image/webp",
});

describe("convert_session_image", () => {
  test("makes a new image in the chat, and names it", async () => {
    const encode = jest.fn(async () => webp);
    const upload = jest.fn(async () => ({ key: "k2" }));
    const res = await runConvertSessionImage(
      { image_key: "k1", max_width: 800.4 },
      { files: new Map([["k1", png]]), encode, upload },
    );
    expect(encode).toHaveBeenCalledWith(png, {
      type: "webp",
      quality: 0.8,
      maxWidth: 800,
      maxHeight: 2560,
    });
    expect(upload).toHaveBeenCalledWith(webp);
    expect(res).toEqual({
      isError: false,
      result: {
        image_key: "k2",
        from: "k1",
        mimeType: "image/webp",
        bytes: 500,
        originalBytes: 2000,
      },
    });
  });

  test("keeps the original when converting would not help", async () => {
    const upload = jest.fn();
    const res = await runConvertSessionImage(
      { image_key: "k1" },
      {
        files: new Map([["k1", png]]),
        encode: async (file) => file,
        upload,
      },
    );
    expect(upload).not.toHaveBeenCalled();
    expect(res.result).toMatchObject({ image_key: "k1", unchanged: true });
  });

  test("an image from another tab cannot be converted here, and says so", async () => {
    const res = await runConvertSessionImage(
      { image_key: "elsewhere" },
      {
        files: new Map([["k1", png]]),
        encode: async (file) => file,
        upload: async () => ({ key: "x" }),
      },
    );
    expect(res.isError).toBe(true);
    expect(res.result).toMatchObject({ convertible: ["k1"] });
  });
});
