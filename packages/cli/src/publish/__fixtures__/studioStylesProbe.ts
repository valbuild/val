/**
 * A site published with `val publish`, then changed in code mode and built
 * the two ways the Studio builds a change in its tab: a quick preview
 * (`buildQuickPreview`) and a Build of the proposal (`runStudioDeploy`, as
 * `buildProposal` calls it). What it reports is the CSS each one would put
 * on the page, for a class the change adds and the live site never had.
 *
 * How it is published and built, and what is real on the way, is
 * `studioBuild.ts`, which the catalogue's probe shares.
 *
 * A separate process because `@rolldown/browser` is ESM-only and jest runs
 * CommonJS here. The assertions are in studioStyles.test.ts.
 */
import { buildChange, publishSite, type Built } from "./studioBuild";
import {
  BUTTON_FILE,
  NEW_CLASS,
  ROOT_ROUTE_FILE,
  STYLESHEET_FILE,
  bareImportRootRoute,
  button,
  hasRuleFor,
  redBorderButton,
  rootRoute,
  styledSiteCode,
  stylesheet,
} from "../../../../../e2e/proposal/codeModeSite";

/** A class the live site has: the hero's background. */
const OLD_CLASS = "bg-white";

/** What one way of building the change would put on the page. */
type Styles = {
  /** `failed` with the message, or what was built. */
  status: string;
  message: string | null;
  /** The stylesheet the build carries, or `null` when it carries none. */
  hasStylesheet: boolean;
  /** Whether that stylesheet styles the class the change added. */
  newClass: boolean;
  /** And a class the site already had. */
  oldClass: boolean;
};

/** One site, published and then changed. */
export type SiteReport = {
  published: string;
  live: { newClass: boolean; oldClass: boolean };
  storedHasStylesheet: boolean;
  /** The source as the CLI stores it. */
  stored: { quickPreview: Styles; build: Styles };
  /** Control: the same, over a stored source that kept its stylesheet. */
  withStylesheet: { quickPreview: Styles; build: Styles };
};

export type StudioStylesReport = {
  /** Linking its stylesheet with `?url`, as the templates do. */
  linked: SiteReport;
  /** Importing it for its effect: `import "../styles.css"`. */
  bareImport: SiteReport;
};

function stylesOf(built: Built): Styles {
  return {
    status: built.status,
    message: built.message,
    hasStylesheet: built.css !== null && built.css !== "",
    newClass: built.css !== null && hasRuleFor(built.css, NEW_CLASS),
    oldClass: built.css !== null && hasRuleFor(built.css, OLD_CLASS),
  };
}

async function siteReport(root: string): Promise<SiteReport> {
  const site = await publishSite({
    ...styledSiteCode,
    [ROOT_ROUTE_FILE]: root,
  });
  try {
    const changed = button.replace(
      redBorderButton.old_string,
      redBorderButton.new_string,
    );
    if (changed === button) throw new Error("the edit did not apply");
    const proposal = { [BUTTON_FILE]: changed };
    const both = (built: { quickPreview: Built; build: Built }) => ({
      quickPreview: stylesOf(built.quickPreview),
      build: stylesOf(built.build),
    });
    const asStored = both(await buildChange(site, proposal));
    const withStylesheet = both(
      await buildChange(site, proposal, {
        source: { ...site.stored, [STYLESHEET_FILE]: stylesheet },
      }),
    );
    return {
      published: site.published,
      live: {
        newClass: hasRuleFor(site.liveCss, NEW_CLASS),
        oldClass: hasRuleFor(site.liveCss, OLD_CLASS),
      },
      storedHasStylesheet: Object.keys(site.stored).some((key) =>
        key.endsWith(".css"),
      ),
      stored: asStored,
      withStylesheet,
    };
  } finally {
    await site.close();
  }
}

(async () => {
  const report: StudioStylesReport = {
    linked: await siteReport(rootRoute),
    bareImport: await siteReport(bareImportRootRoute),
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
