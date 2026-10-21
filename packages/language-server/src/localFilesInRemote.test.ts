import fs from "fs";
import os from "os";
import path from "path";
import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import { DiagnosticSeverity } from "vscode-languageserver";
import { createValDiagnostics, type ValDiagnosticData } from "./diagnostics";
import type { ValModuleContent } from "./ValProject";

/**
 * A local file in a project with remote files: a warning, as `val validate`
 * says -- unless the file is not there, which is an error whatever fix the
 * value was reported with.
 */

const { s, c } = initVal();
const IMAGES = "/content/images.val.ts" as ModuleFilePath;
const KEY = "/public/val/images/hero_00000.png";
const TEXT = `import { c, s } from "../val.config";

export default c.define(
  "/content/images.val.ts",
  s.imagedir("/public/val/images").remote(),
  {
    "/public/val/images/hero_00000.png": { width: 1, height: 1, mimeType: "image/png", alt: null },
  },
);
`;

let valRoot: string;
beforeEach(() => {
  valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-ls-local-remote-"));
  fs.mkdirSync(path.join(valRoot, "public/val/images"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(valRoot, { recursive: true, force: true });
});

function content(): ValModuleContent {
  const module = c.define(IMAGES, s.imagedir("/public/val/images").remote(), {
    [KEY]: { width: 1, height: 1, mimeType: "image/png", alt: null },
  });
  const schema = Internal.getSchema(module);
  const serialized = schema?.["executeSerialize"]();
  if (!schema || !serialized) throw new Error("no schema");
  const source = Internal.getSource(module);
  const validation = schema["executeValidate"](
    IMAGES as string as SourcePath,
    source,
  );
  return {
    path: IMAGES as string as SourcePath,
    source,
    schema: serialized,
    errors: validation ? { validation } : false,
  };
}

function diagnosticAtKey() {
  const diagnostics = createValDiagnostics({
    moduleFilePath: IMAGES,
    content: content(),
    text: TEXT,
    valRoot,
  });
  return diagnostics.filter((d) => {
    const data = d.data as ValDiagnosticData | undefined;
    return data?.sourcePath.includes(KEY);
  });
}

test("a local entry whose file is there is a warning", () => {
  fs.writeFileSync(path.join(valRoot, KEY), "png");
  const found = diagnosticAtKey();
  expect(found).toHaveLength(1);
  expect(found[0].severity).toBe(DiagnosticSeverity.Warning);
  expect((found[0].data as ValDiagnosticData).fixes).toEqual([
    "images:upload-remote",
  ]);
});

test("a local entry whose file is gone is an error", () => {
  const found = diagnosticAtKey();
  expect(found).toHaveLength(1);
  expect(found[0].severity).toBe(DiagnosticSeverity.Error);
  expect(found[0].data).toMatchObject({ code: "val/file-not-found" });
});
