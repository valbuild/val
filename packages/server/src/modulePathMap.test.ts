import ts from "typescript";
import { createModulePathMap, getModulePathRange } from "./modulePathMap";
import assert from "assert";

describe("Should map source path to line / cols", () => {
  test("test 1", () => {
    const text = `import type { InferSchemaType } from '@valbuild/next';
import { s, c } from '../val.config';

const commons = {
  keepAspectRatio: s.boolean().optional(),
  size: s.union(s.literal('xs'), s.literal('md'), s.literal('lg')).optional(),
};

export const schema = s.object({
  text: s.string({ minLength: 10 }),
  nested: s.object({
    text: s.string({ minLength: 10 }),
  }),
  testText: s
  .richtext({
    a: true,
    bold: true,
    headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    lineThrough: true,
    italic: true,
    link: true,
    img: true,
    ul: true,
    ol: true,
  })
  .optional(),
  testUnion: s.union(
  'type',
  s.object({
    ...commons,
    type: s.literal('singleImage'),
    image: s.image().optional(),
  }),
  s.object({
    ...commons,
    type: s.literal('doubleImage'),
    image1: s.image().optional(),
    image2: s.image().optional(),
  })
  ),
});
export type TestContent = InferSchemaType<typeof schema>;

export default c.define(
  '/oj/test.val.ts', // <- NOTE: this must be the same path as the file
  schema,
  {
  testText: [],
  text: 'hei',
  nested: {
    text: 'hei',
  },
  testUnion: {
    type: 'singleImage',
    keepAspectRatio: true,
    size: 'xs',
    image: c.image('/public/Screenshot 2023-11-30 at 20.20.11_dbcdb.png'),
  },
  }
);
`;
    const sourceFile = ts.createSourceFile(
      "./oj/test.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);

    assert(!!modulePathMap, "modulePathMap is undefined");

    console.log(getModulePathRange('"text"', modulePathMap));
    assert.deepStrictEqual(getModulePathRange('"text"', modulePathMap), {
      end: { character: 6, line: 48 },
      start: { character: 2, line: 48 },
    });
    console.log(getModulePathRange('"nested"."text"', modulePathMap));
    assert.deepStrictEqual(
      getModulePathRange('"nested"."text"', modulePathMap),
      { end: { character: 8, line: 50 }, start: { character: 4, line: 50 } },
    );

    // target "value" points at the value ('hei') instead of the key (text)
    assert.deepStrictEqual(
      getModulePathRange('"text"', modulePathMap, "value"),
      { end: { character: 13, line: 48 }, start: { character: 8, line: 48 } },
    );
    // explicit "key" matches the default
    assert.deepStrictEqual(
      getModulePathRange('"text"', modulePathMap, "key"),
      getModulePathRange('"text"', modulePathMap),
    );
  });

  test("test 2", () => {
    const text = `import { s, c } from '../val.config';

const commons = {
  keepAspectRatio: s.boolean().optional(),
  size: s.union(s.literal('xs'), s.literal('md'), s.literal('lg')).optional(),
};

export const schema = s.object({
  ingress: s.string({ maxLength: 1 }),
  theme: s.string().raw(),
  header: s.string(),
  image: s.image(),
});

export default c.define('/content/aboutUs.val.ts', schema, {
  ingress:
    'Vi elsker å bytestgge digitale tjenester som betyr noe for folk, helt fra bunn av, og helt ferdig. Vi tror på iterative utviklingsprosesser, tverrfaglige team, designdrevet produktutvikling og brukersentrerte designmetoder.',
  header: 'SPESIALISTER PÅ DIGITAL PRODUKTUTVIKLING',
  image: c.image(
    '/public/368032148_1348297689148655_444423253678040057_n_64374.png',
    {
      width: 1283,
      height: 1121,
    }
  ),
});
`;
    const sourceFile = ts.createSourceFile(
      "./oj/test.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);
    assert(!!modulePathMap, "modulePathMap is undefined");

    console.log(modulePathMap);
    // console.log(getModulePathRange('"ingress"', modulePathMap));
    assert.deepStrictEqual(getModulePathRange('"ingress"', modulePathMap), {
      start: { line: 15, character: 2 },
      end: { line: 15, character: 9 },
    });
  });

  test("test 3", () => {
    const text = `import { s, c } from '../val.config';

export const schema = s.object({
  first: s.array(s.object({ second: s.record(s.array(s.string()))}))
});

export default c.define('/content', schema, {
  first: [{ second: { a: ['a', 'b'] } }]
});
`;
    const sourceFile = ts.createSourceFile(
      "./content.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);
    assert(!!modulePathMap, "modulePathMap is undefined");

    // console.log(getModulePathRange('"first".0."second"."a".1', modulePathMap));
    assert.deepStrictEqual(
      getModulePathRange('"first".0."second"."a".1', modulePathMap),
      {
        start: { line: 7, character: 31 },
        end: { line: 7, character: 34 },
      },
    );
  });

  test("should point at the opening line of a multi-line array element", () => {
    const text = `import { s, c } from '../val.config';

export const schema = s.array(s.object({ title: s.string() }));

export default c.define('/content/multiline.val.ts', schema, [
  {
    title: 'hello',
  },
  {
    title: 'world',
  },
]);
`;
    const sourceFile = ts.createSourceFile(
      "./content/multiline.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);
    assert(!!modulePathMap, "modulePathMap is undefined");

    // The element spans lines 5-7: the range must start on the *opening* line
    // with a non-negative character (a start derived from `end - width` gave
    // the closing line and a negative character, which crashed the CLI's code
    // frame renderer on `" ".repeat(-n)`).
    assert.deepStrictEqual(getModulePathRange("0", modulePathMap), {
      start: { line: 5, character: 2 },
      end: { line: 7, character: 3 },
    });
    assert.deepStrictEqual(getModulePathRange("1", modulePathMap), {
      start: { line: 8, character: 2 },
      end: { line: 10, character: 3 },
    });
    // Leaves inside the element are unaffected
    assert.deepStrictEqual(getModulePathRange('0."title"', modulePathMap), {
      start: { line: 6, character: 4 },
      end: { line: 6, character: 9 },
    });
    assert.deepStrictEqual(
      getModulePathRange('0."title"', modulePathMap, "value"),
      { start: { line: 6, character: 11 }, end: { line: 6, character: 18 } },
    );
  });

  test("should point at the opening line of a multi-line c.image metadata", () => {
    const text = `import { s, c } from '../val.config';

export const schema = s.object({ image: s.image() });

export default c.define('/content/img.val.ts', schema, {
  image: c.image('/public/val/logo.png', {
    width: 944,
    height: 944,
    mimeType: 'image/png',
  }),
});
`;
    const sourceFile = ts.createSourceFile(
      "./content/img.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);
    assert(!!modulePathMap, "modulePathMap is undefined");

    // The metadata object spans lines 5-9 - it must start at the `{` on line 5.
    assert.deepStrictEqual(
      getModulePathRange('"image"."metadata"', modulePathMap),
      { start: { line: 5, character: 41 }, end: { line: 9, character: 3 } },
    );
    assert.deepStrictEqual(
      getModulePathRange('"image"."_ref"', modulePathMap),
      {
        start: { line: 5, character: 17 },
        end: { line: 5, character: 39 },
      },
    );
    // The whole c.image(...) call, for errors reported on the field itself
    assert.deepStrictEqual(
      getModulePathRange('"image"', modulePathMap, "value"),
      { start: { line: 5, character: 9 }, end: { line: 9, character: 4 } },
    );
  });

  test("should handle invalid/malformed module paths gracefully", () => {
    const text = `import { s, c } from '../val.config';

export const schema = s.object({
  text: s.string(),
});

export default c.define('/content', schema, {
  text: 'hello'
});
`;
    const sourceFile = ts.createSourceFile(
      "./content.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);
    assert(!!modulePathMap, "modulePathMap is undefined");

    // These should return undefined instead of throwing
    assert.strictEqual(getModulePathRange("", modulePathMap), undefined);
    assert.strictEqual(getModulePathRange("invalid", modulePathMap), undefined);
    assert.strictEqual(getModulePathRange(".", modulePathMap), undefined);
    assert.strictEqual(getModulePathRange("..", modulePathMap), undefined);
    assert.strictEqual(getModulePathRange("foo.bar", modulePathMap), undefined);
    assert.strictEqual(
      getModulePathRange(undefined as unknown as string, modulePathMap),
      undefined,
    );
    assert.strictEqual(
      getModulePathRange(null as unknown as string, modulePathMap),
      undefined,
    );
  });
});
