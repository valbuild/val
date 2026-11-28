/**
 * Every catalogue case that runs at the `build` level
 * (`e2e/proposal/codeModeCases.ts`), built as the Studio builds a change in
 * its tab: the case's site published with `val publish`, then the case's
 * staged files as a quick preview and as a Build (`studioBuild.ts`). What it
 * reports is what the page would be handed: whether each build was made, and
 * whether its code and its CSS carry what the case expects on the page.
 *
 * The staged files are the case's `expect.staged`, which the headless runner
 * (`scenarios/src/codeModeCatalogue.scenario.test.ts`) holds the tools to:
 * running the tools there and building here is the same change.
 *
 * A separate process because `@rolldown/browser` is ESM-only and jest runs
 * CommonJS here. The assertions are in codeModeCatalogue.test.ts.
 */
import {
  casesAt,
  siteOf,
  type CodeModeCase,
} from "../../../../../e2e/proposal/codeModeCases";
import {
  buildChange,
  publishSite,
  type Built,
  type PublishedSite,
} from "./studioBuild";

/** One build of a case, as far as the page goes. */
export type BuiltReport = {
  status: string;
  message: string | null;
  /** Whether it carries a stylesheet of its own. */
  ownCss: boolean;
  /** Each `onPage.css` string: in the stylesheet the page would have. */
  css: Record<string, boolean>;
  /** Each `onPage.text`: in the browser code the page would run. */
  text: Record<string, boolean>;
};

export type CatalogueReport = Record<
  string,
  { quickPreview: BuiltReport; build: BuiltReport }
>;

function reportOf(c: CodeModeCase, built: Built, liveCss: string): BuiltReport {
  // A quick preview without a stylesheet of its own leaves the page the live
  // one (`clientFilesOf`), and so does a Build that shipped it.
  const css = built.css ?? liveCss;
  const onPage = c.expect.onPage ?? {};
  return {
    status: built.status,
    message: built.message,
    ownCss: built.css !== null && built.css !== liveCss,
    css: Object.fromEntries(
      (onPage.css ?? []).map((wanted) => [wanted, css.includes(wanted)]),
    ),
    text: Object.fromEntries(
      (onPage.text ?? []).map((wanted) => [
        wanted,
        built.clientCode.includes(wanted),
      ]),
    ),
  };
}

(async () => {
  const report: CatalogueReport = {};
  const sites = new Map<string, PublishedSite>();
  try {
    for (const c of casesAt("build")) {
      const code = siteOf(c);
      const key = JSON.stringify(code);
      let site = sites.get(key);
      if (site === undefined) {
        site = await publishSite(code);
        sites.set(key, site);
      }
      const built = await buildChange(site, c.expect.staged);
      report[c.id] = {
        quickPreview: reportOf(c, built.quickPreview, site.liveCss),
        build: reportOf(c, built.build, site.liveCss),
      };
    }
  } finally {
    for (const site of sites.values()) await site.close();
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
