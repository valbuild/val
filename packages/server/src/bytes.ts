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

/**
 * The value of each character code, or -1 for one that is not base64. Both
 * alphabets, because `Buffer.from(s, "base64")` takes either: `-` and `_` are
 * the URL-safe spellings of `+` and `/`.
 */
const BASE64_VALUES = (() => {
  const BASE64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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
 *
 * `atob` first, because it is native and this is called with whole uploads;
 * it agrees with `Buffer` on everything it accepts, and refuses the rest (the
 * URL-safe alphabet, stray characters, `=` in the middle), which then goes the
 * slow way.
 */
export function base64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return lenientBase64ToBytes(base64);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function lenientBase64ToBytes(base64: string): Uint8Array {
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

/**
 * How many bytes go to `String.fromCharCode` at once: it takes them as
 * arguments, and an engine has a limit on how many a call may have.
 */
const CHUNK = 0x8000;

/**
 * `Buffer.from(bytes).toString("base64")`: padded, standard alphabet.
 *
 * Through `btoa`, which is native, rather than building the string here: that
 * was five times slower, and this is called with whole files. Node is still
 * faster with `Buffer`, which is why `ValServerPlatform.bytesToBase64` exists
 * for the paths that encode every file of a publish.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const binary: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    // `Reflect.apply` rather than a spread, which copies the chunk into an
    // argument list first and is four times slower.
    const chunk: string = Reflect.apply(
      String.fromCharCode,
      null,
      bytes.subarray(i, i + CHUNK),
    );
    binary.push(chunk);
  }
  return btoa(binary.join(""));
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
