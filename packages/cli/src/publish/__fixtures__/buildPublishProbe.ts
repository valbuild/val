/**
 * `val publish` with no artifacts: builds a small file-based TanStack project
 * from its checkout and publishes it to the fake content service, twice --
 * once against a content service that holds no layer for the project, and
 * once against one that holds the layer the first run built.
 *
 * A separate process because `@rolldown/browser` is ESM-only and jest runs
 * CommonJS here (the same reason as @valbuild/tanstack-build's probes). The
 * assertions stay in buildPublish.test.ts -- this only reports.
 *
 * The project is written to a temporary directory whose `node_modules` is
 * this package's, so its one layered dependency resolves the way it would in
 * a checkout after `npm install`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {
  FAKE_BUILD_TARGET,
  startFakeContentService,
  type FakeContentService,
} from "../fakeContent";
import { runPublish, type PublishResult } from "../runPublish";

const TOKEN = "val_pt_probe";
const COMMIT = "1234567890abcdef1234567890abcdef12345678";

const PROJECT: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "probe-site",
    private: true,
    type: "module",
    dependencies: {
      react: "^19.0.0",
      "@tanstack/react-router": "^1.0.0",
      "@tanstack/react-start": "^1.0.0",
      // Not in the base set, so it has to be layered.
      picocolors: "^1.0.0",
    },
  }),
  "src/router.tsx": `import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
export function getRouter() {
  return createRouter({ routeTree });
}
`,
  "src/routes/__root.tsx": `import { Outlet, createRootRoute } from "@tanstack/react-router";
import "../styles.css";
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
  "src/routes/index.tsx": `import { createFileRoute } from "@tanstack/react-router";
import pc from "picocolors";
import logo from "../logo.png";
export const Route = createFileRoute("/")({
  component: () => (
    <h1>
      <img src={logo} alt="" />
      {pc.bold("hello from the checkout")}
    </h1>
  ),
});
`,
  // A route in a folder called "build": the project's, not a build's output.
  "src/routes/build/index.tsx": `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/build/")({
  component: () => <p>the build page</p>,
});
`,
  "src/styles.css": `h1 { color: rebeccapurple; }\n`,
  // A Val project, so the publish wires it -- and wires it at a branch.
  "val.config.ts": `export const config = { project: "acme/site" };\n`,
  "val.modules.ts": `export default { modules: [] };\n`,
  "public/robots.txt": "User-agent: *\n",
};

type Report = {
  result: PublishResult;
  declared: Array<{
    buildHash: string;
    commit: string | null;
    branch: string | null;
    layerRev: string | null;
    linksOwnCss: boolean | null;
    keys: string[];
  }>;
  buildTargetCalls: number;
  /** The rev inside the layer artifact, when one was uploaded. */
  uploadedLayerRev: string | null;
  /** Whether the source artifact holds the project's own route file. */
  sourceHasRoute: boolean;
  /** Whether the source artifact holds a stylesheet -- it must not. */
  sourceHasStylesheet: boolean;
  /** Whether the stylesheet was compiled into the site's CSS all the same. */
  cssHasRule: boolean;
  /** Whether the client build carries the page's text. */
  clientHasPage: boolean;
  /** Whether the imported image reached the build, inlined. */
  clientHasLogo: boolean;
  /** Whether the route in `src/routes/build/` was built and stored. */
  buildRouteBuilt: boolean;
  /** Whether the checkout was left exactly as it was found. */
  checkoutUntouched: boolean;
  /** The branch the stored `val.server.ts` is wired at. */
  wiredBranch: string | null;
  /** Whether the run warned that the checkout's branch is not the project's. */
  warnedAboutBranch: boolean;
};

/** A 1x1 PNG: small enough to inline, so the page carries it as a data URI. */
const LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

function writeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-publish-probe-"));
  for (const [key, text] of Object.entries(PROJECT)) {
    const file = path.join(root, ...key.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  fs.writeFileSync(path.join(root, "src", "logo.png"), LOGO);
  fs.symlinkSync(
    path.join(__dirname, "..", "..", "..", "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  return root;
}

function listed(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

async function publishOnce(
  root: string,
  fake: FakeContentService,
  branch = "main",
): Promise<Report> {
  const before = listed(root);
  const logged: string[] = [];
  const result = await runPublish({
    root,
    commit: COMMIT,
    branch,
    env: { VAL_PROJECT_TOKEN: TOKEN, VAL_CONTENT_URL: fake.url },
    sleep: () => Promise.resolve(),
    log: (line: string) => {
      logged.push(line);
    },
  });
  const declared = [...fake.declarations.values()].map((body) => {
    const d = body as {
      buildHash: string;
      commit: string | null;
      branch: string | null;
      layerRev: string | null;
      linksOwnCss: boolean | null;
      artifacts: Array<{ key: string }>;
    };
    return {
      buildHash: d.buildHash,
      commit: d.commit,
      branch: d.branch,
      layerRev: d.layerRev,
      linksOwnCss: d.linksOwnCss,
      keys: d.artifacts.map((a) => a.key).sort(),
    };
  });
  const layer = fake.stored.get("layer");
  const source = fake.stored.get("source");
  // The route is split off, so its text is in a client chunk.
  const clientText = [...fake.stored.entries()]
    .filter(([key]) => key === "client" || key.startsWith("chunk/client/"))
    .map(([, body]) => body.toString("utf8"))
    .join("\n");
  return {
    result,
    declared,
    buildTargetCalls: fake.calls.filter((c) => c.path === "/v1/build-target")
      .length,
    uploadedLayerRev: layer
      ? (JSON.parse(zlib.gunzipSync(layer).toString("utf8")) as { rev: string })
          .rev
      : null,
    sourceHasRoute: source
      ? "src/routes/index.tsx" in
        (JSON.parse(source.toString("utf8")) as Record<string, string>)
      : false,
    sourceHasStylesheet: source
      ? Object.keys(
          JSON.parse(source.toString("utf8")) as Record<string, string>,
        ).some((key) => key.endsWith(".css"))
      : false,
    cssHasRule: (fake.stored.get("css")?.toString("utf8") ?? "").includes(
      "rebeccapurple",
    ),
    clientHasPage: clientText.includes("hello from the checkout"),
    clientHasLogo: clientText.includes(
      `data:image/png;base64,${LOGO.toString("base64")}`,
    ),
    buildRouteBuilt:
      clientText.includes("the build page") &&
      (source
        ? "src/routes/build/index.tsx" in
          (JSON.parse(source.toString("utf8")) as Record<string, string>)
        : false),
    checkoutUntouched: JSON.stringify(listed(root)) === JSON.stringify(before),
    wiredBranch: source ? wiredBranchOf(source) : null,
    warnedAboutBranch: logged.some(
      (line) => line.startsWith("warn:") && line.includes("publishes"),
    ),
  };
}

/** The branch the stored `val.server.ts` was wired at: its `BUILT_FROM`. */
function wiredBranchOf(source: Buffer): string | null {
  const files = JSON.parse(source.toString("utf8")) as Record<string, string>;
  const server = Object.entries(files).find(([key]) =>
    key.endsWith("val.server.ts"),
  )?.[1];
  const match = server ? /^const BUILT_FROM = (.+);$/m.exec(server) : null;
  if (!match?.[1] || match[1] === "null") return null;
  const parsed = JSON.parse(match[1]) as { branch?: unknown };
  return typeof parsed.branch === "string" ? parsed.branch : null;
}

(async () => {
  const root = writeProject();
  try {
    const first = await startFakeContentService({ token: TOKEN });
    const fresh = await publishOnce(root, first).finally(() => first.close());

    // Content now holds the layer the first run sent, so the second names it.
    const second = await startFakeContentService({
      token: TOKEN,
      buildTarget: {
        ...FAKE_BUILD_TARGET,
        project: {
          ...FAKE_BUILD_TARGET.project,
          rev: fresh.uploadedLayerRev,
        },
      },
    });
    const held = await publishOnce(root, second).finally(() => second.close());

    // From a checkout on a feature branch, of a project content says is on main.
    const third = await startFakeContentService({
      token: TOKEN,
      buildTarget: { ...FAKE_BUILD_TARGET, branch: "main" },
    });
    const elsewhere = await publishOnce(root, third, "feature/x").finally(() =>
      third.close(),
    );

    process.stdout.write(`${JSON.stringify({ fresh, held, elsewhere })}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
