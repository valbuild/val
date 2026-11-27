import { runProbe } from "./__fixtures__/runProbe";

/**
 * A stylesheet a module imports and the build was not given.
 *
 * The Studio builds from the source Val stores, which holds no stylesheets,
 * so `import "../styles.css"` reaches nothing and the stylesheet comes out
 * empty. The walk used to skip it without a word, which made "the site's
 * styles are missing" look exactly like "the site has none", and an upgrade
 * published a site unstyled. It is named now (`missingStylesheets` on the
 * build), for the caller to act on.
 */
type Probe = {
  studio: { missing: string[]; code: string };
  whole: string[];
  notCss: string[];
};

let probe: Probe;
beforeAll(() => {
  probe = runProbe<Probe>("cssMissingProbe.ts");
}, 120_000);

test("a stylesheet a module imports that is not in the files is named", () => {
  expect(probe.studio.missing).toEqual(["src/styles.css"]);
  expect(probe.studio.code).toContain(".here");
});

test("a project with every stylesheet it imports misses none", () => {
  expect(probe.whole).toEqual([]);
});

test("a module that is not a stylesheet is not a missing stylesheet", () => {
  expect(probe.notCss).toEqual([]);
});
