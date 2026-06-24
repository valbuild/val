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
