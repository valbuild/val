import { Internal } from "@valbuild/core";

/**
 * The cookie that says a request is previewing unpublished content.
 *
 * Next has `draftMode()` for this; TanStack Start has no such notion, so Val
 * brings its own. Deliberately NOT the thing that grants access: every draft
 * read also carries the Val session cookie, which is a signed JWT the server
 * verifies, and a request with this cookie and no session gets published
 * content and a 401 in the log. So this is a mode switch, not a credential —
 * which is why an ordinary cookie is enough.
 */
export const VAL_DRAFT_MODE_COOKIE = "val_draft_mode";

const ENABLED = "1";

/**
 * Reading and writing the draft-mode flag for the current request.
 *
 * Handed to `createValServer` as its callbacks, and exported so an app can ask
 * the same question its loaders ask.
 */
export type ValDraftMode = {
  /** Whether this request is previewing unpublished content. */
  isEnabled(): Promise<boolean>;
  /** Turn preview on for this browser. Called by `/api/val/draft/enable`. */
  enable(): Promise<void>;
  /** Turn preview off again. Called by `/api/val/draft/disable`. */
  disable(): Promise<void>;
};

/**
 * The draft-mode flag, read from and written to the current request.
 *
 * TanStack's request helpers resolve the current request out of async local
 * storage, so this only works where there IS one: a server route handler, a
 * server function, or an SSR render. Everywhere else — a client navigation, a
 * build-time render — it answers "off", which is the right answer: there is no
 * session to authorize a draft read either.
 *
 * The import is dynamic for the same reason it is in `isValEnabled`: this
 * module is reachable from the package's server entry, and pulling TanStack's
 * server half in eagerly would put it in front of anything that merely
 * type-imports from here.
 */
export function valDraftMode(): ValDraftMode {
  return {
    async isEnabled() {
      try {
        const { getCookie } = await import("@tanstack/react-start/server");
        return getCookie(VAL_DRAFT_MODE_COOKIE) === ENABLED;
      } catch {
        return false;
      }
    },
    async enable() {
      const { setCookie, getRequest } =
        await import("@tanstack/react-start/server");
      setCookie(VAL_DRAFT_MODE_COOKIE, ENABLED, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Not `secure` unconditionally: the Studio is used over http on
        // localhost, and a Secure cookie is silently dropped there — which
        // looks exactly like draft mode refusing to turn on.
        secure: isSecureRequest(getRequest),
      });
    },
    async disable() {
      const { deleteCookie } = await import("@tanstack/react-start/server");
      deleteCookie(VAL_DRAFT_MODE_COOKIE, { path: "/" });
    },
  };
}

function isSecureRequest(getRequest: () => Request): boolean {
  try {
    return new URL(getRequest().url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The Val Enable cookie, as seen by the current request.
 *
 * Separate from draft mode: enabling Val is what makes the Studio overlay mount
 * at all, and draft mode is what makes the content it shows be the unpublished
 * one. The Studio turns the first on for the browser and the second on per
 * preview.
 */
export async function hasValEnableCookieOnServer(): Promise<boolean> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(Internal.VAL_ENABLE_COOKIE_NAME) === "true";
  } catch {
    return false;
  }
}
