/**
 * A site published with `val publish`, then changed in code mode and built
 * the two ways the Studio builds a change in its tab: a quick preview
 * (`buildQuickPreview`) and a Build of the proposal (`runStudioDeploy`, as
 * `buildProposal` calls it). What it reports is the CSS each one would put
 * on the page, for a class the change adds and the live site never had.
 *
 * Everything on the way is the product's: the CLI's publish stores the
 * project's source (`withoutStylesheets` and all), the Studio's publish
 * client reads it back from content, and the real builder -- the module
 * `loadBuilder` hands the Studio -- builds it. The fakes are the edges:
 * content (`fakeContent.ts`, now also answering `GET /v1/project-source`),
 * the live site's stylesheet (`liveStylesheet`, which the Studio fetches from
 * the site), and the route generator a deployment supplies (here the CLI's,
 * run over the files it is given). Native rolldown rather than its
 * WebAssembly build, as every probe in Node builds.
 *
 * A separate process because `@rolldown/browser` is ESM-only and jest runs
 * CommonJS here. The assertions are in studioStyles.test.ts.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import * as builder from "@valbuild/tanstack-build";
import * as node from "@valbuild/tanstack-build/node";
import {
  buildQuickPreview,
  createStudioPublishClient,
  runStudioDeploy,
  type StudioPublishClient,
} from "@valbuild/shared/publish";
import {
  FAKE_BUILD_TARGET,
  startFakeContentService,
  type FakeContentService,
} from "../fakeContent";
import { runPublish } from "../runPublish";
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

builder.useRolldown(node.nativeRolldown);

const TOKEN = "val_pt_styles";
const COMMIT = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";

/** A class the live site has: the hero's background. */
const OLD_CLASS = "bg-white";

/** The checkout `val publish` runs in, with the site's root route as given. */
const projectWith = (root: string): Record<string, string> => ({
  ...styledSiteCode,
  [ROOT_ROUTE_FILE]: root,
  "val.config.ts": `export const config = { project: "acme/site", files: { remote: true } };\n`,
  "val.modules.ts": `export default { modules: [] };\n`,
  "public/robots.txt": "User-agent: *\n",
});

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

