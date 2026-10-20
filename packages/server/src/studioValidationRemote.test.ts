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

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
  "base64",
);
const FILE_HASH = Internal.remote.getFileHash(PNG);
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const HERO = `${PAGE}?p="hero"` as SourcePath;
const textEncoder = new TextEncoder();

/**
 * The remote half of the Studio's full check, against a real `ValOpsFS` and a
 * real HTTP server standing in for the remote host: `checkModuleForStudio`
 * asks the host, and `fixForStudio` downloads from it.
 */
describe("the Studio's full check of remote files", () => {
  const { s, c, config } = initVal();
  const schema = s.object({ hero: s.image().remote() });
  let root: string;
  let server: http.Server;
  let host: string;
  let served: string[];
  let serves: (url: string) => boolean;

  /** A ref to the PNG on the test host that agrees with `metadata`. */
  const refWith = (metadata: Record<string, unknown>) => {
    const imageSchema = s.image().remote()["executeSerialize"]();
    if (imageSchema.type !== "image") {
      throw new Error("expected an image schema");
    }
    const coreVersion = Internal.VERSION.core ?? "unknown";
    return Internal.remote.createRemoteRef(host, {
      publicProjectId: "proj",
      coreVersion,
      bucket: "01",
      validationHash: Internal.remote.getValidationHash(
        coreVersion,
        imageSchema,
        "png",
        metadata,
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
      served.push(`${req.method} ${req.url}`);
      if (!serves(req.url ?? "")) {
        res.writeHead(404).end();
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
    host = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    clearRemoteFileAnswers();
    served = [];
    serves = () => true;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-remote-"));
    fs.mkdirSync(path.dirname(path.join(root, PAGE)), { recursive: true });
    fs.writeFileSync(path.join(root, PAGE), "");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const META = { width: 1, height: 1, mimeType: "image/png" };

  test("a sound ref its host serves is not an error, and costs one HEAD", async () => {
    const ops = setup({ path: refWith(META), ...META });
    expect(await checkModuleForStudio(ops, await inputOf(ops))).toEqual({
      status: "ok",
      errors: {},
      remoteHosts: [],
    });
    expect(served).toEqual([expect.stringMatching(/^HEAD /)]);
  });

  test("a file the host does not have is an error at the image", async () => {
    serves = () => false;
    const ops = setup({ path: refWith(META), ...META });
    const res = await checkModuleForStudio(ops, await inputOf(ops));
    expect(res).toEqual({
      status: "ok",
      errors: {
        [HERO]: [
          expect.objectContaining({ message: expect.stringContaining("404") }),
        ],
      },
      remoteHosts: [],
    });
  });

  test("a host that is down is reported as the host", async () => {
    const ops = setup({
      // Nothing listens on port 9 (discard) on a test machine.
      path: refWith(META).replace(host, "http://127.0.0.1:9"),
      ...META,
    });
    const res = await checkModuleForStudio(ops, await inputOf(ops));
    expect(res).toEqual({
      status: "ok",
      errors: {},
      remoteHosts: [
        {
          host: "http://127.0.0.1:9",
          status: "unreachable",
          details: expect.any(String),
          sourcePaths: [HERO],
        },
      ],
    });
  });

  test("a stale ref is fixed by re-reading the file, on the host it was on", async () => {
    // Recorded as 2×2: the ref was made for 1×1, so the two disagree.
    const stale = { path: refWith(META), ...META, width: 2, height: 2 };
    const ops = setup(stale);
    const input = await inputOf(ops);

    const check = await checkModuleForStudio(ops, input);
    expect(check.status === "ok" && check.errors[HERO]?.[0]?.fixes).toEqual([
      "image:check-remote",
    ]);
    // Staleness is decided without the network.
    expect(served).toEqual([]);

    const res = await fixForStudio(ops, {
      ...input,
      sourcePath: HERO,
      fix: "image:check-remote",
    });
    expect(res).toEqual({
      status: "ok",
      patch: [
        {
          op: "replace",
          path: ["hero"],
          value: expect.objectContaining({
            path: refWith(META),
            width: 1,
            height: 1,
          }),
        },
      ],
      remainingErrors: [],
    });
    expect(served).toEqual([expect.stringMatching(/^GET /)]);
  });

  test("a ref that is not stale is not rewritten", async () => {
    const ops = setup({ path: refWith(META), ...META });
    expect(
      await fixForStudio(ops, {
        ...(await inputOf(ops)),
        sourcePath: HERO,
        fix: "image:check-remote",
      }),
    ).toEqual({ status: "not-found" });
  });
});
