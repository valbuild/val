import { execFileSync } from "child_process";
import path from "path";

/**
 * A split route's deferred half gets the env-marker transform too.
 *
 * Splitting is allowed to cost bytes and is NOT allowed to change behaviour —
 * that is the stated reason a browser build, which has no Babel to run the
 * splitter with, may simply skip it. This is the one place that rule was
 * broken: the deferred half is built by `load` from the route's ORIGINAL
 * source and given an id of its own, and `transform` bailed on any id that is
 * not in `files`. The markers live in a component, and the component is
 * exactly what the splitter moves into that half — so `<ClientOnly>` in a
 * route was rewritten when nobody supplied a splitter and left alone when
 * somebody did.
 *
 * Nothing caught it, and the reason is worth keeping: the fixtures that
 * exercise splitting have no markers in them, and the fixtures that exercise
 * markers are not split. Neither repository had one that was both.
 *
 * The build runs in a child process because `@rolldown/browser` is ESM-only
 * and jest runs CommonJS here — `require(esm)` wants Node 24.9+. See the probe
 * beside this file; it only reports, so the assertions stay here.
 */

type Probe = {
  child: string;
  unsplitKeepsChild: boolean;
  splitKeepsChild: boolean;
  splitChunks: number;
};

let probe: Probe;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "splitEnvMarkersProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // tsx's WASI warnings share stdout's stream in some shells; take the last
  // line that parses rather than assuming the output is only JSON.
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as Probe;
}, 300_000);

describe("a split route's deferred half", () => {
  test("the stub really did defer the component", () => {
    // Without this the comparison below could pass by being one unsplit build
    // against another, which is how a test of splitting quietly stops testing
    // splitting.
    expect(probe.splitChunks).toBeGreaterThan(0);
  });

  test("an unsplit build drops the ClientOnly child on the server", () => {
    // The transform's observable effect, established on the path that always
    // worked — so the assertion below says "these two agree" rather than
    // restating what the transform emits.
    expect(probe.unsplitKeepsChild).toBe(false);
  });

  test("and so does a split one", () => {
    // `true` here is the regression: the marker reached the deferred half
    // untransformed, so the server kept a child it must not render. Verified
    // by removing the fix and watching exactly this flip.
    expect(probe.splitKeepsChild).toBe(false);
  });
});
