import {
  ModuleId,
  PatchId,
  ApiDeletePatchResponse,
  ApiPostPatchResponse,
  ApiGetPatchResponse,
  ModulePath,
  FileMetadata,
  ImageMetadata,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { Result } from "@valbuild/core/src/fp/result";
import {
  ValServerError,
  ValServerJsonResult,
  ValSession,
  ValServerRedirectResult,
  ValServerResult,
} from "@valbuild/shared/internal";
import { SerializedModuleContent } from "./SerializedModuleContent";
import {
  ValServer,
  bufferFromDataUrl,
  bufferToReadableStream,
  getMimeTypeFromBase64,
  guessMimeTypeFromPath,
} from "./ValServer";
import { Directories, DirectoryNode, RemoteFS } from "./RemoteFS";
import fs from "fs";
import path from "path";
import { result } from "@valbuild/core/fp";
import { createService } from "./Service";

const anotherSmallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

describe("ValServer", () => {
  test("basic tests", async () => {
    const root = path.join(
      __dirname,
      "../test/example-projects/basic-next-src-typescript"
    );
    const testServer = new TestValServer(root);
    testServer.initializeFromTestDir(root);
    // console.log(JSON.stringify(await testServer.getTree("/", {}, {}), null, 2));
    testServer.postPatches({
      "/src/pages/blogs": [
        {
          op: "replace",
          path: ["0", "title"],
          value: "New Title",
        },
      ],
    } satisfies Record<string, Patch>);
    await testServer.postPatches({
      "/src/pages/metadata-tests": [
        {
          op: "replace",
          path: ["image"],
          value: {
            _ref: "/public/managed/images/smallest.png",
            _type: "file",
            metadata: {
              width: 1,
              height: 1,
              sha256:
                "80d58a5b775debc85386b320c347a59ffeeae5eeb3ca30a3a3ca04b5aaed145d",
              mimeType: "image/png",
            },
          },
        },
      ],
    } satisfies Record<string, Patch>);

    expect(
      await testServer.getTree(
        "/",
        {
          patch: true.toString(),
        },
        {},
        {}
      )
    ).toHaveProperty("status", 200);

    expect(
      await testServer.postPatches({
        "/src/pages/metadata-tests": [
          {
            op: "file",
            filePath: "/public/managed/images/smallest.png",
            path: ["image"],
            value: anotherSmallPng,
          },
        ],
      })
    ).toHaveProperty("status", 200);
    // console.log(await testServer.getPatches({}));
    expect(
      await testServer.getTree(
        "/src/pages/metadata-tests",
        {
          patch: true.toString(),
        },
        {},
        {}
      )
    ).toHaveProperty("status", 200);
    expect(
      await testServer.getFiles("/public/managed/images/smallest.png")
    ).toHaveProperty("status", 200);
  });

  test("getMimeTypeFromBase64", () => {
    expect(getMimeTypeFromBase64(anotherSmallPng)).toStrictEqual("image/png");
  });

  test("bufferFromDataUrl", () => {
    const withMimeType = bufferFromDataUrl(anotherSmallPng, "image/png");
    expect(withMimeType).toBeDefined();
    const withoutMimeType = bufferFromDataUrl(anotherSmallPng, null);
    expect(withoutMimeType).toBeDefined();
    expect(withoutMimeType).toStrictEqual(withMimeType);
  });
});

class TestValServer extends ValServer {
  remoteFS: RemoteFS;
  patches: Record<string, Record<string, Patch>> = {};
  constructor(projectRoot: string) {
    const remoteFS = new RemoteFS();
    super(
      projectRoot,
      {
        config: {},
        modules: [
          // TODO:
        ],
      },
      {
        git: FAKE_GIT,
      },
      {
        async isEnabled() {
          return true;
        },
        async onDisable() {},
        async onEnable() {},
      }
    );
    this.remoteFS = remoteFS;
  }

  async initializeFromTestDir(dir: string) {
    const directories: Directories = {};

    // Generated by ChatGPT. Sort of worked, but had to fix
    const traverse = (
      directoryPath: string,
      currentDirectory: DirectoryNode
    ) => {
      const items = fs.readdirSync(directoryPath);
      for (const item of items) {
        const itemPath = [directoryPath, item].join("/");
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          const subDirectory: DirectoryNode = {
            utf8Files: {},
            symlinks: {},
          };
          directories[itemPath] = subDirectory;
          traverse(itemPath, subDirectory);
        } else if (stats.isFile()) {
          const fileContent = fs.readFileSync(itemPath);

          currentDirectory.utf8Files[item] = fileContent.toString("utf8");
        }
      }
    };
    const rootDirectory: DirectoryNode = {
      utf8Files: {},
      symlinks: {},
    };
    directories[dir] = rootDirectory;
    traverse(dir, rootDirectory);
    await this.remoteFS.initializeWith(directories);
  }

  protected async ensureInitialized(): Promise<
    Result<undefined, ValServerError>
  > {
    return result.ok(undefined);
  }

  // TODO: remove this:
  protected async getModule(
    moduleId: ModuleId,
    options: { source: boolean; schema: boolean }
  ): Promise<SerializedModuleContent> {
    const service = await createService(this.cwd, {}, this.remoteFS);
    return service.get(moduleId, "" as ModulePath, {
      ...options,
      validate: false,
    });
  }

  // TODO: remove this:
  protected async getAllModules(treePath: string): Promise<ModuleId[]> {
    const moduleIds: ModuleId[] = this.remoteFS
      .readDirectory(
        this.cwd,
        ["ts", "js"],
        ["node_modules", ".*"],
        ["**/*.val.ts", "**/*.val.js"]
      )
      .filter((file) => {
        if (treePath) {
          return file.replace(this.cwd, "").startsWith(treePath);
        }
        return true;
      })
      .map(
        (file) =>
          file
            .replace(this.cwd, "")
            .replace(".val.js", "")
            .replace(".val.ts", "")
            .split(path.sep)
            .join("/") as ModuleId
      );

    return moduleIds;
  }

  async postPatches(
    body: Record<string, Patch>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>> {
    let patchId = Date.now();
    while (this.patches[patchId.toString()]) {
      // ensure unique patch id
      patchId++;
    }
    const patchIdStr = patchId.toString();
    this.patches[patchIdStr] = Object.fromEntries(
      Object.entries(body).map(([moduleId, patch]) => [
        moduleId,
        patch.map((op) => {
          if (op.op === "file") {
            return {
              ...op,
              value: {
                sha256: "sha256",
                mimeType: "image/png",
              },
            };
          }

          return op;
        }),
      ])
    );
    const res: ApiPostPatchResponse = {};

    for (const [moduleIdStr] of Object.entries(body)) {
      const moduleId = moduleIdStr as ModuleId;
      res[moduleId] = { patch_id: patchIdStr as PatchId };
    }
    return {
      status: 200,
      json: res,
    };
  }

  async getPatches(query: {
    id?: string[] | undefined;
  }): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    const res: ApiGetPatchResponse = {};
    for (const [patchIdStr, patches] of Object.entries(this.patches)) {
      if (query.id && query.id.length > 0 && !query.id.includes(patchIdStr)) {
        continue;
      }
      for (const [moduleIdStr, patch] of Object.entries(patches)) {
        const moduleId = moduleIdStr as ModuleId;
        if (!res[moduleId]) {
          res[moduleId] = [];
        }
        res[moduleId].push({
          patch,
          created_at: patchIdStr,
          patch_id: patchIdStr as PatchId,
        });
      }
    }
    return {
      status: 200,
      json: res,
    };
  }
  async getFiles(
    filePath: string
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>> {
    const buffer = await this.readStaticBinaryFile(
      path.join(this.cwd, filePath)
    );
    const mimeType =
      guessMimeTypeFromPath(filePath) || "application/octet-stream";
    if (!buffer) {
      return {
        status: 404,
        json: {
          message: "File not found",
        },
      };
    }
    return {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.byteLength.toString(),
      },
      body: bufferToReadableStream(buffer),
    };
  }

  /* Not (currently) needed to test server */

  protected execCommit(): Promise<
    | ValServerError
    | {
        status: 200;
        json: Record<ModuleId, { patches: { applied: PatchId[] } }>;
      }
  > {
    throw new Error("Method not implemented.");
  }
  deletePatches(): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    throw new Error("Method not implemented.");
  }

  session(): Promise<ValServerJsonResult<ValSession>> {
    throw new Error("Method not implemented.");
  }
  authorize(): Promise<ValServerRedirectResult<"val_state">> {
    throw new Error("Method not implemented.");
  }
  logout(): Promise<ValServerResult<"val_state" | "val_session">> {
    throw new Error("Method not implemented.");
  }
  callback(): Promise<
    ValServerRedirectResult<"val_enable" | "val_state" | "val_session">
  > {
    throw new Error("Method not implemented.");
  }
  getMetadata(): Promise<FileMetadata | ImageMetadata | undefined> {
    throw new Error("Method not implemented.");
  }
}

const FAKE_GIT = {
  commit: "53f4935277acbd6e95f8867c37fed55c91acc57c",
  branch: "main",
};
