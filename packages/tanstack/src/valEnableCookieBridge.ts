/**
 * How `initVal().isValEnabled()` reaches the server without importing it.
 *
 * EXPERIMENTAL — see VAL_PROMPT.md.
 *
 * The cookie can only be read through `@tanstack/react-start/server`, and that
 * module is reachable from this package's ROOT entry, which every client
 * component imports. `initVal.ts` used `await import()` for exactly that reason,
 * and under Vite the dynamic form does keep it out of the client bundle.
 *
 * It does not everywhere. A host that bundles this package ahead of time and
 * audits what each chunk imports sees a dynamically imported chunk as a chunk
 * like any other, and this one reaches TanStack's SSR path and lands on
 * `node:stream/web`. That is why `@valbuild/tanstack` could not be built for a
 * Cloudflare Worker at all.
 *
 * So the edge is inverted. The root entry holds a slot; `@valbuild/tanstack/server`
 * fills it on import with the implementation that was already there,
 * `hasValEnableCookieOnServer`. Nothing about the behaviour changes for an app
 * that imports `/server` — which every app with a Val API does — and the root
 * entry no longer names TanStack's server module at all.
 *
 * Ordering: the slot is filled when `/server` is first imported. An
 * `isValEnabled()` call that somehow happens before that returns false, which
 * is what the old implementation's `catch` returned in the same situation.
 */
type ValEnableCookieReader = () => Promise<boolean>;

let reader: ValEnableCookieReader | null = null;

export function setValEnableCookieReader(read: ValEnableCookieReader): void {
  reader = read;
}

export async function readValEnableCookie(): Promise<boolean> {
  if (!reader) {
    return false;
  }
  try {
    return await reader();
  } catch {
    return false;
  }
}
