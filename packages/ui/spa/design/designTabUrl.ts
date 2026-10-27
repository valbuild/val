/**
 * Where a proposal's design tab is: `/val/design/<proposal>` on the SITE's
 * address, never the proposal's (valbuild/home `docs/design-tab.md`). The
 * tab is served by the site's build so that a build the assistant breaks in
 * the proposal cannot take down the tools it would fix it with.
 */
const DESIGN_PREFIX = "/val/design/";

/** A proposal's name: 20 hex characters, as content mints them. */
const PROPOSAL_NAME = /^[0-9a-f]{20}$/;

/** The design tab of proposal `name`, on the site at `siteUrl`. */
export function designTabUrl(siteUrl: string, name: string): string {
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
