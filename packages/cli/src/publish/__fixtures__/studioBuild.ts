/**
 * A site published with `val publish`, and a change built the two ways the
 * Studio builds one in its tab: a quick preview (`buildQuickPreview`) and a
 * Build of the proposal (`runStudioDeploy`, as `buildProposal` calls it).
 *
 * Everything on the way is the product's: the CLI's publish stores the
 * project's source, the Studio's publish client reads it back from content,
 * and the real builder -- the module `loadBuilder` hands the Studio --
 * builds it. The fakes are the edges: content (`fakeContent.ts`), the live
 * site's stylesheet (`liveStylesheet`, which the Studio fetches from the
 * site), and the route generator a deployment supplies (the CLI's, run over
 * the files it is given). Native rolldown rather than its WebAssembly build,
 * as every probe in Node builds.
 *
 * For probes only: `@rolldown/browser` is ESM-only and jest runs CommonJS,
 * so this runs in a child process (`tsx`).
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

builder.useRolldown(node.nativeRolldown);

const TOKEN = "val_pt_studio_build";
const COMMIT = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";

/** What `val publish` needs of a checkout beyond the site's own code. */
const VAL_FILES: Record<string, string> = {
  "val.config.ts": `export const config = { project: "acme/site", files: { remote: true } };\n`,
  "val.modules.ts": `export default { modules: [] };\n`,
  "public/robots.txt": "User-agent: *\n",
};

/** What one way of building a change would hand the page. */
export type Built = {
  /** `built` / `uploaded`, or `failed` with `message`. */
  status: string;
  message: string | null;
  /** The stylesheet it carries, or `null` when it carries none of its own. */
  css: string | null;
  /** Its browser code, every chunk, as one text. */
  clientCode: string;
};

export type PublishedSite = {
  /** What `val publish` reported. */
  published: string;
  /** The live build's stylesheet. */
  liveCss: string;
  /** The source content holds for the site, as the Studio reads it. */
  stored: Record<string, string>;
  fake: FakeContentService;
  client: StudioPublishClient;
  close: () => Promise<void>;
};

function writeDir(files: Record<string, string>, withNodeModules: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-build-"));
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
export function studioClient(fake: FakeContentService): StudioPublishClient {
  return createStudioPublishClient({
    publishApi: `${fake.url}/v1`,
    fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${TOKEN}`);
      return fetch(input, { ...init, headers });
    },
  });
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

/**
 * The site's code, published with `val publish` to a fake content service
 * that holds its dependency layer -- which a build in the tab cannot make, so
 * the first publish is to another service, to build one.
 */
export async function publishSite(
  code: Record<string, string>,
): Promise<PublishedSite> {
  const root = writeDir({ ...code, ...VAL_FILES }, true);
  try {
    const first = await startFakeContentService({ token: TOKEN });
    await publish(root, first).finally(() => first.close());
    const fake = await startFakeContentService({
      token: TOKEN,
      buildTarget: {
        ...FAKE_BUILD_TARGET,
        project: {
          ...FAKE_BUILD_TARGET.project,
          rev: layerRevOf(first.stored.get("layer")),
        },
      },
    });
    const published = await publish(root, fake);
    const client = studioClient(fake);
    return {
      published,
      liveCss: fake.stored.get("css")?.toString("utf8") ?? "",
      stored: (await client.projectSource()) ?? {},
      fake,
      client,
      close: () => fake.close(),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

let previews = 0;

/**
 * The change -- the proposal's files over the site's, `null` for a file it
 * deleted -- built as a quick preview and as a Build, over the source content
 * holds (or `source`, where a probe asks what another one would do).
 */
export async function buildChange(
  site: PublishedSite,
  proposalFiles: Record<string, string | null>,
  options: { source?: Record<string, string> } = {},
): Promise<{ quickPreview: Built; build: Built }> {
  const client: StudioPublishClient =
    options.source === undefined
      ? site.client
      : {
          ...studioClient(site.fake),
          projectSource: async () => options.source ?? null,
        };
  previews++;
  const preview = await buildQuickPreview({
    name: `change-${previews}`,
    proposals: {
      files: async () => ({
        files: proposalFiles,
        staged: { inputs: `inputs-${previews}` },
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
  const quickPreview: Built =
    preview.status === "built"
      ? {
          status: "built",
          message: null,
          css: preview.files["app.css"]?.body ?? null,
          clientCode: Object.entries(preview.files)
            .filter(([name]) => name.endsWith(".js"))
            .map(([, file]) => file.body)
            .join("\n"),
        }
      : {
          status: preview.status,
          message: preview.message,
          css: null,
          clientCode: "",
        };

  // A Build, as `buildProposal` asks for one: no commit, stop once uploaded.
  for (const key of [...site.fake.stored.keys()]) {
    if (key === "css" || key === "client" || key.startsWith("chunk/client/")) {
      site.fake.stored.delete(key);
    }
  }
  const deployed = await runStudioDeploy({
    client,
    commit: null,
    committedFiles: proposalFiles,
    branch: null,
    until: "confirmed",
    liveStylesheet: async () => site.liveCss,
    loadBuilder: async () => builder,
    generateRouteTree,
    onPhase: () => {},
  });
  const build: Built =
    deployed.status === "failed"
      ? {
          status: "failed",
          message: deployed.message,
          css: null,
          clientCode: "",
        }
      : {
          status: deployed.status,
          message: null,
          css: declaredCss(
            [...site.fake.declarations.values()].at(-1),
            site.fake.stored.get("css")?.toString("utf8") ?? null,
            site.liveCss,
          ),
          clientCode: [...site.fake.stored.entries()]
            .filter(
              ([key]) => key === "client" || key.startsWith("chunk/client/"),
            )
            .map(([, body]) => body.toString("utf8"))
            .join("\n"),
        };
  return { quickPreview, build };
}
