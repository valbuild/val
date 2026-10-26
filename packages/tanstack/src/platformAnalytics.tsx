import type { ValAnalytics } from "./ValAnalytics";

/**
 * Content analytics as Val's hosting sets it, for a site whose layout passes
 * `<ValProvider>` no `analytics` of its own.
 *
 * Switching analytics on in a hosted project's settings sets the project's
 * `VAL_ANALYTICS` secret, and the platform starts the site's isolates again
 * with it -- along with `VAL_CONTENT_VERSION`, the id of the content version
 * they serve. Both arrive in `globalThis.__PLATFORM_SECRETS`. Reading them
 * here, rather than only in the layout's loader (`fetchValAnalytics()`), is
 * what makes the switch enough on its own: a site needs no code for it.
 *
 * The server render reads them and writes what it read into the page, as a
 * few bytes of JSON; the browser reads that back. Nothing is written while
 * analytics is off, so the page is the same as without Val's hosting.
 *
 * Only what the platform HANDED this isolate is read, never `process.env`:
 * that is baked into the bundle at build time, and a `VAL_ANALYTICS` there
 * would be a second switch, in the code, that keeps counting after the owner
 * has turned it off.
 */

/** The element the server render writes the setting into. */
export const PLATFORM_ANALYTICS_ID = "__val_analytics";

/**
 * One secret the platform handed this isolate, when it is one of Val's.
 * Read off the object as it is, the way the generated `fetchValAnalytics()`
 * does, so the two cannot disagree about what was handed over.
 */
function platformSecret(name: string): unknown {
  const handed: unknown = Reflect.get(globalThis, "__PLATFORM_SECRETS");
  return typeof handed === "object" && handed !== null
    ? Reflect.get(handed, name)
    : undefined;
}

/** The setting the platform handed this isolate; null when it is not on. */
export function analyticsFromPlatform(): ValAnalytics | null {
  if (platformSecret("VAL_ANALYTICS") !== "true") return null;
  const contentVersion = platformSecret("VAL_CONTENT_VERSION");
  return {
    enabled: true,
    ...(typeof contentVersion === "string" && contentVersion !== ""
      ? { contentVersion }
      : {}),
  };
}

/**
 * What the page said, once it said it. The element lives inside the provider,
 * so a client navigation that unmounts the provider takes it with it, and the
 * provider mounted again must still know: the page did not stop being one
 * with analytics on. A page load starts this module again.
 *
 * It is the page's setting, so it reaches every provider on the page that is
 * not told otherwise -- one that is passed `analytics`, on the server and in
 * the browser, decides for itself.
 */
let readFromPage: ValAnalytics | null = null;

/** The setting the server render wrote into this page; null when it wrote none. */
export function analyticsFromPage(): ValAnalytics | null {
  if (readFromPage !== null) return readFromPage;
  const element = document.getElementById(PLATFORM_ANALYTICS_ID);
  if (element === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(element.textContent ?? "");
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("enabled" in value) ||
    value.enabled !== true
  ) {
    return null;
  }
  const contentVersion =
    "contentVersion" in value && typeof value.contentVersion === "string"
      ? value.contentVersion
      : undefined;
  readFromPage = {
    enabled: true,
    ...(contentVersion !== undefined ? { contentVersion } : {}),
  };
  return readFromPage;
}

/** On the server, what the platform handed it; in the browser, what the server wrote. */
export function analyticsOfThisPage(): ValAnalytics | null {
  return typeof document === "undefined"
    ? analyticsFromPlatform()
    : analyticsFromPage();
}

/**
 * The setting as JSON that can sit inside a `<script>`: a `<` is written as
 * `\u003c`, so nothing in it can end the element.
 */
export function embeddableJson(value: ValAnalytics): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Where the server render leaves the setting for the browser. Rendered the
 * same on both sides -- the browser renders what it read -- so it hydrates
 * without a mismatch.
 */
export function PlatformAnalytics({ value }: { value: ValAnalytics }) {
  return (
    <script
      type="application/json"
      id={PLATFORM_ANALYTICS_ID}
      dangerouslySetInnerHTML={{ __html: embeddableJson(value) }}
    />
  );
}
