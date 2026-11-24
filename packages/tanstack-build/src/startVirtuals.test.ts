import { execFileSync } from "child_process";
import path from "path";

/**
 * A project with nothing wrong publishes with no warnings.
 *
 * Every publish of a TanStack Start site printed this, twice, while building
 * the dependency layer:
 *
 *     .../@tanstack/start-server-core/dist/esm/router-manifest.js (14:43)
 *     [UNRESOLVED_IMPORT] Could not resolve 'tanstack-start-manifest:v' ...
 *     Module not found, treating it as an external dependency
 *
 * It is a virtual module Start's own app build provides, so external is right
 * -- and is now said, rather than arrived at after a diagnostic. An import that
 * really cannot be resolved is still reported. See the probe beside this file.
 */
type Layer = {
  modules: Record<string, string>;
  skipped: Array<{ specifier: string; reason: string }>;
  workerCode: string;
  printed: string;
};
let probe: { manifest: Layer; ghost: Layer };

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "startVirtualsProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as typeof probe;
}, 300_000);

test("Start's manifest is left external without a warning", () => {
  expect(probe.manifest.modules).toEqual({ "manifest-dep": "manifest-dep" });
  expect(probe.manifest.skipped).toEqual([]);
  expect(probe.manifest.workerCode).toContain("tanstack-start-manifest:v");
  expect(probe.manifest.printed).not.toContain("UNRESOLVED_IMPORT");
  expect(probe.manifest.printed).not.toContain("tanstack-start-manifest:v");
});

test("an import that cannot be resolved is still reported", () => {
  expect(probe.ghost.printed).toContain("UNRESOLVED_IMPORT");
  expect(probe.ghost.printed).toContain("not-installed-anywhere");
});
