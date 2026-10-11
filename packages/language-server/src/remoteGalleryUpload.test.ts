import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { Internal, type SourcePath } from "@valbuild/core";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  VAL_UPLOAD_REMOTE_COMMAND,
  type RemoteFixCommandArgs,
} from "./commands";
import {
  startLspSession,
  type LspSession,
  type LspTextEdit,
} from "./__testHelpers__/lspClient";

/**
 * Uploading an entry of an `s.imageset().remote()` from the editor renames the
 * entry's key to its ref — and has to rename it everywhere it is named, in the
 * same edit, or the page's image field and the image in its rich text name an
 * image the gallery no longer has.
 *
 * Driven through the real server: the command, the fix handler, the patches and
 * the WorkspaceEdit, against a stand-in content host.
 */

// An 8x8 solid-colour PNG, so the metadata extractor has real bytes to read.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD//" +
    "/+l2Z/dAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB9oIBRELLnJqTAAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==",
  "base64",
);
const LOGO = "/public/val/images/logo_abcde.png";

const PROJECT: Record<string, string | Buffer> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "node",
      esModuleInterop: true,
      skipLibCheck: true,
    },
  }),
  "val.config.ts": `import { initVal } from "@valbuild/core";
const { s, c, config } = initVal({ project: "test/project" });
export { s, c, config };
`,
  "val.modules.ts": `import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/images.val") },
  { def: () => import("./content/page.val") },
  { def: () => import("./content/cards.val") },
]);
`,
  "content/images.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/images.val.ts",
  s.imageset({ dir: "/public/val/images" }).remote(),
  {
    "${LOGO}": { width: 8, height: 8, mimeType: "image/png", alt: "Logo" },
  },
);
`,
  "content/page.val.ts": `import { c, s } from "../val.config";
import imagesVal from "./images.val";

export default c.define(
  "/content/page.val.ts",
  s.object({
    hero: s.image(imagesVal),
    body: s.richtext({ img: s.image(imagesVal) }),
  }),
  {
    hero: { path: "${LOGO}", alt: "Kept" },
    body: [{ tag: "p", children: [{ tag: "img", src: { path: "${LOGO}" } }] }],
  },
);
`,
  // A `.jsonValues()` record: each entry's value is in its own `*.val.json`,
  // not in the `.val.ts`, so the edit has to land there.
  "content/cards.val.ts": `import { c, s } from "../val.config";
import imagesVal from "./images.val";

