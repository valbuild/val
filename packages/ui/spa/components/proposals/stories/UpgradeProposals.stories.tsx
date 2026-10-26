import type { Meta } from "@storybook/react";
import { mockSelectionIds } from "../../shell/mockShellData";
import type { ProposalSummary } from "../types";
import {
  PASSING_CHECKS,
  inUpgrade,
  minorUpgrade,
  open,
  proposals,
  shell,
  upgradeProposal,
} from "./proposalsShellHarness";

/**
 * Upgrades in the Studio, on a desktop (valbuild/home
 * `docs/plans/upgrades-v2.md`, piece E). An upgrade is made and checked in
 * Val Build; the Studio says there is one to make, follows one under way, and
 * at the upgrade proposal's own address says what it upgrades and publishes
 * it.
 *
 * `Proposals/Upgrade` is the notice on its own; these are the same notices in
 * the whole Studio, beside the bar they share the screen with.
 */
const meta: Meta = {
  title: "Proposals/Upgrade in the Studio",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

const withUpgrade: ProposalSummary[] = [upgradeProposal, ...proposals];
const home = mockSelectionIds.home;

/*
 * ON THE SITE.
 */

/** There is something to upgrade: Updates, in the top bar, opens Val Build. */
export const UpdatesAvailable = shell({
  location: { kind: "site" },
  selectionId: home,
  updates: { vulnerable: false, label: "Val 0.150.0 is out", onOpen: () => {} },
});

/** An upgrade fixes a vulnerability: the button is marked. */
export const SecurityUpdatesAvailable = shell({
  location: { kind: "site" },
  selectionId: home,
  updates: {
    vulnerable: true,
    label: "Security fixes are out",
    onOpen: () => {},
  },
});

/** An upgrade was started in Val Build: the site says so until it is done. */
export const UpgradeUnderWay = shell({
  location: { kind: "site" },
  list: withUpgrade,
  selectionId: home,
  upgradeUnderWay: upgradeProposal.displayName,
});

/** The switcher on the site: the upgrade is listed with the proposals. */
export const UpgradeInTheSwitcher = shell({
  location: { kind: "site" },
  list: withUpgrade,
  switcherOpen: true,
  upgradeUnderWay: upgradeProposal.displayName,
});

/** All proposals, with an upgrade among them. */
export const UpgradeInAllProposals = shell({
  location: { kind: "site" },
  list: withUpgrade,
  dialog: "all",
});

/*
 * AT THE UPGRADE PROPOSAL'S ADDRESS, where Val Build's "Open the proposal"
 * lands.
 */

/** Checked in Val Build: look around, then publish to update the site. */
export const InAnUpgrade = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
});

/** Nothing open in the editor: the notice above the empty state. */
export const InAnUpgradeNothingOpen = shell({
  location: inUpgrade(),
  list: withUpgrade,
  upgrade: minorUpgrade,
});

/** Security fixes, said as such, with how many. */
export const InASecurityUpgrade = shell({
  location: inUpgrade({
    proposal: { ...upgradeProposal, displayName: "Security fixes" },
  }),
  list: withUpgrade,
  selectionId: home,
  upgrade: {
    ...minorUpgrade,
    path: "cves",
    changes: [{ name: "vite", from: "7.1.2", to: "7.1.5", kind: "patch" }],
    vulnerableBefore: 2,
    vulnerableAfter: 0,
  },
});

/** A major version: marked on its package. */
export const InAMajorUpgrade = shell({
  location: inUpgrade({
    proposal: { ...upgradeProposal, displayName: "Full upgrade" },
  }),
  list: withUpgrade,
  selectionId: home,
  upgrade: {
    ...minorUpgrade,
    path: "majors",
    changes: [
      {
        name: "@valbuild/tanstack",
        from: "0.149.4",
        to: "1.0.0",
        kind: "major",
      },
      ...minorUpgrade.changes.slice(1),
    ],
  },
});

/** Still being worked out in Val Build: nothing to publish yet. */
export const InAnUpgradeBeingWorkedOut = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: { ...minorUpgrade, state: "computing", changes: [] },
});

/** It could not be worked out: what went wrong, and where to see more. */
export const InAnUpgradeThatFailed = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: {
    ...minorUpgrade,
    state: "failed",
    changes: [],
    error:
      "No version of @tanstack/react-start fits @valbuild/tanstack 0.149.7.",
  },
});

/**
 * Someone edited content at the upgrade's address: Save appears, and the
 * upgrade now holds content changes too.
 */
export const InAnUpgradeWithEdits = shell({
  location: inUpgrade({ unsaved: 2 }),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
});

/** The switcher from inside the upgrade: "here" is the upgrade. */
export const InAnUpgradeSwitcherOpen = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
  switcherOpen: true,
});

/** The bar's menu, in an upgrade. */
export const InAnUpgradeMenuOpen = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
  menuOpen: true,
});

/** Publish, from the notice or the bar: the merge checks, then Publish. */
export const PublishAnUpgrade = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
  dialog: "publish",
  publishState: {
    kind: "ready",
    checks: PASSING_CHECKS,
    changes: 0,
    unsaved: 0,
  },
});

export const PublishingAnUpgrade = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
  dialog: "publish",
  publishState: { kind: "publishing", step: "building" },
});

export const UpgradePublished = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
  dialog: "publish",
  publishState: { kind: "merged" },
});

/** Discard: closing an upgrade leaves the site's dependencies as they are. */
export const DiscardAnUpgrade = shell({
  location: inUpgrade(),
  list: withUpgrade,
  selectionId: home,
  upgrade: minorUpgrade,
  dialog: "close",
});

/** In an ordinary proposal while an upgrade is open: nothing about it here. */
export const InAProposalWhileAnUpgradeIsOpen = shell({
  location: inUpgrade({ proposal: open[0]!, unsaved: 3 }),
  list: withUpgrade,
  selectionId: home,
  updates: { vulnerable: false, label: "Val 0.150.0 is out", onOpen: () => {} },
});
