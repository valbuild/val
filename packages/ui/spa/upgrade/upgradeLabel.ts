import type { UpgradeCheckState } from "./useUpgradeCheck";

/*
 * What the Studio's Updates notice says (`useUpgrade.tsx`). Here, apart from
 * the hook, so that it is read without the Studio's providers.
 */

/** What the check says there is, in a few words; `null` when nothing. */
export function upgradeLabelOf(check: UpgradeCheckState): string | null {
  if (check.status !== "checked" || check.check.state !== "checked") {
    return null;
  }
  const checked = check.check;
  if (!checked.available) return null;
  const val = checked.latest.val ?? null;
  if (val !== null) return `Val ${val.to} is out`;
  if (checked.cves.vulnerable > 0) return "Security fixes are out";
  return "Updates are out";
}
