import { execFileSync } from "child_process";
import path from "path";
import type { Outcome } from "./__fixtures__/vendorLayerFactsProbe";

/**
 * The two checks a layer build OUTSIDE the platform's checkout runs on what
 * the platform says (`BuildTarget.base.pins` and `.exports`), rather than on a
 * node_modules and a built base layer it does not have.
 *
 * That is every project publishing from its own CI with `val publish`, and it
 * is where PINS.md's "a skew is now either impossible or a failed publish"
 * stopped being true: the CLI passed `resolvePlatformModule: () => null` and
 * `baseLayerDir: null`, so a lockfile two patches away from the platform's
 * TanStack layered as if nothing were wrong. See the probe for the project.
 */
type Probe = Record<
  | "skewed"
  | "skewedBesideABrokenDependency"
  | "agreeing"
  | "noPins"
  | "missingExport"
  | "presentExport"
  | "chunkNotListed",
  Outcome
>;

let probe: Probe;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "vendorLayerFactsProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as Probe;
}, 300_000);

const built = (modules: Record<string, string>) =>
  expect.objectContaining({ built: true, modules });

describe("pins", () => {
  test("a pinned package bundled at another version is refused, naming both and the base", () => {
    expect(probe.skewed).toEqual({
      built: false,
      pinSkew: [
        {
          name: "@tanstack/start-server-core",
          pinned: "1.169.39",
          found: "1.169.37",
        },
      ],
      message: expect.stringContaining("base-rev-1"),
    });
  });

  test("is not absorbed into `skipped`, as an ordinary build failure is", () => {
    // `broken` fails the first build, which sends the layer down the
    // per-dependency path; dropping dep-a there would report the skew as an
    // unavailable import.
    expect(probe.skewedBesideABrokenDependency).toEqual(
      expect.objectContaining({ built: false, pinSkew: expect.any(Array) }),
    );
  });

  test("a pinned package at the pinned version builds", () => {
    expect(probe.agreeing).toEqual({
      built: true,
      modules: { "dep-a": "dep-a" },
      skipped: [],
    });
  });

  test("a platform that sends no pins is not checked", () => {
    expect(probe.noPins).toEqual(built({ "dep-a": "dep-a" }));
  });
});

describe("the export audit, from what the platform says", () => {
  test("a name the base chunk does not export drops the dependency, naming the name", () => {
    expect(probe.missingExport).toEqual({
      built: true,
      modules: {},
      skipped: [
        { specifier: "dep-a", reason: expect.stringContaining("'useRouter'") },
      ],
    });
  });

  test("a name the base chunk does export builds", () => {
    expect(probe.presentExport).toEqual(built({ "dep-a": "dep-a" }));
  });

  test("a chunk the platform says nothing about is not checked", () => {
    expect(probe.chunkNotListed).toEqual(built({ "dep-a": "dep-a" }));
  });
});
