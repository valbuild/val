import { fileMatchesAccept, inputAccept, isFontAccept } from "./fileAccept";
import { withFontMimeType } from "./readFile";

const FONTS = "font/woff2,font/woff,font/ttf,font/otf";

describe("inputAccept", () => {
  test("a font type also names its extension, for pickers that do not know the type", () => {
    expect(inputAccept(FONTS)).toBe(`${FONTS},.woff2,.woff,.ttf,.otf`);
    expect(inputAccept("font/*")).toBe("font/*,.woff2,.woff,.ttf,.otf,.ttc");
  });

  test("anything else is left as it was", () => {
    expect(inputAccept("application/pdf")).toBe("application/pdf");
    expect(inputAccept(undefined)).toBeUndefined();
  });
});

describe("fileMatchesAccept", () => {
  test("by the browser's type", () => {
    expect(
      fileMatchesAccept({ type: "font/woff2", name: "a.bin" }, FONTS),
    ).toBe(true);
    expect(
      fileMatchesAccept({ type: "image/png", name: "a.png" }, "image/*"),
    ).toBe(true);
  });

  test("by the extension when the browser gives no type, or a generic one", () => {
    expect(fileMatchesAccept({ type: "", name: "Inter.WOFF2" }, FONTS)).toBe(
      true,
    );
    expect(
      fileMatchesAccept(
        { type: "application/octet-stream", name: "inter.ttf" },
        FONTS,
      ),
    ).toBe(true);
    expect(fileMatchesAccept({ type: "", name: "report.pdf" }, FONTS)).toBe(
      false,
    );
  });

  test("*/* takes everything", () => {
    // The hand-written matcher this replaced compared against "*/" and so
    // dropped every file on a */* gallery.
    expect(
      fileMatchesAccept({ type: "application/pdf", name: "a.pdf" }, "*/*"),
    ).toBe(true);
  });
});

describe("isFontAccept", () => {
  test("only when every accepted type is a font", () => {
    expect(isFontAccept(FONTS)).toBe(true);
    expect(isFontAccept("font/*")).toBe(true);
    expect(isFontAccept("font/woff2, application/pdf")).toBe(false);
    expect(isFontAccept("*/*")).toBe(false);
    expect(isFontAccept(undefined)).toBe(false);
  });
});

describe("withFontMimeType", () => {
  const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]); // wOF2
  const base64 = Buffer.from(woff2).toString("base64");

  test("a font the picker could not type is typed by its bytes", () => {
    expect(
      withFontMimeType(`data:application/octet-stream;base64,${base64}`, woff2),
    ).toBe(`data:font/woff2;base64,${base64}`);
    expect(
      withFontMimeType(`data:application/x-font-ttf;base64,${base64}`, woff2),
    ).toBe(`data:font/woff2;base64,${base64}`);
  });

  test("anything that is not a font is left alone", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const url = `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`;
    expect(withFontMimeType(url, pdf)).toBe(url);
  });
});
