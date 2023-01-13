import { ValFileSystemModuleResolver } from "./ValModuleResolver";
import path from "path";

describe("val module resolver", () => {
  test.each([
    "basic-typescript",
    "basic-javascript",
    "typescript-description-files",
  ])("basic resolution: %s", async (testName) => {
    const rootDir = path.resolve(
      __dirname,
      "../test/module-resolver",
      testName
    );
    const resolver = new ValFileSystemModuleResolver(rootDir);
    expect(
      await resolver.getTranspiledCode(
        resolver.resolveModulePath("./val-system.js", "./pages/blogs.val")
      )
    ).toBeDefined();

    expect(
      await resolver.getTranspiledCode(
        resolver.resolveModulePath("./pages/blogs.val.ts", "../val.config")
      )
    ).toBeDefined();
  });
});
