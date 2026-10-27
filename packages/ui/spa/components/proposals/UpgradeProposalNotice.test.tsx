/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import type { ProposalUpgrade } from "../../proposals/proposalsClient";
import { UpgradeProposalNotice } from "./UpgradeProposalNotice";

/*
 * The Studio at an upgrade proposal's address: it looks like the site as it
 * is, so the notice says what it upgrades, and that publishing it is what
 * updates the site.
 */

const upgrade = (over: Partial<ProposalUpgrade> = {}): ProposalUpgrade => ({
  path: "latest",
  state: "staged",
  changes: [
    { name: "@valbuild/core", from: "0.149.4", to: "0.149.7", kind: "patch" },
    {
      name: "@valbuild/tanstack",
      from: "0.149.4",
      to: "0.149.7",
      kind: "patch",
    },
    { name: "vite", from: "7.1.2", to: "7.1.5", kind: "patch" },
  ],
  vulnerableBefore: null,
  vulnerableAfter: null,
  error: null,
  ...over,
});

test("names the Val it upgrades to, by the site's framework binding", () => {
  render(
    <UpgradeProposalNotice upgrade={upgrade()} siteName="quiet-harbor-24" />,
  );
  expect(
    screen.getByText("This proposal upgrades Val 0.149.4 → 0.149.7"),
  ).toBeTruthy();
  expect(screen.getByText(/It holds no content changes/)).toBeTruthy();
  expect(screen.getByText("And 2 more packages")).toBeTruthy();
});

test("Publish is the top bar's: the notice says which site it updates, and links the checks", () => {
  render(
    <UpgradeProposalNotice
      upgrade={upgrade()}
      siteName="quiet-harbor-24"
      checksHref="https://admin.val.build/~/acme/quiet-harbor-24/updates/p"
    />,
  );
  expect(
    screen.getByText(/press Publish to update quiet-harbor-24/),
  ).toBeTruthy();
  // One Publish on the screen, in the bar, rather than two for one act.
  expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
  expect(
    screen.getByRole("link", { name: /See the checks in Val Build/ }),
  ).toBeTruthy();
});

test("content edited at the upgrade's address is said, not denied", () => {
  render(<UpgradeProposalNotice upgrade={upgrade()} contentChanges={2} />);
  expect(screen.queryByText(/no content changes/)).toBeNull();
  expect(screen.getByText(/It also holds 2 content changes/)).toBeTruthy();
});

test("nothing to upgrade says so", () => {
  render(
    <UpgradeProposalNotice
      upgrade={upgrade({ state: "nothing", changes: [] })}
    />,
  );
  expect(screen.getByText("There is nothing to upgrade")).toBeTruthy();
});

test("nothing to publish while Val Build works it out", () => {
  render(
    <UpgradeProposalNotice
      upgrade={upgrade({ state: "computing", changes: [] })}
    />,
  );
  expect(
    screen.getByText("Val Build is working out this upgrade"),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("security fixes are counted", () => {
  render(
    <UpgradeProposalNotice
      upgrade={upgrade({
        path: "cves",
        changes: [{ name: "vite", from: "7.1.2", to: "7.1.5", kind: "patch" }],
        vulnerableBefore: 2,
        vulnerableAfter: 0,
      })}
    />,
  );
  expect(screen.getByText("This proposal fixes security issues")).toBeTruthy();
  expect(screen.getByText(/fixes 2 security issues/)).toBeTruthy();
});
