import { isFontMimeType, sniffFontMimeType } from "./font";
import { filenameToMimeType, mimeTypeToFileExt } from "./convertMimeType";

function bytes(...values: (number | string)[]): Uint8Array {
  return new Uint8Array(
    values.flatMap((v) =>
      typeof v === "number" ? [v] : Array.from(v, (ch) => ch.charCodeAt(0)),
    ),
  );
}

describe("sniffFontMimeType", () => {
  test("reads each format's signature", () => {
    expect(sniffFontMimeType(bytes("wOF2", 0, 1))).toBe("font/woff2");
    expect(sniffFontMimeType(bytes("wOFF", 0, 1))).toBe("font/woff");
    expect(sniffFontMimeType(bytes("OTTO", 0, 1))).toBe("font/otf");
    expect(sniffFontMimeType(bytes(0, 1, 0, 0, 0, 12))).toBe("font/ttf");
    expect(sniffFontMimeType(bytes("true", 0, 12))).toBe("font/ttf");
    expect(sniffFontMimeType(bytes("ttcf", 0, 1))).toBe("font/collection");
  });

  test("anything else is not a font", () => {
    expect(sniffFontMimeType(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffFontMimeType(bytes(0x89, "PNG"))).toBeNull();
    expect(sniffFontMimeType(bytes("wOF"))).toBeNull();
  });
});

describe("isFontMimeType", () => {
  test("the font/ types and the legacy names", () => {
    expect(isFontMimeType("font/woff2")).toBe(true);
    expect(isFontMimeType("font/*")).toBe(true);
    expect(isFontMimeType("application/x-font-ttf")).toBe(true);
    expect(isFontMimeType("application/font-woff")).toBe(true);
    expect(isFontMimeType("application/pdf")).toBe(false);
    expect(isFontMimeType(undefined)).toBe(false);
  });
});

describe("font extensions", () => {
  test("map to the IANA types and back", () => {
    for (const [ext, mimeType] of [
      ["woff2", "font/woff2"],
      ["woff", "font/woff"],
      ["ttf", "font/ttf"],
      ["otf", "font/otf"],
      ["ttc", "font/collection"],
    ]) {
      expect(filenameToMimeType(`inter.${ext}`)).toBe(mimeType);
      expect(mimeTypeToFileExt(mimeType)).toBe(ext);
    }
  });
});
