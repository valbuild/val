import {
  chooseEncoded,
  ENCODE_DEFAULTS,
  fitWithin,
  isMimeTypeAccepted,
  isSkippedSource,
  resolveEncodeSettings,
} from "./encodeImage";

/**
 * The decisions, not the canvas.
 *
 * `packages/ui` runs jest in the node environment and has no canvas, so
 * `encodeImage` itself is exercised end to end by `e2e/media.spec.ts`. What is
 * worth pinning here is every branch that decides whether to convert at all -
 * each of which, got wrong, either corrupts content or silently does nothing.
 */

describe("resolveEncodeSettings", () => {
  it("is off when neither the field nor the gallery asks", () => {
    expect(resolveEncodeSettings(undefined, undefined)).toBeNull();
  });

  it("fills the defaults in when the schema only names a type", () => {
    expect(resolveEncodeSettings({ type: "webp" }, undefined)).toEqual({
      type: "webp",
      quality: ENCODE_DEFAULTS.quality,
      maxWidth: ENCODE_DEFAULTS.maxWidth,
      maxHeight: ENCODE_DEFAULTS.maxHeight,
    });
  });

  it("keeps what the schema did say and defaults the rest", () => {
    expect(
      resolveEncodeSettings({ type: "webp", quality: 0.5 }, undefined),
    ).toEqual({
      type: "webp",
      quality: 0.5,
      maxWidth: ENCODE_DEFAULTS.maxWidth,
      maxHeight: ENCODE_DEFAULTS.maxHeight,
    });
  });

  /**
   * `s.image(galleryVal)` serializes with EMPTY options, so this is the only
   * thing that lets a gallery-backed field honour its gallery.
   */
  it("inherits the gallery when the field says nothing", () => {
    expect(
      resolveEncodeSettings(undefined, { type: "webp", maxWidth: 800 }),
    ).toEqual({
      type: "webp",
      quality: ENCODE_DEFAULTS.quality,
      maxWidth: 800,
      maxHeight: ENCODE_DEFAULTS.maxHeight,
    });
  });

  it("lets the field override the gallery", () => {
    expect(
      resolveEncodeSettings({ type: "webp", quality: 0.9 }, { type: "webp" }),
    ).toEqual({
      type: "webp",
      quality: 0.9,
      maxWidth: ENCODE_DEFAULTS.maxWidth,
      maxHeight: ENCODE_DEFAULTS.maxHeight,
    });
  });

  /** `false` is a decision, not an absence - it has to beat the gallery. */
  it("lets the field turn off what the gallery turned on", () => {
    expect(resolveEncodeSettings(false, { type: "webp" })).toBeNull();
  });

  /*
   * Nonsense numbers fall back rather than through.
   *
   * `fitWithin` reads a bound of 0 as "everything already fits", so an unusable
   * `maxWidth` would otherwise silently disable the very downscale it asks for.
   */
  it.each([0, -100, NaN, Infinity])(
    "falls back to the default bound for maxWidth %p",
    (maxWidth) => {
      expect(
        resolveEncodeSettings({ type: "webp", maxWidth }, undefined)?.maxWidth,
      ).toBe(ENCODE_DEFAULTS.maxWidth);
    },
  );

  it.each([0, -100, NaN, Infinity])(
    "falls back to the default bound for maxHeight %p",
    (maxHeight) => {
      expect(
        resolveEncodeSettings({ type: "webp", maxHeight }, undefined)
          ?.maxHeight,
      ).toBe(ENCODE_DEFAULTS.maxHeight);
    },
  );

  /** `canvas.toBlob` ignores a quality outside 0-1 just as quietly. */
  it.each([0, -1, NaN, Infinity])(
    "falls back to the default quality for %p",
    (quality) => {
      expect(
        resolveEncodeSettings({ type: "webp", quality }, undefined)?.quality,
      ).toBe(ENCODE_DEFAULTS.quality);
    },
  );

  it("clamps a quality above 1 rather than dropping it", () => {
    expect(
      resolveEncodeSettings({ type: "webp", quality: 4 }, undefined)?.quality,
    ).toBe(1);
  });

  it("keeps a usable quality and bounds untouched", () => {
    expect(
      resolveEncodeSettings(
        { type: "webp", quality: 0.35, maxWidth: 1, maxHeight: 9999 },
        undefined,
      ),
    ).toEqual({ type: "webp", quality: 0.35, maxWidth: 1, maxHeight: 9999 });
  });
});

