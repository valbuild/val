/**
 * Where a proposal's design tab is: `/val/design/<proposal>` on the SITE's
 * address, never the proposal's (valbuild/home `docs/design-tab.md`). The
 * tab is served by the site's build so that a build the assistant breaks in
 * the proposal cannot take down the tools it would fix it with.
 */
const DESIGN_PREFIX = "/val/design/";

/** A proposal's name: 20 hex characters, as content mints them. */
const PROPOSAL_NAME = /^[0-9a-f]{20}$/;

/**
 * The design tab of proposal `name`, opened from `here` -- the page the
 * proposal's Studio is on.
 *
 * On the site's address beside the proposal's: `<proposal>--<project>.<host>`
 * is the proposal's, and `<project>.<host>` the site's, which is the SAME SITE
 * to a browser on valstart.dev -- so the tab's frame of the proposal is sent
 * the editor's session. `siteUrl`, the site as content names it, may be a
 * custom domain, from which the proposal is another site and the frame is
 * signed out; it is the fallback, where the address is not a proposal's by
 * name (a local loader reached by header).
 */
export function designTabUrl(
  here: string,
  name: string,
  siteUrl: string,
): string {
  const url = new URL(here);
  const [label, ...rest] = url.hostname.split(".");
  const prefix = `${name}--`;
  if (label.startsWith(prefix) && label.length > prefix.length) {
    url.hostname = [label.slice(prefix.length), ...rest].join(".");
    return new URL(`${DESIGN_PREFIX}${name}`, url.origin).toString();
  }
  return new URL(`${DESIGN_PREFIX}${name}`, siteUrl).toString();
}

/**
 * The proposal a design tab's path names, or `null` when the path is not a
 * design tab's: anything but `/val/design/<20 hex>`, with or without a
 * trailing slash.
 */
export function designProposalOf(pathname: string): string | null {
  if (!pathname.startsWith(DESIGN_PREFIX)) return null;
  const name = pathname.slice(DESIGN_PREFIX.length).replace(/\/$/, "");
  return PROPOSAL_NAME.test(name) ? name : null;
}
