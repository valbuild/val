// `import logo from './logo.png'`.
//
// An asset import is not really an import: the module's *value* is a URL, and
// what the bundler does is decide what that URL should be. Two answers, split
// by size, which is what every bundler does and for the same reasons:
//
//   small   a `data:` URI, inlined into the bundle. No request, no storage, no
//           cache entry -- at the cost of ~33% size growth from base64 and of
//           living in a bundle that is revalidated on every load.
//   large   published under `/_app/a/<hash>.<ext>` and served immutable. One
//           extra request, but the bytes are content-addressed and cached
//           forever, and they do not bloat the entry the browser must parse.
//
// The bytes have to reach the builder somehow, and the project file map is
// `Record<string, string>` -- text. So assets travel separately, base64-encoded,
// which is also the form they are published and stored in. Encoding once at the
// edge of the system and keeping it beats converting back and forth.
import { sha256Hex } from "./hash";

/**
 * Extensions treated as assets.
 *
 * Deliberately a list rather than "anything not JS or CSS": an unknown
 * extension should fail as an unresolved import naming the file, not silently
 * become a URL to something the browser cannot use.
 */
const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};

export const extensionOf = (path: string) => {
  const at = path.lastIndexOf(".");
  return at === -1 ? "" : path.slice(at).toLowerCase();
};

export const isAsset = (path: string) => extensionOf(path) in ASSET_TYPES;

export const mimeOf = (path: string) =>
  ASSET_TYPES[extensionOf(path)] ?? "application/octet-stream";

/**
 * Below this many decoded bytes, an asset is inlined as a data URI.
 *
 * 4 kB, matching Vite's `assetsInlineLimit` default. The trade is the same one
 * Vite is making: an extra request costs more than 4 kB of base64 does, and
 * above that it stops being true.
 */
export const INLINE_LIMIT = 4096;

/** Decoded byte length of base64, without decoding it. */
export function base64Bytes(base64: string) {
  const clean = base64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

export interface ResolvedAsset {
  /** What the importing module's default export becomes. */
  url: string;
  /** Set when the asset needs publishing; absent when it was inlined. */
  file?: { name: string; base64: string };
}

/**
 * Where an asset import resolves to, for one target.
 *
 * Server and client get the *same* URL. An asset is a URL in both, and SSR has
 * to emit the same `src` the browser will hydrate against -- a server bundle
 * with a different URL would be a hydration mismatch on every image.
 */
export async function resolveAsset(
  path: string,
  base64: string,
): Promise<ResolvedAsset> {
  if (base64Bytes(base64) <= INLINE_LIMIT) {
    return { url: `data:${mimeOf(path)};base64,${base64}` };
  }

  // Content-addressed, like the split chunks, and for the same reasons: the URL
  // can be immutable, and a publish cannot orphan an asset an older build still
  // points at.
  const hash = (await sha256Hex(base64)).slice(0, 16);
  const name = `${hash}${extensionOf(path)}`;
  return { url: `${ASSET_BASE}${name}`, file: { name, base64 } };
}

/** Where published assets are served from. Matched by the loader. */
export const ASSET_BASE = "/_app/a/";

/** The module a resolved asset import becomes. */
export const assetModule = (url: string) =>
  `export default ${JSON.stringify(url)}\n`;
