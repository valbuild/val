import { Internal } from "@valbuild/core";

/**
 * The proposal this Studio was in last time, remembered by the browser for
 * this origin.
 *
 * At a proposal's address the Studio learns it is in one from `/stat`, and
 * until that answers the bar looked like the site's -- the switcher saying
 * "The site", the green Publish -- and then changed under the editor. A
 * proposal's address is an origin of its own (`<name>.valstart.dev`), so
 * what was true here last time is what is true now, and the bar can start
 * in the proposal at once. `/stat` still decides: when it answers, this is
 * written again, or cleared.
 *
 * A convenience, so `localStorage` and every access wrapped: a private window
 * or blocked storage only means waiting for `/stat`, as before.
 */
export type RememberedProposal = {
  name: string;
  branch: string;
  /** What people call it, once it has been read: the switcher names it. */
  displayName: string | null;
};

const KEY = "val:proposal-here";

export function readRememberedProposal(): RememberedProposal | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      "branch" in parsed &&
      typeof parsed.name === "string" &&
      typeof parsed.branch === "string"
    ) {
      const displayName =
        "displayName" in parsed && typeof parsed.displayName === "string"
          ? parsed.displayName
          : null;
      return { name: parsed.name, branch: parsed.branch, displayName };
    }
    return null;
  } catch (err) {
    Internal.log.debug("Could not read the remembered proposal", err);
    return null;
  }
}

export function rememberProposal(value: RememberedProposal | null): void {
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch (err) {
    Internal.log.debug("Could not remember the proposal", err);
  }
}
