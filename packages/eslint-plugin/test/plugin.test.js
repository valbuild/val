// @ts-check
/* eslint-disable no-undef */
import { ESLint } from "eslint";
import path from "path";

/**
 * @param {string} fixtureConfigName ESLint JSON config fixture filename.
 */
function initESLint(fixtureConfigName) {
  return new ESLint({
    cwd: path.resolve(__dirname, "../fixtures/"),
    ignore: false,
    overrideConfigFile: path.resolve(
      __dirname,
      "../fixtures/",
      fixtureConfigName
    ),
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

  test("no illegal modules for monorepos (projects that are not at root)", async () => {
    const code = `import { s, val } from "../val.config";

export const schema = s.string();

export default val.content(
  "/something",
  schema,
  "React Server components also works"
);`;
    const results = await eslint.lintText(code, {
      filePath: "./app/test.val.ts",
    });

    expect(results).toHaveLength(1);
    expect(results[0].messages).toHaveLength(1);
    expect(results[0].messages[0].fix?.text).toEqual('"/app/test"');
  });
});
