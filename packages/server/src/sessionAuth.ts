import { z } from "zod";
import type { JwtFailureReason, JwtResult } from "./jwt";

/** What Val's session cookie carries, once its signature is verified. */
export const IntegratedServerJwtPayload = z.object({
  sub: z.string(),
  exp: z.number(),
  token: z.string(),
  org: z.string(),
  project: z.string(),
});
export type IntegratedServerJwtPayload = z.infer<
  typeof IntegratedServerJwtPayload
>;

/**
 * The message we show the user when their session cookie does not verify. The
 * distinction matters: an expired session is normal and self-explanatory, while
 * a bad signature means the cookie was tampered with or `VAL_SECRET` changed.
 */
export function sessionErrorMessage(reason: JwtFailureReason): string {
  switch (reason) {
    case "expired":
      return "Session expired. You will need to login again.";
    case "malformed":
    case "invalid-signature":
      return "Could not verify session (invalid token). You will need to login again.";
    case "missing-secret":
      return "Setup is not correct: secret is missing";
  }
}

/** Who a session is, as Val's server decides it: see {@link sessionAuth}. */
export type SessionAuth =
  | { error: string }
  | { id: string; error?: undefined }
  | { error: null; id: null };

/**
 * Who the `val_session` cookie says the caller is. One rule for every door
 * to content: Val's API routes (`ValServer`'s `getAuth`) and the draft
 * readers in the same process (`ValRuntime.authorize`), which read the head
 * directly rather than through a private server of their own.
 *
 * `requiresAuth`, not "patches are local": a server that requires none (fs
 * mode, a developer's own machine; memory mode allowed unauthenticated)
 * answers anonymous SUCCESS -- `{ error: null }` -- where it cannot verify.
 */
export function sessionAuth(
  cookie: string | undefined,
  opts: {
    valSecret: string | undefined;
    requiresAuth: boolean;
    verifyJwt: (token: string, secretKey: string) => JwtResult;
  },
): SessionAuth {
  if (!opts.valSecret) {
    if (!opts.requiresAuth) {
      return { error: null, id: null };
    }
    return { error: "Setup is not correct: secret is missing" };
  }
  if (typeof cookie !== "string") {
    if (!opts.requiresAuth) {
      return { error: null, id: null };
    }
    return { error: "Login required: cookie not found" };
  }
  const verifiedToken = opts.verifyJwt(cookie, opts.valSecret);
  if (!verifiedToken.success) {
    if (!opts.requiresAuth) {
      return { error: null, id: null };
    }
    return { error: sessionErrorMessage(verifiedToken.reason) };
  }
  const verification = IntegratedServerJwtPayload.safeParse(verifiedToken.data);
  if (!verification.success) {
    if (!opts.requiresAuth) {
      return { error: null, id: null };
    }
    return { error: "Session invalid. You will need to login again." };
  }
  return { id: verification.data.sub };
}
