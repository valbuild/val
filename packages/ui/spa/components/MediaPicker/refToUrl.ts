import { mediaUrlOf } from "../../utils/mediaUrl";

/**
 * A gallery ref (which is a file path) as a URL, draft patch included.
 *
 * Kept as a name because the media picker's data layer reads in terms of refs;
 * the rule itself is `mediaUrlOf`, which is where every other caller goes.
 */
export function refToUrl(
  ref: string,
  filePatchIds: ReadonlyMap<string, string>,
): string {
  // A ref is always a non-empty path, so there is always a URL.
  return mediaUrlOf(ref, filePatchIds) ?? ref;
}
