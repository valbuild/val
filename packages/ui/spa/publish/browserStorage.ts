/**
 * This origin's `localStorage`, or `null` where there is none to use.
 *
 * Through `try`: storage can be off, or throw on access, in a private window
 * or with site data blocked -- and then the caller simply has nothing stored.
 */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
