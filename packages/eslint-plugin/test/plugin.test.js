// @ts-check
/* eslint-disable no-undef */
import { ESLint } from "eslint";
import path from "path";
import plugin from "../src";

function initESLint() {
  return new ESLint({
    cwd: path.resolve(__dirname, "../fixtures/"),
    ignore: false,
    overrideConfigFile: path.resolve(
      __dirname,
      "../fixtures/",
      "eslintrc.json"
    ),
    plugins: { "@valbuild": plugin },
  });
}

describe("plugin", () => {
  /**
   * @type {ESLint}
   */
  let eslint;

  beforeAll(() => {
    eslint = initESLint();
  });

  test("todo", async () => {
    const code = `import { s, val } from "../val.config";

export const schema = s.string();

export default val.content(
  "/app/test",
  schema,
  "React Server components also works"
);`;
    const results = await eslint.lintText(code, {
      filePath: "./app/test.val.ts",
    });

    console.log(JSON.stringify(results, null, 2));
  });
});
