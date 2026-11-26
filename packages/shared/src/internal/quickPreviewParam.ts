/**
 * The address of a quick preview's document, alone in its module: the client
 * entry asks it on every page a visitor opens (`hydrateValRoot` in
 * `@valbuild/tanstack/entry-client`), so it must not bring the rest of
 * `quickPreview.ts` -- the worker's source among it -- with it.
 */

/** The parameter a quick preview's page is opened with. */
export const QUICK_PREVIEW_PARAM = "val_quick";

/**
 * Whether `url` is a quick preview's document: opened with
 * {@link QUICK_PREVIEW_PARAM}, which is also the only document the worker
 * hands the new code to and adds its render script to. Such a document's
 * markup was rendered by the LAST build's server, so its app is rendered by
 * the new code, never hydrated (`hydrateValRoot`).
 */
export function isQuickPreviewUrl(url: string): boolean {
  try {
    return new URL(url).searchParams.has(QUICK_PREVIEW_PARAM);
  } catch {
    return false;
  }
}
