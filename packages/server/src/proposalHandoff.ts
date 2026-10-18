import crypto from "crypto";

/**
 * Carrying a session from the Studio someone is signed in to, to a proposal's
 * address, without the round trip through Val Build.
 *
 * Opening a proposal is navigating to its address, another origin, where this
 * browser has no `val_session` yet. Without one, the address's gate sends the
 * person through Val's sign-in: `/api/val/authorize`, Val Build's
 * "Authorizing" screen, the callback, a "Signed in" page and only then the
 * Studio -- four screens, for someone who was signed in to the same project a
 * moment ago.
 *
 * Every address of a project verifies `val_session` with the project's
 * `VAL_SECRET`, the same secret this server signed the session with. So the
 * session is handed over: this server seals it for ONE address, the Studio
 * POSTs the sealed handoff there in a top-level form, and the platform's
 * loader at that address opens it, sets the cookie and lands on the Studio
 * page (valbuild/home `platform/packages/loader/src/proposalHandoff.ts`).
 * Anything that fails there falls back to the sign-in it replaces, so the
 * worst case is what happened before.
 *
 * Sealed rather than signed, because the session carries the editor's Val
 * Build token and the cookie is HttpOnly: a signature would leave both
 * readable to the Studio's script, which is exactly what HttpOnly withholds.
 *
 * The format is shared with the loader, which is written against WebCrypto,
 * so it must not change on one side only:
 *
 * - key: SHA-256 of `HANDOFF_KEY_CONTEXT + VAL_SECRET` (UTF-8), as an
 *   AES-256-GCM key;
 * - token: base64url of a 12-byte IV, then the ciphertext with its 16-byte tag
 *   appended (WebCrypto's layout);
 * - plaintext: the JSON of {@link ProposalHandoff}.
 */
export type ProposalHandoff = {
  v: 1;
  /** The one origin that may open it: the proposal's address. */
  aud: string;
  /** Seconds since the epoch. Short: it is spent by the next request. */
  exp: number;
  /** The `val_session` cookie, as it is. */
  session: string;
};

export const HANDOFF_KEY_CONTEXT = "val-proposal-handoff:";
/** Where at an address the loader takes a handoff. */
export const HANDOFF_PATH = "/__val/handoff";
/** Long enough for one navigation on a slow connection, and no longer. */
export const HANDOFF_SECONDS = 60;

function handoffKey(valSecret: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(HANDOFF_KEY_CONTEXT + valSecret, "utf8")
    .digest();
}

export function sealProposalHandoff(
  handoff: Omit<ProposalHandoff, "v">,
  valSecret: string,
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    handoffKey(valSecret),
    iv,
  );
  const plaintext: ProposalHandoff = { v: 1, ...handoff };
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64url",
  );
}
