import { createModuleLoader } from "./ValModuleLoader";
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

describe("val module loader", () => {
  test.each(TestCases)(
    "resolution and smoke test transpilation for: $name",
    async (testCase) => {
      const rootDir = path.resolve(__dirname, TestCaseDir, testCase.name);
      const loader = createModuleLoader(rootDir);
      expect(
        await loader.getModule(
          loader.resolveModulePath(
            `${testCase.valConfigDir}/val-system.${testCase.ext}`,
            "./pages/blogs.val"
          )
        )
      ).toContain("/pages/blogs");
      expect(
        await loader.getModule(
          loader.resolveModulePath(
            `${testCase.valConfigDir}/pages/blogs.val.${testCase.ext}`,
            "../val.config"
          )
        )
      ).toContain("@valbuild/lib");
    }
  );

  test("resolution based on baseDir / paths in tsconfig", () => {
    const rootDir = path.resolve(
      __dirname,
      TestCaseDir,
      "basic-next-src-typescript"
    );
    const moduleLoader = createModuleLoader(rootDir);

    const containingFile = "./src/pages/blogs.val.ts";
    const baseCase = moduleLoader.resolveModulePath(
      containingFile,
      "../val.config"
    ); // tsconfig maps @ to src
    const pathsMapping = moduleLoader.resolveModulePath(
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
    const moduleLoader = createModuleLoader(rootDir);

    const containingFile = "./pages/blogs.val.js";
    expect(
      moduleLoader.resolveModulePath(containingFile, "../val.config")
    ).toMatch(/val\.config\.js$/);
  });
});
