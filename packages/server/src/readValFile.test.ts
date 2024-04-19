import {
  TestQuickJSWASMModule,
  newQuickJSAsyncWASMModule,
} from "quickjs-emscripten";
import { readValFile } from "./readValFile";
import path from "path";
import { createModuleLoader } from "./ValModuleLoader";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";

const TestCaseDir = "../test/example-projects";
const TestCases = [
  { name: "basic-next-typescript", valConfigPath: "./val.config" },
  {
    name: "basic-next-src-typescript",
    valConfigPath: "./src/val.config",
  },
  { name: "basic-next-javascript", valConfigPath: "./val.config" },
  { name: "typescript-description-files", valConfigPath: "./val.config" },
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
      "/pages/blogs",
      testCase.valConfigPath,
      testRuntime,
      {
        schema: true,
        source: true,
        validate: true,
      }
    );
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("schema");
  });
});
