import { TestQuickJSWASMModule, getQuickJS } from "quickjs-emscripten";
import { readValFile } from "./readValFile";
import path from "path";

describe("read val file", () => {
  let QuickJS: TestQuickJSWASMModule;

  beforeEach(async () => {
    QuickJS = new TestQuickJSWASMModule(await getQuickJS());
  });

  afterEach(() => {
    QuickJS.disposeAll();
    QuickJS.assertNoMemoryAllocated();
  });

  test.each([
    "basic-typescript",
    "basic-javascript",
    "typescript-description-files",
  ])("read basic val file from: %s", async (testName) => {
    const rootDir = path.resolve(
      __dirname,
      "../test/module-resolver",
      testName
    );
    const result = await readValFile(rootDir, "/pages/blogs");
    expect(result).toHaveProperty("val");
    expect(result).toHaveProperty("schema");
  });
});
