import { upgradeLabelOf } from "./upgradeLabel";
import type { CheckedUpgrades } from "./upgradesClient";

/*
 * What the Studio's Updates notice says (valbuild/home
 * `docs/plans/upgrades-v2.md`, step 8): the Val release when there is one,
 * then security fixes, then anything else; nothing when there is nothing.
 */
const checked = (over: Partial<CheckedUpgrades> = {}): CheckedUpgrades => ({
  state: "checked",
  checkedAt: "2026-10-26T08:00:00.000Z",
  available: true,
  cves: { vulnerable: 0, severity: null, packages: [] },
  latest: {
    packages: [{ name: "react", from: "19.3.0", to: "19.3.1" }],
    val: null,
  },
  majors: { packages: [] },
  ...over,
});
const at = (check: CheckedUpgrades) =>
  upgradeLabelOf({ status: "checked", check, at: 0 });

test("a new Val is named", () => {
  expect(
    at(
      checked({
        latest: {
          packages: [
            { name: "@valbuild/tanstack", from: "0.149.4", to: "0.150.0" },
          ],
          val: { from: "0.149.4", to: "0.150.0" },
        },
      }),
    ),
  ).toBe("Val 0.150.0 is out");
});

test("security fixes, before other updates", () => {
  expect(
    at(
      checked({
        cves: {
          vulnerable: 2,
          severity: "high",
          packages: [{ name: "a", version: "1.0.0", severity: "high" }],
        },
      }),
    ),
  ).toBe("Security fixes are out");
  expect(at(checked())).toBe("Updates are out");
});

test("nothing to upgrade, or no answer yet, says nothing", () => {
  expect(at(checked({ available: false }))).toBeNull();
  expect(upgradeLabelOf({ status: "checking" })).toBeNull();
  expect(
    upgradeLabelOf({
      status: "checked",
      check: { state: "unavailable", reason: "not-hosted", message: "No." },
      at: 0,
    }),
  ).toBeNull();
});
