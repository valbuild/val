import { valModulesEntryFile, valModulesEntryPath } from "./buildRegistry";

/**
 * The name a build's registry is served at. The builder writes the file
 * (`valModulesEntry` in `@valbuild/tanstack-build`) and the server names it
 * on its manifest from here; neither depends on the other, so both pin the
 * same literal -- the builder in its `valModules.test.ts`.
 */
test("a build's registry is val-modules-<build>.js among its client chunks", () => {
  expect(valModulesEntryFile("b2")).toBe("val-modules-b2.js");
  expect(valModulesEntryPath("b2")).toBe("/_app/val-modules-b2.js");
});
