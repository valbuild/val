import { isPathWithin } from "./sourcePath";

/**
 * Whether the editor is on `path`, or somewhere inside it.
 *
 * The filter hides content in another language from every list, so the only
 * way to get there is to be sent: a link, a reference, an error. Then the
 * editor is shown it, and the row it is in stays listed while they are on it —
 * a menu that hides where you are cannot say where you are. Only that row:
 * its siblings in the same language stay hidden, and it leaves the menu as soon
 * as the editor goes anywhere else.
 */
export function isAtLocation(
  location: string | null,
  path: string | undefined,
): boolean {
  return (
    location !== null &&
    location !== "" &&
    path !== undefined &&
    path !== "" &&
    isPathWithin(location, path)
  );
}
