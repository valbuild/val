import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import {
  initVal,
  Internal,
  ModuleFilePath,
  SourcePath,
  ValModules,
} from "@valbuild/core";
import { ValOpsFS } from "./ValOpsFS";
import { checkModuleForStudio, fixForStudio } from "./studioValidation";
import { clearRemoteFileAnswers } from "./remoteFileCheck";
import { clearHostAnswers } from "./remoteHostCheck";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
  "base64",
);
const FILE_HASH = Internal.remote.getFileHash(PNG);
const PROJECT = "3f9a2c1";
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const HERO = `${PAGE}?p="hero"` as SourcePath;
const META = { width: 1, height: 1, mimeType: "image/png" };
const textEncoder = new TextEncoder();

/**
 * Step 6 of `docs/plans/studio-validate.md`: a platform ref whose host no
 * longer serves its project. The host is a real HTTP server answering
 * `/_val/project` the way the platform loader does (valbuild/home
 * `platform/packages/loader/src/valProject.ts`).
 */
describe("the Studio's full check of a platform ref's host", () => {
  const { s, c, config } = initVal();
  const schema = s.object({ hero: s.image().remote() });
  let root: string;
  let server: http.Server;
  let host: string;
  /** Which project the test host says it serves; null for no site at all. */
  let servesProject: string | null;
  let asked: string[];

  /** A sound ref to the PNG, on `remoteHost`. */
  const refOn = (remoteHost: string) => {
    const imageSchema = s.image().remote()["executeSerialize"]();
    if (imageSchema.type !== "image") {
      throw new Error("expected an image schema");
    }
    const coreVersion = Internal.VERSION.core ?? "unknown";
    return Internal.remote.createRemoteRef(remoteHost, {
      publicProjectId: PROJECT,
      coreVersion,
      bucket: "r2",
      validationHash: Internal.remote.getValidationHash(
        coreVersion,
        imageSchema,
        "png",
        META,
        FILE_HASH,
        textEncoder,
      ),
      fileHash: FILE_HASH,
      filePath: "public/val/hero.png",
    });
  };

  const setup = (hero: Record<string, unknown>) => {
    const valModules: ValModules = {
      config,
      modules: [
        {
          def: () =>
            Promise.resolve({
              // Typed by the schema when written inline; built per test here.
              default: c.define(PAGE, schema, { hero } as never),
            }),
        },
      ],
    };
    return new ValOpsFS("http://localhost:4000", root, valModules, {
      config,
    });
  };

  const inputOf = async (ops: ValOpsFS) => ({
    moduleFilePath: PAGE,
    schemas: await ops.getSchemas(),
    sources: (await ops.getSources()).sources,
    fileLastUpdatedByPatchId: {},
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      asked.push(`${req.method} ${req.url}`);
      if (req.url === "/_val/project") {
        if (servesProject === null) {
          res.writeHead(404).end("There is no site at this address.");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ publicProjectId: servesProject }));
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(req.method === "HEAD" ? undefined : PNG);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("the test server has no port");
    }
    host = `http://127.0.0.1:${address.port}/_val`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    clearRemoteFileAnswers();
    clearHostAnswers();
    asked = [];
    servesProject = PROJECT;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-host-"));
    fs.mkdirSync(path.dirname(path.join(root, PAGE)), { recursive: true });
    fs.writeFileSync(path.join(root, PAGE), "");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a host that still serves the project is asked once, and the file is then checked", async () => {
    const ops = setup({ path: refOn(host), ...META });
    expect(await checkModuleForStudio(ops, await inputOf(ops))).toEqual({
      status: "ok",
      errors: {},
      remoteHosts: [],
    });
    expect(asked).toEqual([
      "GET /_val/project",
      expect.stringMatching(/^HEAD \/_val\/file\//),
    ]);
  });

  test("a host that now serves another project gets a Fix, and the file is not asked for", async () => {
    servesProject = "aaaaaaa";
    const ops = setup({ path: refOn(host), ...META });
    const res = await checkModuleForStudio(ops, await inputOf(ops));
    expect(res).toEqual({
      status: "ok",
      errors: {
        [HERO]: [
          expect.objectContaining({
            message: expect.stringContaining("now serves another project"),
            fixes: ["remote:rewrite-host"],
          }),
        ],
      },
      remoteHosts: [],
    });
    expect(asked).toEqual(["GET /_val/project"]);
  });

  test("Fix points the ref at the project's own address, and changes nothing else", async () => {
    servesProject = null;
    const ops = setup({ path: refOn(host), ...META, alt: "Hero" });
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops)),
        sourcePath: HERO,
        fix: "remote:rewrite-host",
      }),
    ).toEqual({
      status: "ok",
      patch: [
        {
          op: "replace",
          path: ["hero", "path"],
          value: refOn(`https://${PROJECT}.valstart.dev/_val`),
        },
      ],
      remainingErrors: [],
    });
  });

  test("a host that serves the project again is not fixed", async () => {
    const ops = setup({ path: refOn(host), ...META });
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops)),
        sourcePath: HERO,
        fix: "remote:rewrite-host",
      }),
    ).toEqual({ status: "not-found" });
  });
});
