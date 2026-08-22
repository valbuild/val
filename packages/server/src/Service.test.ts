import path from "path";
import nodeFs from "fs";
import ts from "typescript";
import type { ModuleFilePath, ModulePath } from "@valbuild/core";
import { createService } from "./Service";
import { IValFSHost } from "./ValFSHost";

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");
const PATHS_ALIAS_FIXTURE = path.resolve(__dirname, "__fixtures__/paths-alias");

function createTestHost(overrides?: Partial<IValFSHost>): IValFSHost {
  return {
    ...ts.sys,
    writeFile: (fileName, data, encoding) => {
      nodeFs.mkdirSync(path.dirname(fileName), { recursive: true });
      nodeFs.writeFileSync(
        fileName,
        typeof data === "string" ? data : new Uint8Array(data),
        encoding,
      );
    },
    rmFile: nodeFs.rmSync,
    readBuffer: (fileName) => {
      try {
        return nodeFs.readFileSync(fileName);
      } catch {
        return undefined;
      }
    },
    ...overrides,
  };
}

describe("createService", () => {
  test("lists only the modules registered in val.modules", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    expect(service.getModuleFilePaths().sort()).toEqual([
      "/content/basic-errors.val.ts",
      "/content/basic-nested.val.ts",
      "/content/basic-valid.val.ts",
    ]);
  });

  test("get returns source and schema for a valid module", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    const res = await service.get(
      "/content/basic-valid.val.ts" as ModuleFilePath,
      "" as ModulePath,
    );

    expect(res.errors).toBe(false);
    expect(res.source).toBe("Hello World");
    expect(res.schema).toMatchObject({ type: "string", opt: false });
  });

  test("get resolves a nested module path to the sub-source and sub-schema", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    const res = await service.get(
      "/content/basic-nested.val.ts" as ModuleFilePath,
      '"items".0."label"' as ModulePath,
    );

    expect(res.source).toBe("first");
    expect(res.schema).toMatchObject({ type: "string", opt: false });
  });

  test("get returns the whole module source when module path is empty", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    const res = await service.get(
      "/content/basic-nested.val.ts" as ModuleFilePath,
      "" as ModulePath,
    );

    expect(res.source).toEqual({
      title: "Nested",
      items: [
        { label: "first", count: 1 },
        { label: "second", count: 2 },
      ],
    });
  });

  test("get returns validation errors for an invalid module", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    const res = await service.get(
      "/content/basic-errors.val.ts" as ModuleFilePath,
      "" as ModulePath,
    );

    expect(res.errors).toBeTruthy();
    expect(res.errors && res.errors.validation).toBeTruthy();
    expect(res.source).toBe("Hello World");
  });

  test("get skips validation when the validate option is false", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    const res = await service.get(
      "/content/basic-errors.val.ts" as ModuleFilePath,
      "" as ModulePath,
      { validate: false },
    );

    expect(res.errors).toBe(false);
  });

  test("get returns a fatal error for a module that is not in val.modules", async () => {
    const service = await createService(BASIC_FIXTURE, createTestHost());

    const res = await service.get(
      "/content/not-registered.val.ts" as ModuleFilePath,
      "" as ModulePath,
    );

    expect(res.errors && res.errors.invalidModulePath).toBe(
      "/content/not-registered.val.ts",
    );
    expect(res.errors && res.errors.fatal?.[0].message).toContain(
      "was not found in val.modules",
    );
  });

  test("resolves val modules imported via a tsconfig paths alias", async () => {
    const service = await createService(
      PATHS_ALIAS_FIXTURE,
      createTestHost(),
    );

    expect(service.getModuleFilePaths()).toEqual(["/src/content/page.val.ts"]);
    const res = await service.get(
      "/src/content/page.val.ts" as ModuleFilePath,
      "" as ModulePath,
    );
    expect(res.source).toBe("Aliased");
  });

  test("reads val modules through the provided IValFSHost", async () => {
    const valFilePath = path.resolve(
      BASIC_FIXTURE,
      "content/basic-valid.val.ts",
    );
    const readFiles: string[] = [];
    const host = createTestHost({
      readFile: (fileName: string) => {
        readFiles.push(fileName);
        if (path.resolve(fileName) === valFilePath) {
          return `import { c, s } from "../val.config";
export default c.define("/content/basic-valid.val.ts", s.string(), "Patched by host");
`;
        }
        return ts.sys.readFile(fileName);
      },
    });

    const service = await createService(BASIC_FIXTURE, host);
    const res = await service.get(
      "/content/basic-valid.val.ts" as ModuleFilePath,
      "" as ModulePath,
    );

    // The host - not the real fs - decided what the module contains.
    expect(res.source).toBe("Patched by host");
    expect(readFiles.map((f) => path.resolve(f))).toContain(valFilePath);
    expect(readFiles.map((f) => path.resolve(f))).toContain(
      path.resolve(BASIC_FIXTURE, "val.modules.ts"),
    );
  });

  test("throws when the project root has no val.modules file", async () => {
    const host = createTestHost({
      fileExists: (fileName) =>
        path.basename(fileName).startsWith("val.modules")
          ? false
          : ts.sys.fileExists(fileName),
    });

    await expect(createService(BASIC_FIXTURE, host)).rejects.toThrow(
      /Could not find 'val.modules.ts' nor 'val.modules.js'/,
    );
  });
});
