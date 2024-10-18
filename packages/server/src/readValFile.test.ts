import {
  TestQuickJSWASMModule,
  newQuickJSAsyncWASMModule,
} from "quickjs-emscripten";
import { readValFile } from "./readValFile";
import path from "path";
import { createModuleLoader } from "./ValModuleLoader";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";
import { ModuleFilePath } from "@valbuild/core";

const TestCaseDir = "../test/example-projects";
const TestCases = [
  { name: "basic-next-typescript", ext: ".ts" },

  {
    name: "basic-next-src-typescript",
    prefix: "/src",
    ext: ".ts",
  },
  { name: "basic-next-javascript", ext: ".js" },
  { name: "typescript-description-files", ext: ".ts" },
];

describe("read val file", () => {
  // We cannot, currently use TestQuickJSWASMModule
  let QuickJS: TestQuickJSWASMModule;

  beforeEach(async () => {
    QuickJS = new TestQuickJSWASMModule(await newQuickJSAsyncWASMModule());
  });

  afterEach(() => {
    QuickJS.disposeAll();
    QuickJS.assertNoMemoryAllocated();
  });

  test.each(TestCases)("read basic val file from: $name", async (testCase) => {
    const rootDir = path.resolve(__dirname, TestCaseDir, testCase.name);
    const loader = createModuleLoader(rootDir);
    const testRuntime = await newValQuickJSRuntime(QuickJS, loader, {
      maxStackSize: 1024 * 640,
      memoryLimit: 1024 * 640,
    });
    const result = await readValFile(
      ((testCase.prefix ? testCase.prefix : "") +
        "/pages/blogs.val" +
        testCase.ext) as ModuleFilePath,
      rootDir,
      testRuntime,
      {
        schema: true,
        source: true,
        validate: true,
      },
    );
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("schema");
  });
});
