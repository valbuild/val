/*
 * The upgrade page: a whole upgrade -- typechecked, built, rendered,
 * published -- at its proposal's address, on every device. The Studio that
 * started it goes there once the upgrade's dependencies are built
 * (`prepareUpgrade.ts`), in the same tab.
 *
 * Its own page because only a cross-origin isolated document can build, and
 * the Studio is not one in every browser: the loader isolates `/val` with
 * `COEP: credentialless`, which Safari does not know, so an iPhone's Studio
 * hands every build to a builder tab. The upgrade page is served
 * `require-corp`, which every browser knows, by the same rule in the loader
 * as the builder tab (`isBuilderTab`) -- which is why the parameter is in the
 * URL: the loader decides the headers before any script runs. The page
 * builds and publishes in place, and never hands anything off.
 *
 * Nothing it does on arrival goes live: it typechecks and builds a
 * proposal's preview, which is what opening the proposal did before. Publish
 * is a press, so a link to the page publishes nothing.
 */

/** The parameter, at an upgrade proposal's address: this is its tab. */
export const UPGRADE_TAB_PARAM = "val-upgrade";

/** The Studio's mount, which the loader isolates. */
const STUDIO_PATH = "/val";

/** The upgrade tab of the upgrade proposal served at `origin`. */
export function upgradeTabUrl(origin: string, name: string): string {
  const url = new URL(STUDIO_PATH, origin);
  url.searchParams.set(UPGRADE_TAB_PARAM, name);
  return url.href;
}

/** The proposal this document is the upgrade tab of; `null` when it is not one. */
export function upgradeTabOf(href: string): string | null {
  const name = new URL(href).searchParams.get(UPGRADE_TAB_PARAM);
  return name === null || name === "" ? null : name;
}

/** The Studio at the same address: the upgrade tab, left for a Review. */
export function withoutUpgradeTab(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(UPGRADE_TAB_PARAM);
  return url.href;
}

/** A tab for the upgrade, not a builder popup: it is where the person works. */
function openTab(url: string, target: string): Window | null {
  return window.open(url, target);
}

/** Open an upgrade proposal's page in a tab of its own, from a tap. */
export function openUpgradeTab(
  url: string,
  target: string,
  open: (url: string, target: string) => unknown = openTab,
): boolean {
  return open(url, target) !== null;
}
