import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes,
} from "./bytes";

/**
 * `bytes.ts` replaced `Buffer` in the request handlers, so Node's answers are
 * the specification: every case here is checked against `Buffer` itself.
 */

function randomBytes(seed: number, length: number): Uint8Array {
  // Deterministic, so a failure reproduces.
  let state = seed;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = state >> 16;
  }
  return bytes;
}

const LENGTHS = [0, 1, 2, 3, 4, 5, 6, 7, 31, 32, 33, 255, 1000, 4097];

describe("bytesToBase64", () => {
  test.each(LENGTHS)("matches Buffer for %i bytes", (length) => {
    const bytes = randomBytes(length + 1, length);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("base64ToBytes", () => {
  const decodesLikeBuffer = (input: string) => {
    expect(Array.from(base64ToBytes(input))).toEqual(
      Array.from(Buffer.from(input, "base64")),
    );
  };

  test.each(LENGTHS)("round-trips %i bytes", (length) => {
    const bytes = randomBytes(length + 7, length);
    const encoded = Buffer.from(bytes).toString("base64");
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
  });

  test.each(LENGTHS)("decodes like Buffer without padding (%i)", (length) => {
    decodesLikeBuffer(
      Buffer.from(randomBytes(length + 3, length))
        .toString("base64")
        .replace(/=+$/, ""),
    );
  });

  test.each(LENGTHS)("decodes the URL-safe alphabet like Buffer (%i)", (l) => {
    decodesLikeBuffer(Buffer.from(randomBytes(l + 5, l)).toString("base64url"));
  });

  test("skips whitespace and other characters like Buffer", () => {
    const encoded = Buffer.from(randomBytes(9, 300)).toString("base64");
    decodesLikeBuffer(encoded.replace(/(.{76})/g, "$1\n"));
    decodesLikeBuffer(encoded.replace(/(.{4})/g, "$1 \t\r\n"));
    decodesLikeBuffer(`  ${encoded}  `);
    decodesLikeBuffer(encoded.replace(/(.{7})/g, "$1*.!"));
  });

  test.each([
    "",
    "=",
    "QQ",
    "QQ=",
    "QQ==",
    "QUI",
    "QUJD",
    "QUJDR",
    "QUJDRA",
    "QQ==QUJD",
    "QU=JD",
    "Q",
    "@@@@",
    "QUJDéRA==",
  ])("decodes %p like Buffer", (input) => {
    decodesLikeBuffer(input);
  });

  test("decodes a large file like Buffer", () => {
    // A video upload is many megabytes of base64 in one string.
    const bytes = randomBytes(11, 3 * 1024 * 1024 + 1);
    const encoded = Buffer.from(bytes).toString("base64");
    expect(Buffer.from(base64ToBytes(encoded)).equals(Buffer.from(bytes))).toBe(
      true,
    );
  });
});

describe("utf8", () => {
  test.each([
    "",
    "plain ascii",
    "Blåbærsyltetøy",
    "emoji 🎉 and CJK 漢字",
    "﻿starts with a byte order mark",
    "lone surrogate \ud800 here",
  ])("matches Buffer for %p", (text) => {
    expect(Array.from(utf8ToBytes(text))).toEqual(
      Array.from(Buffer.from(text, "utf8")),
    );
    const bytes = Buffer.from(text, "utf8");
    expect(bytesToUtf8(bytes)).toBe(bytes.toString("utf8"));
  });

  test("decodes invalid sequences like Buffer", () => {
    const bytes = new Uint8Array([0x61, 0xff, 0xc3, 0x62, 0xe2, 0x82]);
    expect(bytesToUtf8(bytes)).toBe(Buffer.from(bytes).toString("utf8"));
  });
});
