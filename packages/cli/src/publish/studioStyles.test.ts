import { execFileSync } from "child_process";
import path from "path";
import type { StudioStylesReport } from "./__fixtures__/studioStylesProbe";

/**
 * A change made in code mode has the styles it asks for: a Tailwind class
 * the change adds, and the live site never had, is styled on the page in a
 * quick preview and after a Build.
 *
 * The site is published with `val publish` and then changed as code mode
 * changes it (report 4: the secondary button gets a red border), and the
 * change is built the two ways the Studio builds one in its tab --
 * `buildQuickPreview`, and `runStudioDeploy` as `buildProposal` calls it --
 * over the source content has from that publish, with the real builder. See
 * the probe beside this file for what is real and what is the edge.
 *
 * Two sites, because they fail differently: one linking its stylesheet with
 * `?url`, as every template does, and one importing it for its effect.
 *
 * KNOWN BUGS, as `test.failing`: `val publish` stores the source without its
 * stylesheets (`withoutStylesheets`), so a build in the tab compiles none,
 * and ships the live site's -- which was compiled before the change, and has
 * no rule for its class -- or, where the stylesheet is imported for its
 * effect, cannot resolve it and fails. A fix makes these pass, and jest then
 * fails them as `failing`: turn each into a `test` then. The controls below
 * show the tab compiling the class whenever it HAS the stylesheet, so the
 * failing tests fail for the bug and not for the probe.
 *
 * A Build made by Val Build rather than the tab, and a quick preview made
 * there, are valbuild/home's, and not seen here.
 *
 * The build runs in a child process because `@rolldown/browser` is ESM-only
 * and jest runs CommonJS here.
 */
let probe: StudioStylesReport;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "studioStylesProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // tsx's WASI warnings can share stdout; take the last line that parses.
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  if (line === undefined) throw new Error(`the probe said nothing:\n${out}`);
  probe = JSON.parse(line);
}, 300_000);

describe.each(["linked", "bareImport"] as const)("a site %s", (site) => {
  const report = () => probe[site];

  describe("the published site", () => {
    test("is live, and its stylesheet has the classes it uses", () => {
      expect(report().published).toBe("live");
      expect(report().live.oldClass).toBe(true);
    });

    test("has no rule for the class the change adds", () => {
      // Otherwise the tests below would pass on the live stylesheet.
      expect(report().live.newClass).toBe(false);
    });

    test("is stored without its stylesheet", () => {
      // The cause of the bugs below, as `withoutStylesheets` has it.
      expect(report().storedHasStylesheet).toBe(false);
    });
  });

  describe("control: built over a source that kept its stylesheet", () => {
    test.each(["quickPreview", "build"] as const)(
      "a %s styles the new class and the old",
      (way) => {
        const styles = report().withStylesheet[way];
        expect(styles.message).toBeNull();
        expect(styles.hasStylesheet).toBe(true);
        expect(styles.newClass).toBe(true);
        expect(styles.oldClass).toBe(true);
      },
    );
  });

  describe("built over the source as `val publish` stores it", () => {
    test.failing.each(["quickPreview", "build"] as const)(
      "a %s styles the new class (KNOWN BUG)",
      (way) => {
        const styles = report().stored[way];
        expect(styles.message).toBeNull();
        expect(styles.newClass).toBe(true);
      },
    );
  });
});

describe("a site linking its stylesheet, as the source is stored", () => {
  /*
   * What has to hold before the bug is fixed and after: the change builds,
   * and a Build never ships the page without the classes it already had --
   * the incident valbuild/val#1112 guards against from the other side.
   */
  test("a quick preview of the change builds", () => {
    expect(probe.linked.stored.quickPreview.message).toBeNull();
    expect(probe.linked.stored.quickPreview.status).toBe("built");
  });

  test("a Build of it keeps the classes the site had", () => {
    expect(probe.linked.stored.build.status).toBe("uploaded");
    expect(probe.linked.stored.build.oldClass).toBe(true);
  });
});
