/**
 * Bytes as text and back, without Node's `Buffer`.
 *
 * The request handlers run in a browser tab too (`@valbuild/server/browser`),
 * and a browser has no `Buffer`. Importing npm's `buffer` instead is what broke
 * the demo under `vite dev`: it is CommonJS, and a dependency the dev server
 * did not see in its scan is served unconverted. So bytes are `Uint8Array`
 * here, and these are the conversions `Buffer` used to do -- with the same
 * answers, which `bytes.test.ts` checks against `Buffer` itself.
 */

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The value of each character code, or -1 for one that is not base64. Both
 * alphabets, because `Buffer.from(s, "base64")` takes either: `-` and `_` are
 * the URL-safe spellings of `+` and `/`.
 */
const BASE64_VALUES = (() => {
  const values = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    values[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  values["-".charCodeAt(0)] = 62;
  values["_".charCodeAt(0)] = 63;
  return values;
})();

const PADDING = "=".charCodeAt(0);

/**
 * Decodes base64 the way `Buffer.from(base64, "base64")` does: either
 * alphabet, padding optional, anything that is not base64 skipped, and
 * decoding stops at the first `=`. A trailing partial group gives the whole
 * bytes it holds.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor((base64.length * 3) / 4));
  let length = 0;
  let bits = 0;
  let bitCount = 0;
  for (let i = 0; i < base64.length; i++) {
    const code = base64.charCodeAt(i);
    if (code === PADDING) break;
    const value = code < 128 ? BASE64_VALUES[code] : -1;
    if (value < 0) continue;
    bits = ((bits << 6) | value) & 0xffffff;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[length++] = (bits >> bitCount) & 0xff;
    }
  }
  return bytes.subarray(0, length);
}

/** `Buffer.from(bytes).toString("base64")`: padded, standard alphabet. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const group = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      BASE64_ALPHABET[group >> 18] +
      BASE64_ALPHABET[(group >> 12) & 63] +
      BASE64_ALPHABET[(group >> 6) & 63] +
      BASE64_ALPHABET[group & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const group = bytes[i] << 16;
    out += BASE64_ALPHABET[group >> 18] + BASE64_ALPHABET[(group >> 12) & 63];
    out += "==";
  } else if (rest === 2) {
    const group = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      BASE64_ALPHABET[group >> 18] +
      BASE64_ALPHABET[(group >> 12) & 63] +
      BASE64_ALPHABET[(group >> 6) & 63];
    out += "=";
  }
  return out;
}

/** `Buffer.from(text, "utf8")`. */
export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * `Buffer.from(bytes).toString("utf8")`. `ignoreBOM` because `Buffer` keeps a
 * leading byte order mark, where a `TextDecoder` drops it by default.
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}
