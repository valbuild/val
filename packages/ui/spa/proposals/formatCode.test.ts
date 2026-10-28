import {
  formatWithProjectPrettier,
  parserOf,
  prettierConfigOf,
} from "./formatCode";

describe("the project's Prettier config, as Prettier finds it", () => {
  test("the nearest config above the file wins, and none is the defaults", () => {
    const project = {
      ".prettierrc": '{ "semi": false }',
      "packages/a/package.json": '{ "prettier": { "singleQuote": true } }',
    };
    expect(prettierConfigOf(project, "packages/a/src/x.ts")).toEqual({
      status: "found",
      options: { singleQuote: true },
    });
    expect(prettierConfigOf(project, "src/y.ts")).toEqual({
      status: "found",
      options: { semi: false },
    });
    expect(prettierConfigOf({}, "src/y.ts")).toEqual({
      status: "found",
      options: {},
    });
  });

  test("a config the tab cannot read is said, not guessed at", () => {
    const projects: Record<string, string>[] = [
      { "prettier.config.mjs": "export default {}" },
      { ".prettierrc": "semi: false" },
      { "package.json": '{ "prettier": "@acme/prettier-config" }' },
      { ".prettierrc.json": '{ "plugins": ["prettier-plugin-tailwindcss"] }' },
      { ".prettierrc.json": '{ "overrides": [{ "files": "*.md" }] }' },
    ];
    for (const project of projects) {
      expect(prettierConfigOf(project, "src/x.ts").status).toBe("unsupported");
    }
  });
});

describe("formatting a file with the project's Prettier", () => {
  test("formats TypeScript with the project's options", async () => {
    const outcome = await formatWithProjectPrettier(
      "export const  loop =   'formatted'",
      "src/loop.ts",
      { ".prettierrc.json": '{ "singleQuote": true }' },
    );
    expect(outcome).toEqual({
      status: "formatted",
      text: "export const loop = 'formatted';\n",
    });
  });

  test("formats JSON, CSS and TSX by their names", async () => {
    expect(await formatWithProjectPrettier('{"a":1}', "data.json", {})).toEqual(
      { status: "formatted", text: '{ "a": 1 }\n' },
    );
    expect(
      await formatWithProjectPrettier("a{color:red}", "src/app.css", {}),
    ).toEqual({ status: "formatted", text: "a {\n  color: red;\n}\n" });
    const tsx = await formatWithProjectPrettier(
      "export const A = () => <div   className='x'>hi</div>",
      "src/A.tsx",
      {},
    );
    expect(tsx).toEqual({
      status: "formatted",
      text: 'export const A = () => <div className="x">hi</div>;\n',
    });
  });

  test("a file that does not parse fails with Prettier's message", async () => {
    const outcome = await formatWithProjectPrettier(
      "export const = ;",
      "src/broken.ts",
      {},
    );
    expect(outcome.status).toBe("failed");
  });

  test("a file Prettier does not format here is said", async () => {
    expect(parserOf("image.png")).toBeNull();
    expect((await formatWithProjectPrettier("x", "image.png", {})).status).toBe(
      "unsupported",
    );
  });
});
