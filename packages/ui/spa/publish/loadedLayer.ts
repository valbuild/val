/**
 * Has the site moved onto other dependencies since this page loaded?
 *
 * A managed project's Studio is served by the site's own live build, so the
 * Studio on screen -- its builder, its Val -- is the version that build was
 * made with. When the site is updated (Settings → Updates, in this tab or
 * another), every Studio opened before that is the OLD version, and a publish
 * from one would build the site with the old builder, or, if it read its build
 * target before the update went live, put the old dependencies back.
 *
 * So the page remembers which dependency layer the live build had when it
 * loaded, and a publish compares that with the live build's now. They differ
 * only when somebody moved the site's dependencies in between; the answer is
 * to reload, which loses nothing -- unpublished changes are the server's.
 *
 * Read from `/__api/head`, which the platform answers on every site without a
 * credential and which names the layer (`projectVendorRev`). Anything that
 * cannot answer -- not on the platform, the loader unreachable, an older
 * loader -- reads as "cannot tell", and "cannot tell" never blocks a publish.
 */

/**
 * The layer, or `undefined` for "cannot tell". `null` is never READ -- a head
 * that names no layer is "cannot tell" too, see `readLiveLayer` -- but is what
 * a build target says for a project with none, which is why it is comparable.
 */
export type LayerReading = string | null | undefined;

export async function readLiveLayer(
  fetchImpl: typeof fetch = fetch,
): Promise<LayerReading> {
  try {
    const res = await fetchImpl("/__api/head", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const body: unknown = await res.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || !("hash" in body)) {
      return undefined;
    }
    /*
     * Only a layer that is NAMED is an answer. An absent field is the same
     * "cannot tell" as an unreachable loader: a head with no layer is a
     * project the Studio cannot publish anyway, and an older loader that did
     * not report one would otherwise refuse every publish from every page.
     */
    return "projectVendorRev" in body &&
      typeof body.projectVendorRev === "string"
      ? body.projectVendorRev
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stale only on a positive answer from both readings. A page that could not
 * tell what it loaded on, or cannot tell now, publishes as before.
 */
export function layerMoved(loaded: LayerReading, now: LayerReading): boolean {
  if (loaded === undefined || now === undefined) return false;
  return loaded !== now;
}

let loaded: Promise<LayerReading> | null = null;

/**
 * Take the reading this page is compared against. Once per page: the first
 * call wins, because a later one would record the layer an update just moved
 * to and make a stale page look current.
 */
export function rememberLoadedLayer(fetchImpl: typeof fetch = fetch): void {
  loaded ??= readLiveLayer(fetchImpl);
}

/** What {@link rememberLoadedLayer} read, or `undefined` if it never ran. */
export function loadedLayer(): Promise<LayerReading> {
  return loaded ?? Promise.resolve(undefined);
}

/** Has the live build's layer moved since this page loaded? */
export async function siteMovedSinceLoad(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const before = await loadedLayer();
  if (before === undefined) return false;
  return layerMoved(before, await readLiveLayer(fetchImpl));
}

/** The code a deploy refuses with when this page is out of date. */
export const STUDIO_OUT_OF_DATE = "STUDIO_OUT_OF_DATE";

export const STUDIO_OUT_OF_DATE_MESSAGE =
  "Your site was updated after this Studio was opened. Reload to publish. " +
  "Your changes are kept.";

/*
 * Whether this page has been told it is out of date. Module state rather than
 * React state, because it is found in two places that share no component -- a
 * publish's pre-check and the deploy under it -- and shown in a third.
 */
/**
 * How many times a publish has been refused for it. A count rather than a
 * flag, so a dialog dismissed once is shown again by the next refused press.
 */
let refusals = 0;
const listeners = new Set<() => void>();

export function markStudioOutOfDate(): void {
  refusals++;
  for (const listener of listeners) listener();
}

export function studioOutOfDateRefusals(): number {
  return refusals;
}

export function subscribeStudioOutOfDate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests: forget everything this module has learnt. */
export function resetLoadedLayerForTests(): void {
  loaded = null;
  refusals = 0;
  listeners.clear();
}