describe("fitWithin", () => {
  it("is null when the image already fits", () => {
    expect(fitWithin(800, 600, 2560, 2560)).toBeNull();
  });

  it("is null on the boundary", () => {
    expect(fitWithin(2560, 2560, 2560, 2560)).toBeNull();
  });

  it("scales a landscape image by its width", () => {
    expect(fitWithin(3000, 2000, 2560, 2560)).toEqual({
      width: 2560,
      height: 1707,
    });
  });

  it("scales a portrait image by its height", () => {
    expect(fitWithin(2000, 3000, 2560, 2560)).toEqual({
      width: 1707,
      height: 2560,
    });
  });

  it("uses whichever bound binds first, not simply the width", () => {
    // Width binds: 2000/4000 is the smaller ratio.
    expect(fitWithin(4000, 1000, 2000, 900)).toEqual({
      width: 2000,
      height: 500,
    });
    // Height binds: the image is already inside maxWidth.
    expect(fitWithin(4000, 1000, 5000, 500)).toEqual({
      width: 2000,
      height: 500,
    });
  });

  /** A zero-sized canvas cannot be encoded, so the short side never rounds away. */
  it("never rounds a dimension to zero", () => {
    expect(fitWithin(10000, 3, 100, 100)).toEqual({ width: 100, height: 1 });
  });

  it("is null for a degenerate image", () => {
    expect(fitWithin(0, 0, 2560, 2560)).toBeNull();
  });
});

describe("isMimeTypeAccepted", () => {
  it("accepts anything when the schema does not say", () => {
    expect(isMimeTypeAccepted("image/webp", undefined)).toBe(true);
  });

  it.each([
    ["image/*", true],
    ["*/*", true],
    ["image/webp", true],
    ["image/png,image/webp", true],
    ["image/png, image/webp", true],
    ["image/png", false],
    ["image/png,image/jpeg", false],
    ["video/*", false],
  ])("accept %p accepts webp: %p", (accept, expected) => {
    expect(isMimeTypeAccepted("image/webp", accept)).toBe(expected);
  });
});

describe("isSkippedSource", () => {
  it.each(["image/svg+xml", "image/gif", "image/avif"])(
    "never re-encodes %s, even to downscale it",
    (mimeType) => {
      expect(isSkippedSource(mimeType, "image/webp", true)).toBe(true);
      expect(isSkippedSource(mimeType, "image/webp", false)).toBe(true);
    },
  );

  it("leaves a webp that already fits alone", () => {
    expect(isSkippedSource("image/webp", "image/webp", false)).toBe(true);
  });

  it("re-encodes a webp that has to be downscaled", () => {
    expect(isSkippedSource("image/webp", "image/webp", true)).toBe(false);
  });

  it("re-encodes the ordinary formats", () => {
    expect(isSkippedSource("image/png", "image/webp", false)).toBe(false);
    expect(isSkippedSource("image/jpeg", "image/webp", false)).toBe(false);
  });
});

describe("chooseEncoded", () => {
  const base = {
    originalSize: 1000,
    targetMimeType: "image/webp",
    needsDownscale: false,
  };

  it("takes the encoded bytes when they are smaller", () => {
    expect(
      chooseEncoded({ ...base, encodedSize: 400, encodedType: "image/webp" }),
    ).toBe(true);
  });

  /**
   * Measured: the 74 byte 8x8 PNG in `e2e/fixtures` becomes a 548 byte webp.
   * Small, flat images lose, which is the whole reason for this comparison.
   */
  it("keeps the original when the encoded bytes are bigger", () => {
    expect(
      chooseEncoded({
        ...base,
        originalSize: 74,
        encodedSize: 548,
        encodedType: "image/webp",
      }),
    ).toBe(false);
  });

  it("keeps the original on a tie", () => {
    expect(
      chooseEncoded({ ...base, encodedSize: 1000, encodedType: "image/webp" }),
    ).toBe(false);
  });

  /** A downscaled original is the wrong SIZE, whatever it weighs. */
  it("takes a downscale even when it is bigger", () => {
    expect(
      chooseEncoded({
        ...base,
        encodedSize: 5000,
        encodedType: "image/webp",
        needsDownscale: true,
      }),
    ).toBe(true);
  });

  it("keeps the original when the canvas produced nothing", () => {
    expect(
      chooseEncoded({ ...base, encodedSize: null, encodedType: null }),
    ).toBe(false);
  });

  /**
   * `canvas.toBlob` answers a type it cannot encode with a PNG rather than with
   * null - measured in Chromium. So "not null" is not the same question as "is
   * the type we asked for", and a browser without webp support would otherwise
   * have us upload a PNG named `.webp`, which the server rejects at publish
   * time with "Mime type does not match image type".
   */
  it("keeps the original when toBlob silently fell back to png", () => {
    expect(
      chooseEncoded({ ...base, encodedSize: 10, encodedType: "image/png" }),
    ).toBe(false);
  });
});