function writeDir(files: Record<string, string>, withNodeModules: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-styles-probe-"));
  for (const [key, text] of Object.entries(files)) {
    const file = path.join(root, ...key.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  if (withNodeModules) {
    fs.symlinkSync(
      path.join(__dirname, "..", "..", "..", "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
  }
  return root;
}

/** A deployment's route generator: TanStack's, over the files it is given. */
async function generateRouteTree(files: Record<string, string>) {
  const dir = writeDir(files, false);
  try {
    return await node.generateRouteTree(dir, files);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Content's publish API, reached directly with the project token. */
function studioClient(fake: FakeContentService): StudioPublishClient {
  return createStudioPublishClient({
    publishApi: `${fake.url}/v1`,
    fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${TOKEN}`);
      return fetch(input, { ...init, headers });
    },
  });
}

function stylesOf(
  status: string,
  message: string | null,
  css: string | null,
): Styles {
  return {
    status,
    message,
    hasStylesheet: css !== null && css !== "",
    newClass: css !== null && hasRuleFor(css, NEW_CLASS),
    oldClass: css !== null && hasRuleFor(css, OLD_CLASS),
  };
}

async function buildTheChange(
  fake: FakeContentService,
  client: StudioPublishClient,
  liveCss: string,
): Promise<{ quickPreview: Styles; build: Styles }> {
  const changed = button.replace(
    redBorderButton.old_string,
    redBorderButton.new_string,
  );
  if (changed === button) throw new Error("the edit did not apply");
  const proposalFiles = { [BUTTON_FILE]: changed };

  const preview = await buildQuickPreview({
    name: "red-borders",
    proposals: {
      files: async () => ({
        files: proposalFiles,
        staged: { inputs: "inputs-1" },
      }),
      buildTarget: async () => ({
        target: await client.buildTarget(),
        layer: "site",
      }),
    },
    siteSource: () => client.projectSource(),
    siteTarget: () => client.buildTarget(),
    loadBuilder: async () => builder,
    generateRouteTree,
  });
  const quickPreview =
    preview.status === "built"
      ? stylesOf("built", null, preview.files["app.css"]?.body ?? null)
      : stylesOf(preview.status, preview.message, null);

  // A Build, as `buildProposal` asks for one: no commit, stop once uploaded.
  fake.stored.delete("css");
  const deployed = await runStudioDeploy({
    client,
    commit: null,
    committedFiles: proposalFiles,
    branch: null,
    until: "confirmed",
    liveStylesheet: async () => liveCss,
    loadBuilder: async () => builder,
    generateRouteTree,
    onPhase: () => {},
  });
  const build =
    deployed.status === "failed"
      ? stylesOf("failed", deployed.message, null)
      : stylesOf(
          deployed.status,
          null,
          declaredCss(
            [...fake.declarations.values()].at(-1),
            fake.stored.get("css")?.toString("utf8") ?? null,
            liveCss,
          ),
        );
  return { quickPreview, build };
}

const sha256 = (text: string) =>
  crypto.createHash("sha256").update(text).digest("hex");

/**
 * The stylesheet a declaration named: the bytes uploaded for it now, or --
 * when content held them already and asked for no upload -- the live
 * build's, which is the one stylesheet it held. `null` when it named none.
 */
function declaredCss(
  body: unknown,
  uploaded: string | null,
  liveCss: string,
): string | null {
  if (typeof body !== "object" || body === null) return null;
  const artifacts: unknown = Reflect.get(body, "artifacts");
  if (!Array.isArray(artifacts)) return null;
  const css: unknown = artifacts.find(
    (artifact: unknown) =>
      typeof artifact === "object" &&
      artifact !== null &&
      Reflect.get(artifact, "key") === "css",
  );
  if (typeof css !== "object" || css === null) return null;
  const sha: unknown = Reflect.get(css, "sha256");
  if (uploaded !== null && sha === sha256(uploaded)) return uploaded;
  if (sha === sha256(liveCss)) return liveCss;
  throw new Error("the build declared a stylesheet nobody uploaded");
}

/** The rev inside the uploaded dependency layer. */
function layerRevOf(layer: Buffer | undefined): string | null {
  if (layer === undefined) return null;
  const parsed: unknown = JSON.parse(zlib.gunzipSync(layer).toString("utf8"));
  const rev: unknown =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "rev")
      : null;
  return typeof rev === "string" ? rev : null;
}

async function publish(root: string, fake: FakeContentService) {
  const result = await runPublish({
    root,
    commit: COMMIT,
    branch: "main",
    env: { VAL_PROJECT_TOKEN: TOKEN, VAL_CONTENT_URL: fake.url },
    sleep: () => Promise.resolve(),
    log: () => {},
  });
  return result.status;
}

async function siteReport(rootRoute: string): Promise<SiteReport> {
  const project = projectWith(rootRoute);
  const root = writeDir(project, true);
  try {
    // Once to build the dependency layer, which a build in the tab cannot,
    // and again against a content service that holds it.
    const first = await startFakeContentService({ token: TOKEN });
    await publish(root, first).finally(() => first.close());
    const layerRev = layerRevOf(first.stored.get("layer"));
    const fake = await startFakeContentService({
      token: TOKEN,
      buildTarget: {
        ...FAKE_BUILD_TARGET,
        project: { ...FAKE_BUILD_TARGET.project, rev: layerRev },
      },
    });
    try {
      const published = await publish(root, fake);
      const liveCss = fake.stored.get("css")?.toString("utf8") ?? "";
      const client = studioClient(fake);
      const stored = (await client.projectSource()) ?? {};
      const storedHasStylesheet = Object.keys(stored).some((key) =>
        key.endsWith(".css"),
      );
      const asStored = await buildTheChange(fake, client, liveCss);
      const kept: StudioPublishClient = {
        ...studioClient(fake),
        projectSource: async () => ({
          ...stored,
          [STYLESHEET_FILE]: stylesheet,
        }),
      };
      const withStylesheet = await buildTheChange(fake, kept, liveCss);
      return {
        published,
        live: {
          newClass: hasRuleFor(liveCss, NEW_CLASS),
          oldClass: hasRuleFor(liveCss, OLD_CLASS),
        },
        storedHasStylesheet,
        stored: asStored,
        withStylesheet,
      };
    } finally {
      await fake.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
