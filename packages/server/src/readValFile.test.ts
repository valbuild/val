import {
  TestQuickJSWASMModule,
  newQuickJSAsyncWASMModule,
} from "quickjs-emscripten";
import { readValFile } from "./readValFile";
import path from "path";
import { ValModuleResolver } from "./ValModuleResolver";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";

const TestCaseDir = "../test/example-projects";
const TestCases = [
  { name: "basic-next-typescript", valConfigDir: "." },
  {
    name: "basic-next-src-typescript",
    valConfigDir: "./src",
  },
  { name: "basic-next-javascript", valConfigDir: "." },
  { name: "typescript-description-files", valConfigDir: "." },
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

  test.each(TestCases)("read basic val file from:  $name", async (testCase) => {
    const rootDir = path.resolve(__dirname, TestCaseDir, testCase.name);
    const resolver = new ValModuleResolver(rootDir);
    const testRuntime = await newValQuickJSRuntime(QuickJS, resolver, {
      maxStackSize: 1024 * 640,
      memoryLimit: 1024 * 640,
    });
    const result = await readValFile(
      "/pages/blogs",
      testCase.valConfigDir,
      testRuntime
    );
    expect(result).toHaveProperty("val");
    expect(result).toHaveProperty("schema");
  });
});
