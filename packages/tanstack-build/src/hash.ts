// One sha256, used by the build hash and by asset content-addressing.
//
// `crypto.subtle` rather than node:crypto: the builder runs in a browser tab as
// well as in Node, and this is the only digest available in both.
export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
