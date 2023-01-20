import { ValModuleResolver } from "./ValModuleResolver";
import path from "path";

const TestCaseDir = "../test/example-projects";
const TestCases = [
  { name: "basic-next-typescript", valConfigDir: ".", ext: "ts" },
  {
    name: "basic-next-src-typescript",
    valConfigDir: "./src",
    ext: "ts",
  },
  { name: "basic-next-javascript", valConfigDir: ".", ext: "js" },
  { name: "typescript-description-files", valConfigDir: ".", ext: "js" },
];

describe("val module resolver", () => {
  test.each(TestCases)("basic resolution: $name", async (testCase) => {
    const rootDir = path.resolve(__dirname, TestCaseDir, testCase.name);
    const resolver = new ValModuleResolver(rootDir);
    console.log(
      resolver.resolveRuntimeModulePath(
        `${testCase.valConfigDir}/val-system.${testCase.ext}`,
        "./pages/blogs.val"
      )
    );
    // TODO: check actual results as well:
    expect(
      await resolver.getTranspiledCode(
        resolver.resolveRuntimeModulePath(
          `${testCase.valConfigDir}/val-system.${testCase.ext}`,
          "./pages/blogs.val"
        )
      )
    ).toBeDefined();
    expect(
      await resolver.getTranspiledCode(
        resolver.resolveRuntimeModulePath(
          `${testCase.valConfigDir}/pages/blogs.val.${testCase.ext}`,
          "../val.config"
        )
      )
    ).toBeDefined();
  });

  test("resolution based on baseDir / paths in tsconfig", () => {
    const rootDir = path.resolve(
      __dirname,
      TestCaseDir,
      "basic-next-src-typescript"
    );
    const resolver = new ValModuleResolver(rootDir);

    const containingFile = "./src/pages/blogs.val.ts";
    const baseCase = resolver.resolveRuntimeModulePath(
      containingFile,
      "../val.config"
    ); // tsconfig maps @ to src
    const pathsMapping = resolver.resolveRuntimeModulePath(
      containingFile,
      "@/val.config"
    ); // tsconfig maps @ to src
    expect(baseCase).toBeDefined();
    expect(baseCase).toEqual(pathsMapping);
  });

  test("resolution on .d.ts files", () => {
    const rootDir = path.resolve(
      __dirname,
      TestCaseDir,
      "typescript-description-files"
    );
    const resolver = new ValModuleResolver(rootDir);

    const containingFile = "./pages/blogs.val.js";
    expect(
      resolver.resolveRuntimeModulePath(containingFile, "../val.config")
    ).toMatch(/val\.config\.js$/);
  });
});
