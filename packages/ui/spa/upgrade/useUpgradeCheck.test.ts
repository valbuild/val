import {
  UPGRADE_CHECK_MAX_AGE_MS,
  askUpgradeCheck,
  checkIsDue,
  resetUpgradeCheck,
  type UpgradeCheckState,
} from "./useUpgradeCheck";
import type { UpgradeCheck, UpgradesClient } from "./upgradesClient";

const CHECKED: UpgradeCheck = {
  state: "checked",
  checkedAt: "2026-10-21T10:00:00.000Z",
  available: false,
  cves: { vulnerable: 0, severity: null, packages: [] },
  latest: { packages: [] },
  majors: { packages: [] },
};

describe("whether there is anything to upgrade", () => {
  afterEach(resetUpgradeCheck);

  test("is asked when never asked, and again only once the answer is hours old", () => {
    expect(checkIsDue({ status: "idle" }, 0)).toBe(true);
    const at = 1_000;
    const checked: UpgradeCheckState = {
      status: "checked",
      check: CHECKED,
      at,
    };
    expect(checkIsDue(checked, at + 60_000)).toBe(false);
    expect(checkIsDue(checked, at + UPGRADE_CHECK_MAX_AGE_MS + 1)).toBe(true);
    // A failure is asked again by a person, with Try again.
    expect(checkIsDue({ status: "failed", message: "x" }, at)).toBe(false);
  });

  test("two asking at once are one request", async () => {
    let asked = 0;
    const client: UpgradesClient = {
      check: async () => {
        asked++;
        return CHECKED;
      },
      dependencyFiles: async () => ({}),
    };
    await Promise.all([askUpgradeCheck(client), askUpgradeCheck(client)]);
    expect(asked).toBe(1);
  });
});
