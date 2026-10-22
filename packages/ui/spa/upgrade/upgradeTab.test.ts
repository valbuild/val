/** @jest-environment jsdom */
import { HANDOFF_PARAM, storedHandoffIntent } from "../publish/handoff";
import {
  UPGRADE_TAB_PARAM,
  openUpgradeTab,
  startUpgradeInTab,
  upgradeTabOf,
  upgradeTabUrl,
  withoutUpgradeTab,
} from "./upgradeTab";

/*
 * The upgrade tab: where it is (the proposal's address, with a parameter the
 * loader isolates it by), and how a tap starts one -- the tab opened in the
 * tap, and what it is to create written down for it, never put in the URL.
 */
const NAME = "0123456789abcdef0123";
const PROPOSAL = `https://${NAME}--site.valstart.dev`;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
  };
}

/** A storage that takes nothing: private browsing, site data blocked. */
function refusingStorage(): Storage {
  return {
    ...memoryStorage(),
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
}

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

describe("Upgrade, pressed", () => {
  test("opens a tab in the tap, and stores what it is to create for it", () => {
    const storage = memoryStorage();
    const opened: { url: string; target: string }[] = [];
    const started = startUpgradeInTab(
      { path: "majors", skip: ["react"], requestId: "r1" },
      {
        storage,
        open: (url, target) => {
          opened.push({ url, target });
          return {};
        },
      },
    );
    expect(started.status).toBe("opened");
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]?.url ?? "", "https://site.example");
    const id = url.searchParams.get(HANDOFF_PARAM);
    expect(id).not.toBeNull();
    // What to make is in this origin's storage, not in the URL.
    expect(url.search).not.toMatch(/majors|react|r1/);
    expect(storedHandoffIntent(id ?? "", storage)?.intent).toEqual({
      kind: "start-upgrade",
      requestId: "r1",
      path: "majors",
      skip: ["react"],
    });
  });

  test("a tab the browser kept closed is opened again by a tap on Open tab", () => {
    const started = startUpgradeInTab(
      { path: "latest", skip: [], requestId: "r2" },
      { storage: memoryStorage(), open: () => null },
    );
    expect(started.status).toBe("blocked");
    if (started.status === "not-stored") throw new Error("unreachable");
    const reopened: string[] = [];
    expect(
      openUpgradeTab(started.url, started.target, (url) => {
        reopened.push(url);
        return {};
      }),
    ).toBe(true);
    expect(reopened).toEqual([started.url]);
  });

  test("storage that takes nothing opens no tab, which would not know what to do", () => {
    const open = jest.fn(() => ({}));
    expect(
      startUpgradeInTab(
        { path: "cves", skip: [], requestId: "r3" },
        { storage: refusingStorage(), open },
      ),
    ).toEqual({ status: "not-stored" });
    expect(open).not.toHaveBeenCalled();
  });
});
