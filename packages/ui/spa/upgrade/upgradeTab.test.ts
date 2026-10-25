import {
  UPGRADE_TAB_PARAM,
  openUpgradeTab,
  upgradeTabOf,
  upgradeTabUrl,
  withoutUpgradeTab,
} from "./upgradeTab";

/*
 * The upgrade tab: where it is (the proposal's address, with a parameter the
 * loader isolates it by), and Open upgrade, which opens it from a tap.
 */
const NAME = "0123456789abcdef0123";
const PROPOSAL = `https://${NAME}--site.valstart.dev`;

describe("the upgrade tab's address", () => {
  test("is the Studio at the proposal's address, naming the proposal", () => {
    const url = new URL(upgradeTabUrl(PROPOSAL, NAME));
    expect(url.origin).toBe(PROPOSAL);
    expect(url.pathname).toBe("/val");
    expect(url.searchParams.get(UPGRADE_TAB_PARAM)).toBe(NAME);
    expect(upgradeTabOf(url.href)).toBe(NAME);
  });

  test("anything else is not one", () => {
    expect(upgradeTabOf(`${PROPOSAL}/val`)).toBeNull();
    expect(upgradeTabOf(`${PROPOSAL}/val?${UPGRADE_TAB_PARAM}=`)).toBeNull();
  });

  test("Review leaves it for the Studio at the same address, and keeps the rest", () => {
    const studio = withoutUpgradeTab(
      `${PROPOSAL}/val/~/src/a.val.ts?${UPGRADE_TAB_PARAM}=${NAME}&p=1`,
    );
    expect(studio).toBe(`${PROPOSAL}/val/~/src/a.val.ts?p=1`);
    expect(upgradeTabOf(studio)).toBeNull();
  });
});

describe("Open upgrade", () => {
  test("opens the upgrade's page in a tab of its own, and says when the browser kept it closed", () => {
    const opened: { url: string; target: string }[] = [];
    const url = upgradeTabUrl(PROPOSAL, NAME);
    expect(
      openUpgradeTab(url, `val-upgrade-${NAME}`, (url, target) => {
        opened.push({ url, target });
        return {};
      }),
    ).toBe(true);
    expect(opened).toEqual([{ url, target: `val-upgrade-${NAME}` }]);
    expect(openUpgradeTab(url, "t", () => null)).toBe(false);
  });
});
