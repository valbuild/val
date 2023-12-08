// @ts-check
/* eslint-disable no-undef */
import { ESLint } from "eslint";
import path from "path";
import plugin from "../src";

/**
 * @param {string} fixtureConfigName ESLint JSON config fixture filename.
 */
function initESLint(fixtureConfigName) {
  return new ESLint({
    cwd: path.resolve(__dirname, "../fixtures/"),
    ignore: false,
    useEslintrc: false,
    overrideConfigFile: path.resolve(
      __dirname,
      "../fixtures/",
      fixtureConfigName
    ),
    // plugins: { "@valbuild": plugin },
  });
}

describe("plugin", () => {
  /**
   * @type {ESLint}
   */
  let eslint;

  beforeAll(() => {
    eslint = initESLint("eslintrc.json");
  });

  test("todo", async () => {
    const code = `import { s, val } from "../val.config";

export const schema = s.string();

export default val.content(
  "/components/reactServerContent",
  schema,
  "React Server components also works"
);`;
    const results = await eslint.lintText(code, { filePath: "test.val.js" });

    console.log(JSON.stringify(results, null, 2));
  });
});
