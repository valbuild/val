/**
 * A v4 UUID, in an insecure context too.
 *
 * `crypto.randomUUID` is secure-context only: it exists on `https://` and on
 * `localhost`, and nowhere else. That reads like something a dev tool never
 * meets — but the Studio is served by the app's own dev server, and a dev
 * server gets opened over plain http at something that is not `localhost` all
 * the time: a phone on the LAN, a VM, or Firefox on Windows pointed at
 * `http://172.23.135.172:3000` for a server running in WSL. There `crypto` is
 * present and `crypto.randomUUID` is not, so the Studio mounted and then died
 * while rendering with `crypto.randomUUID is not a function`.
 *
 * `crypto.getRandomValues` is the fallback because it is NOT secure-context
 * gated — it is there over plain http, which is the whole of this problem — and
 * it is cryptographically secure, which some of these ids need:
 *
 * **A patch id is a bearer token.** `/api/val/files` serves unpublished files
 * with no auth at all, on the argument that a `patch_id` cannot be guessed
 * (`ValServer.ts`, and it says so: "If we couldn't argue that patch ids are
 * secret enough, then this would be a problem"). `PatchStore` mints them here.
 * So this function must never degrade to `Math.random` — a seeded, 32-bit,
 * sequentially-advancing PRNG would hand out guessable tokens in exactly the
 * environment a user reaches over an untrusted network. Where neither source
 * of randomness exists, it throws: the Studio was broken there anyway, and a
 * crash that names the reason beats draft content served to whoever asks.
 *
 * Use this everywhere in the Studio instead of `crypto.randomUUID` directly —
 * the call that broke was three levels deep in a hook, and any of them would
 * have done it.
 */
export function randomUUID(): string {
  // Partial<Crypto>, because the whole point is that this runs where the
  // members TypeScript promises are absent at runtime.
  const webCrypto: Partial<Crypto> | undefined = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new Error(
      "Val Studio needs crypto.getRandomValues, and this browser has neither " +
        "it nor crypto.randomUUID. Patch ids are unguessable tokens, so there " +
        "is no safe fallback: open the Studio in a current browser.",
    );
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  // RFC 4122 §4.4: version 4 in the high nibble of byte 6, variant 10 in the
  // two high bits of byte 8. Without these the string is random hex that is
  // not a UUID, and something downstream is entitled to notice.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
