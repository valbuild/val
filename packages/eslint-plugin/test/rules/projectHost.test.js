import { RuleTester } from "@typescript-eslint/rule-tester";
import {
  createRules,
  registeredSpecifiers,
} from "@valbuild/eslint-plugin/rules";

/**
 * The rules that read the project, over a project that is not on a disk: the
 * Studio's, a proposal's files in memory (`@valbuild/eslint-plugin/rules`).
 */

/** A project of files by path from its root, as the Studio has one. */
function memoryHost(files) {
  return {
    modulePathOf: (filename) => filename,
    registeredModules: () => {
      const text = files["val.modules.ts"];
      if (text === undefined) return null;
      return registeredSpecifiers(text).map(
        (specifier) =>
          "/" +
          specifier.replace(/^\.\//, "") +
          (/\.[jt]s$/.test(specifier) ? "" : ".ts"),
      );
    },
    displayPath: (filename) => filename,
  };
}

const ruleTester = new RuleTester();

const MODULE = `import { c, s } from "../../val.config";
export default c.define("/src/content/home.val.ts", s.string(), "Hello");`;

describe("module-in-val-modules, over a project in memory", () => {
  ruleTester.run(
    "module-in-val-modules",
    createRules(
      memoryHost({
        "val.modules.ts": `export default modules(config, [
  { def: () => import("./src/content/home.val") },
]);`,
      }),
    )["module-in-val-modules"],
    {
      valid: [
        { filename: "/src/content/home.val.ts", code: MODULE },
        // Not a module: nothing to register.
        {
          filename: "/src/content/schema.val.ts",
          code: `import { s } from "../../val.config";
export const schema = s.string();`,
        },
      ],
      invalid: [
        {
          filename: "/src/content/about.val.ts",
          code: MODULE.replace("home", "about"),
          errors: [{ messageId: "missingFile" }],
        },
      ],
    },
  );

  ruleTester.run(
    "module-in-val-modules",
    createRules(memoryHost({}))["module-in-val-modules"],
    {
      // No val.modules.ts: nothing to check against.
      valid: [{ filename: "/src/content/about.val.ts", code: MODULE }],
      invalid: [],
    },
  );
});

describe("no-illegal-module-paths, over a project in memory", () => {
  ruleTester.run(
    "no-illegal-module-paths",
    createRules(memoryHost({}))["no-illegal-module-paths"],
    {
      valid: [{ filename: "/src/content/home.val.ts", code: MODULE }],
      invalid: [
        {
          filename: "/src/content/about.val.ts",
          code: MODULE,
          errors: [
            {
              message:
                "Val: c.define path must match the filename. Expected: '/src/content/about.val.ts'. Found: '/src/content/home.val.ts'",
            },
          ],
          output: MODULE.replace("home", "about"),
        },
      ],
    },
  );
});

test("registeredSpecifiers reads every module val.modules.ts imports", () => {
  expect(
    registeredSpecifiers(`export default modules(config, [
  { def: () => import("./settings.val") },
  { def: () => import('./src/routes/posts.$postId.val.ts') },
]);`),
  ).toEqual(["./settings.val", "./src/routes/posts.$postId.val.ts"]);
});
