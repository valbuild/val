import { Internal } from "@valbuild/core";

/**
 * SHA-256 of `bytes`, as lowercase hex — the same string
 * `Internal.getSHA256Hash` gives, which names files and remote refs.
 *
 * `crypto.subtle` where there is one, because a video is hundreds of
 * megabytes and the JS implementation hashes on the main thread. It exists
 * only in a secure context, so the JS one is the fallback rather than an
 * error — fed a chunk at a time, with the thread handed back between chunks,
 * so the Studio keeps painting while a large file is hashed.
 */
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && globalThis.isSecureContext) {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  const hash = Internal.createSHA256Hash();
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    hash.update(bytes.subarray(offset, offset + CHUNK));
    if (offset + CHUNK < bytes.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return hash.digest("hex");
}

/** About a frame's worth of hashing on an ordinary laptop. */
const CHUNK = 1024 * 1024;