export default c.define(
  "/content/cards.val.ts",
  s.record(s.object({ image: s.image(imagesVal) })).jsonValues(),
  {
    "/a": c.json(() => import("./cards/a.val.json")),
    "/b": c.json(() => import("./cards/b.val.json")),
  },
);
`,
  "content/cards/a.val.json":
    JSON.stringify({ image: { path: LOGO } }, null, 2) + "\n",
  "content/cards/b.val.json":
    JSON.stringify({ image: { path: LOGO, alt: "B" } }, null, 2) + "\n",
  [LOGO.slice(1)]: PNG,
  ".val/pat.json": JSON.stringify({ pat: "test-pat" }),
};

type ApplyWorkspaceEditParams = {
  label?: string;
  edit: { changes?: Record<string, LspTextEdit[]> };
};

describe("uploading a remote gallery's entry from the editor", () => {
  jest.setTimeout(90000);

  let valRoot: string;
  let contentHost: http.Server;
  let session: LspSession | undefined;
  const uploads: string[] = [];
  let env: Record<string, string> = {};

  beforeEach(async () => {
    // Inside the repository, so the project resolves `@valbuild/core`.
    const tmpBase = path.join(__dirname, ".tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    valRoot = fs.mkdtempSync(path.join(tmpBase, "remote-gallery-"));
    for (const [file, content] of Object.entries(PROJECT)) {
      fs.mkdirSync(path.dirname(path.join(valRoot, file)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(valRoot, file), content);
    }
    uploads.length = 0;
    contentHost = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/test/project/settings") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            publicProjectId: "pubproj",
            remoteFileBuckets: [{ bucket: "01" }],
          }),
        );
        return;
      }
      if (req.method === "PUT" && req.url?.startsWith("/v1/test/project/")) {
        uploads.push(req.url);
        req.resume();
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      contentHost.listen(0, "127.0.0.1", resolve),
    );
    const { port } = contentHost.address() as AddressInfo;
    env = {
      // Where the bytes and the project's settings go.
      VAL_CONTENT_URL: `http://127.0.0.1:${port}`,
      // The host the refs name: nothing is fetched from it here.
      VAL_REMOTE_HOST: "https://remote.val.build",
    };
  });

  afterEach(async () => {
    await session?.dispose();
    session = undefined;
    // The server process's fetch keeps its connections alive, and `close`
    // waits for every one of them.
    contentHost.closeAllConnections();
    await new Promise((resolve) => contentHost.close(resolve));
    fs.rmSync(valRoot, { recursive: true, force: true });
  });

  test("rewrites the gallery's key, the page's field and its rich text image in one edit", async () => {
    session = await startLspSession({ valRoot, env });
    const edits: ApplyWorkspaceEditParams[] = [];
    const messages: string[] = [];
    session.client.onRequest(
      "workspace/applyEdit",
      (params: ApplyWorkspaceEditParams) => {
        edits.push(params);
        return { applied: true };
      },
    );
    // `showErrorMessage` and friends are requests, not notifications.
    session.client.onRequest(
      "window/showMessageRequest",
      (params: { message: string }) => {
        messages.push(params.message);
        return null;
      },
    );

    const galleryFile = path.join(valRoot, "content/images.val.ts");
    const pageFile = path.join(valRoot, "content/page.val.ts");
    const galleryUri = `file://${galleryFile}`;
    const pageUri = `file://${pageFile}`;
    const entryFiles = [
      "content/cards/a.val.json",
      "content/cards/b.val.json",
    ].map((file) => path.join(valRoot, file));
    const entryUris = entryFiles.map((file) => `file://${file}`);
    const galleryText = fs.readFileSync(galleryFile, "utf-8");
    session.openDocument(galleryUri, galleryText);

    const sourcePath = Internal.createValPathOfItem(
      "/content/images.val.ts" as SourcePath,
      LOGO,
    );
    if (!sourcePath) throw new Error("no source path");
    const args: RemoteFixCommandArgs = {
      uri: galleryUri,
      moduleFilePath: Internal.splitModuleFilePathAndModulePath(sourcePath)[0],
      sourcePath,
      fix: "images:upload-remote",
      message: "Expected a remote image, but got a local path.",
      value: LOGO,
    };
    await session.client.sendRequest("workspace/executeCommand", {
      command: VAL_UPLOAD_REMOTE_COMMAND,
      arguments: [args],
    });

    expect(messages).toEqual([]);
    expect(uploads).toHaveLength(1);
    expect(edits).toHaveLength(1);
    const changes = edits[0].edit.changes ?? {};
    expect(Object.keys(changes).sort()).toEqual(
      [galleryUri, pageUri, ...entryUris].sort(),
    );

    const galleryAfter = TextDocument.applyEdits(
      TextDocument.create(galleryUri, "typescript", 1, galleryText),
      changes[galleryUri],
    );
    const ref = galleryAfter.match(
      /"(https:\/\/remote\.val\.build[^"]+)"/,
    )?.[1];
    expect(ref).toMatch(/pubproj.*public\/val\/images\/logo_abcde\.png$/);
    expect(galleryAfter).not.toContain(`"${LOGO}"`);

    const pageAfter = TextDocument.applyEdits(
      TextDocument.create(
        pageUri,
        "typescript",
        1,
        fs.readFileSync(pageFile, "utf-8"),
      ),
      changes[pageUri],
    );
    expect(pageAfter).not.toContain(`"${LOGO}"`);
    // The field and the rich text image, and the field's alt kept.
    expect(pageAfter.split(`"${ref}"`)).toHaveLength(3);
    expect(pageAfter).toContain('alt: "Kept"');

    // Each `.jsonValues()` entry's field, in its own `*.val.json`.
    const entriesAfter = entryFiles.map((file, i) =>
      JSON.parse(
        TextDocument.applyEdits(
          TextDocument.create(
            entryUris[i],
            "json",
            1,
            fs.readFileSync(file, "utf-8"),
          ),
          changes[entryUris[i]],
        ),
      ),
    );
    expect(entriesAfter).toEqual([
      { image: { path: ref } },
      { image: { path: ref, alt: "B" } },
    ]);
  });
});
