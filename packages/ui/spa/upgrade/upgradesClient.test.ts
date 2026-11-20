import { createUpgradesClient } from "./upgradesClient";

/*
 * Content's answers to the Upgrade (valbuild/home `docs/adept.md`, step 7),
 * through this origin's publish proxy.
 */
function fakeFetch(body: unknown, status = 200) {
  const sent: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify(body), { status });
  };
  return { sent, fetchImpl };
}

describe("the upgrades client", () => {
  test("asks whether there is anything to upgrade, and reads a severity it does not know as none", async () => {
    const { sent, fetchImpl } = fakeFetch({
      state: "checked",
      checkedAt: "2026-10-21T10:00:00.000Z",
      available: true,
      cves: {
        vulnerable: 1,
        severity: "apocalyptic",
        packages: [{ name: "a", version: "1.0.0", severity: "apocalyptic" }],
      },
      latest: { packages: [] },
      majors: { packages: [{ name: "react", from: "18.3.1", to: "19.2.0" }] },
    });
    const check = await createUpgradesClient({
      api: "/api/val/",
      fetchImpl,
    }).check();
    expect(sent).toEqual(["GET /api/val/publish-api/upgrades"]);
    expect(check.state === "checked" && check.cves.severity).toBeNull();
    expect(check.state === "checked" && check.majors.packages).toEqual([
      { name: "react", from: "18.3.1", to: "19.2.0" },
    ]);
  });

  test("a site whose check cannot be made says why", async () => {
    const { fetchImpl } = fakeFetch({
      state: "unavailable",
      reason: "no-lockfile",
      message: "This site has no lockfile on record yet.",
    });
    expect(
      await createUpgradesClient({ api: "/api/val", fetchImpl }).check(),
    ).toEqual({
      state: "unavailable",
      reason: "no-lockfile",
      message: "This site has no lockfile on record yet.",
    });
  });

  test("reads the site's lockfile", async () => {
    const { sent, fetchImpl } = fakeFetch({
      files: { "pnpm-lock.yaml": "lock" },
    });
    expect(
      await createUpgradesClient({
        api: "/api/val",
        fetchImpl,
      }).dependencyFiles(),
    ).toEqual({ "pnpm-lock.yaml": "lock" });
    expect(sent).toEqual(["GET /api/val/publish-api/dependency-files"]);
  });
});
