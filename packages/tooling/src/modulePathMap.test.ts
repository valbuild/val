import * as ts from "typescript";
import { createModulePathMap, getModulePathRange } from "./modulePathMap";

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
  '/oj/test', // <- NOTE: this must be the same path as the file
  schema,
  {
  testText: c.richtext\`
Hei dere!
Dette er gøy!
\`,
  text: 'hei',
  nested: {
    text: 'hei',
  },
  testUnion: {
    type: 'singleImage',
    keepAspectRatio: true,
    size: 'xs',
    image: c.file('/public/Screenshot 2023-11-30 at 20.20.11_dbcdb.png'),
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

    if (!modulePathMap) {
      return expect(!!modulePathMap).toEqual("modulePathMap is undefined");
    }

    expect(getModulePathRange('"text"', modulePathMap)).toEqual({
      end: { character: 6, line: 51 },
      start: { character: 2, line: 51 },
    });
    expect(getModulePathRange('"nested"."text"', modulePathMap)).toEqual({
      end: { character: 8, line: 53 },
      start: { character: 4, line: 53 },
    });
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

export default c.define('/content/aboutUs', schema, {
  ingress:
    'Vi elsker å bytestgge digitale tjenester som betyr noe for folk, helt fra bunn av, og helt ferdig. Vi tror på iterative utviklingsprosesser, tverrfaglige team, designdrevet produktutvikling og brukersentrerte designmetoder.',
  header: 'SPESIALISTER PÅ DIGITAL PRODUKTUTVIKLING',
  image: c.file(
    '/public/368032148_1348297689148655_444423253678040057_n_64374.png',
    {
      sha256:
        '6437456f9b596355e54df8bbbe9bf32228a7b79ddbdd17cca5679931bd80ea84',
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
    if (!modulePathMap) {
      return expect(!!modulePathMap).toEqual("modulePathMap is undefined");
    }

    // console.log(getModulePathRange('"ingress"', modulePathMap));
    expect(getModulePathRange('"ingress"', modulePathMap)).toEqual({
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
    if (!modulePathMap) {
      return expect(!!modulePathMap).toEqual("modulePathMap is undefined");
    }
    expect(
      getModulePathRange('"first".0."second"."a".1', modulePathMap),
    ).toEqual({
      start: { line: 7, character: 31 },
      end: { line: 7, character: 34 },
    });
  });

  test("test 4: string literal object properties", () => {
    const text = `import { c } from "../../val.config";
import { docsSchema } from "./docsSchema.val";

export default c.define("/app/docs/docs", docsSchema, {
  "getting-started": {
    title: "Getting started",
    content: c.richtext\`
Text
\`,
    subPages: {
      installation: {
        title: "Installation",
        subPagesL2: null,
        content: null,
      },
    },
  },
});    
`;

    const sourceFile = ts.createSourceFile(
      "./content.val.ts",
      text,
      ts.ScriptTarget.ES2015,
    );

    const modulePathMap = createModulePathMap(sourceFile);
    if (!modulePathMap) {
      return expect(!!modulePathMap).toEqual("modulePathMap is undefined");
    }
    // console.log(JSON.stringify(modulePathMap, null, 2));
    expect(
      getModulePathRange(
        '"getting-started"."subPages"."installation"',
        modulePathMap,
      ),
    ).toEqual({
      end: { character: 18, line: 10 },
      start: { character: 6, line: 10 },
    });
  });
});
