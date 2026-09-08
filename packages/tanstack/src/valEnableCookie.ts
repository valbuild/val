import { Internal } from "@valbuild/core";

/**
 * Returns true if the Val Enable cookie is set to "true" in the given cookie
 * string (typically `document.cookie`).
 *
 * Exact-token match: a naive `includes("val_enable=true")` would also match
 * unrelated cookies like `xval_enable=true`. The server sets the cookie to
 * "false" (rather than deleting it) on disable, so the value must be checked
 * too.
 */
export function hasValEnableCookie(cookieString: string): boolean {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === Internal.VAL_ENABLE_COOKIE_NAME && value === "true") {
      return true;
    }
  }
  return false;
}
