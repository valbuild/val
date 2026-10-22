import { handoffUrl, storeHandoffIntent } from "../publish/handoff";
import { randomUUID } from "../utils/randomUUID";
import type { UpgradePath } from "./upgradesClient";

/*
 * The upgrade tab: a whole upgrade -- computed, its dependencies built,
 * typechecked, built, published -- in one tab of its own, on every device.
 *
 * Its own tab because only a cross-origin isolated document can build, and
 * the Studio is not one in every browser: the loader isolates `/val` with
 * `COEP: credentialless`, which Safari does not know, so an iPhone's Studio
 * hands every build to a builder tab. The builder tab is served
 * `require-corp`, which every browser knows -- and so is this tab, by the
 * same rule in the loader (`isBuilderTab`), which is why the parameter is in
 * the URL: the loader decides the headers before any script runs. The tab
 * builds and publishes in place, and never hands anything off.
 *
 * Nothing it does on arrival goes live: it computes, typechecks and builds a
 * proposal's preview, which is what opening the proposal did before. Publish
 * is a press, so a link to the tab publishes nothing.
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

/** What a tap on Upgrade did: the tab it opened, or why it could not. */
export type StartedUpgrade =
  | {
      status: "opened";
      /** The tab, to open again from a tap if it was closed. */
      url: string;
      target: string;
    }
  /** The browser kept the tab from opening: a tap on Open tab opens it. */
  | { status: "blocked"; url: string; target: string }
  /** Storage would not take the intent: no tab could know what to do. */
  | { status: "not-stored" };

/**
 * Start an upgrade in its own tab, in the tap: the tab is opened before
 * anything awaits, because a window opened after an await has lost the tap
 * that allowed it -- and on an iPhone the tab takes the screen and this page
 * is paused behind it, so the tab, not this page, creates the proposal.
 * What it is to create is written down first, as a builder tab's publish is
 * (`publish/handoff.ts`): never in the URL, which anyone can send.
 */
export function startUpgradeInTab(
  input: { path: UpgradePath; skip: string[]; requestId: string },
  deps: {
    open?: (url: string, target: string) => unknown;
    storage?: Storage | null;
  } = {},
): StartedUpgrade {
  const id = randomUUID();
  const stored = storeHandoffIntent(
    id,
    {
      kind: "start-upgrade",
      requestId: input.requestId,
      path: input.path,
      skip: input.skip,
    },
    deps.storage,
  );
  if (!stored) return { status: "not-stored" };
  const url = handoffUrl(id, STUDIO_PATH);
  const target = `val-upgrade-${id}`;
  const opened = (deps.open ?? openTab)(url, target) !== null;
  return { status: opened ? "opened" : "blocked", url, target };
}

/** Open a tab again, from a tap: the one an upgrade started, or its proposal's. */
export function openUpgradeTab(
  url: string,
  target: string,
  open: (url: string, target: string) => unknown = openTab,
): boolean {
  return open(url, target) !== null;
}
