import { findValModuleDefinition, parseValModule } from "./valModuleDefinition";

const parse = (text: string) =>
  findValModuleDefinition(parseValModule("/content/test.val.ts", text));

const keywords = { start: 0, end: "export default".length };

describe("findValModuleDefinition", () => {
  test("finds nothing in a file that only exports schemas", () => {
    // The shape that used to be reported as a missing module: a `*.val.ts`
    // holding the schema the modules beside it import.
    expect(
      parse(`import { s } from "../val.config";

export const blogSchema = s.object({ title: s.string() });
`),
    ).toBeUndefined();
  });

  test("finds nothing in a type-only default export", () => {
    // Gone after transpilation, so Val could never load it as a module.
    expect(parse(`type T = string;\nexport type { T as default };\n`)).toBe(
      undefined,
    );
    expect(parse(`type T = string;\nexport { type T as default };\n`)).toBe(
      undefined,
    );
    // The spelling that looks like `export default class`: a declaration
    // carrying a `default` modifier, which emits nothing at all.
    expect(parse(`export default interface T { title: string }\n`)).toBe(
      undefined,
    );
  });

  test("finds nothing in a star re-export", () => {
    expect(parse(`export * from "./blogSchema.val";\n`)).toBeUndefined();
  });

  test("finds nothing in `export =`", () => {
    expect(parse(`export = { a: 1 };\n`)).toBeUndefined();
  });

  test("covers `export default` and not the definition it introduces", () => {
    const range = parse(`import { s, c } from "../val.config";

export default c.define(
  "/content/test.val.ts",
  s.object({ title: s.string() }),
  { title: "hi" },
);
`);
    expect(range).toEqual({
      start: { line: 2, character: keywords.start },
      end: { line: 2, character: keywords.end },
    });
  });

  test("covers the keywords when the whole module is on one line", () => {
    expect(
      parse(
        `export default c.define("/content/test.val.ts", s.string(), "hi");\n`,
      ),
    ).toEqual({
      start: { line: 0, character: keywords.start },
      end: { line: 0, character: keywords.end },
    });
  });

  test("finds an export default that is not a c.define", () => {
    // Anything in the default slot is an attempt at a module and is worth
    // reporting on; only the absence of the export means "not a module".
    expect(parse(`const m = 1;\nexport default m;\n`)).toEqual({
      start: { line: 1, character: keywords.start },
      end: { line: 1, character: keywords.end },
    });
  });

  test("covers the modifiers of a default-exported declaration", () => {
    // `export default function f() {}` is a declaration carrying the keywords
    // as modifiers, not an export assignment -- so the body is not underlined.
    expect(parse(`export default function f() {\n  return 1;\n}\n`)).toEqual({
      start: { line: 0, character: keywords.start },
      end: { line: 0, character: keywords.end },
    });
  });

  test("covers the whole statement of an `as default` re-export", () => {
    // There is no `default` keyword to stop at, and the statement is one line.
    const text = `const m = 1;\nexport { m as default };\n`;
    expect(parse(text)).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: "export { m as default };".length },
    });
  });
});
