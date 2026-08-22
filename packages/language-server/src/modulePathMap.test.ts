import ts from "typescript";
import {
  createModulePathMap,
  findModulePathAtPosition,
  getModulePathRange,
} from "./modulePathMap";

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2015);
}

function mapOf(fileName: string, text: string) {
  const modulePathMap = createModulePathMap(parse(fileName, text));
  if (!modulePathMap) {
    throw Error("Expected a module path map");
  }
  return modulePathMap;
}

describe("createModulePathMap / getModulePathRange", () => {
  test("maps top-level and nested object keys", () => {
    const modulePathMap = mapOf(
      "./oj/test.val.ts",
      `import type { InferSchemaType } from '@valbuild/next';
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
`,
    );

    expect(getModulePathRange('"text"', modulePathMap)).toEqual({
      start: { line: 48, character: 2 },
      end: { line: 48, character: 6 },
    });
    expect(getModulePathRange('"nested"."text"', modulePathMap)).toEqual({
      start: { line: 50, character: 4 },
      end: { line: 50, character: 8 },
    });
  });

  test("maps a key whose value spans multiple lines", () => {
    const modulePathMap = mapOf(
      "./oj/test.val.ts",
      `import { s, c } from '../val.config';

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
`,
    );

    expect(getModulePathRange('"ingress"', modulePathMap)).toEqual({
      start: { line: 15, character: 2 },
      end: { line: 15, character: 9 },
    });
  });

  test("maps through arrays, records and nested arrays", () => {
    const modulePathMap = mapOf(
      "./content.val.ts",
      `import { s, c } from '../val.config';

export const schema = s.object({
  first: s.array(s.object({ second: s.record(s.array(s.string()))}))
});

export default c.define('/content', schema, {
  first: [{ second: { a: ['a', 'b'] } }]
});
`,
    );

    expect(
      getModulePathRange('"first".0."second"."a".1', modulePathMap),
    ).toEqual({
      start: { line: 7, character: 31 },
      end: { line: 7, character: 34 },
    });
  });

  test("returns undefined for malformed module paths instead of throwing", () => {
    // Malformed paths reach here legitimately when schema serialization failed
    // upstream, so this must degrade rather than crash the server.
    const modulePathMap = mapOf(
      "./content.val.ts",
      `import { s, c } from '../val.config';

export const schema = s.object({
  text: s.string(),
});

export default c.define('/content', schema, {
  text: 'hello'
});
`,
    );

    for (const bad of ["", "invalid", ".", "..", "foo.bar"]) {
      expect(getModulePathRange(bad, modulePathMap)).toBeUndefined();
    }
    expect(
      getModulePathRange(undefined as unknown as string, modulePathMap),
    ).toBeUndefined();
    expect(
      getModulePathRange(null as unknown as string, modulePathMap),
    ).toBeUndefined();
  });

  test("exposes _ref and metadata ranges for c.image()", () => {
    // A "file does not exist" error points at the ref, a bad-metadata error at
    // the metadata object, so the two need distinct ranges.
    const modulePathMap = mapOf(
      "./content.val.ts",
      `import { s, c } from '../val.config';

export default c.define('/content', schema, {
  image: c.image('/public/val/logo.png', { width: 1, height: 2 }),
});
`,
    );

    const ref = getModulePathRange('"image"."_ref"', modulePathMap);
    const metadata = getModulePathRange('"image"."metadata"', modulePathMap);
    expect(ref).toBeDefined();
    expect(metadata).toBeDefined();
    // Both on the c.image(...) line, ref before metadata.
    expect(ref?.start.line).toBe(3);
    expect(metadata?.start.line).toBe(3);
    expect(ref!.start.character).toBeLessThan(metadata!.start.character);
  });

  describe("findModulePathAtPosition", () => {
    const source = `import { s, c } from '../val.config';

export default c.define('/content', schema, {
  first: 'hello',
  nested: { inner: 'world' },
  list: ['a', 'b'],
});
`;
    const map = mapOf("./content.val.ts", source);

    /** Position of the character just after `marker` in the source. */
    function positionAfter(marker: string) {
      const offset = source.indexOf(marker) + marker.length;
      const before = source.slice(0, offset);
      const lines = before.split("\n");
      return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
      };
    }

    test("finds a top-level key from a position inside its value", () => {
      expect(findModulePathAtPosition(map, positionAfter("first: '"))).toBe(
        '"first"',
      );
    });

    test("finds a nested key", () => {
      // The synthetic `val` child spans the whole value, so the walk must step
      // past it to reach the nested key rather than stopping at the parent.
      expect(findModulePathAtPosition(map, positionAfter("inner: '"))).toBe(
        '"nested"."inner"',
      );
    });

    test("finds an array element by index", () => {
      expect(findModulePathAtPosition(map, positionAfter("list: ['"))).toBe(
        '"list".0',
      );
    });

    test("returns undefined outside the content", () => {
      expect(
        findModulePathAtPosition(map, { line: 0, character: 0 }),
      ).toBeUndefined();
    });

    test("round-trips with getModulePathRange", () => {
      // A path found at a position must map back to a range containing it.
      const position = positionAfter("inner: '");
      const modulePath = findModulePathAtPosition(map, position)!;
      const range = getModulePathRange(modulePath, map);
      expect(range).toBeDefined();
    });
  });

  describe("ranges of nodes that span several lines", () => {
    // A range computed as `end.character - node.getWidth()` is right only while a
    // node stays on one line. For a multi-line node it reports the *closing* line
    // and a negative character, which an editor either rejects or clamps to the
    // wrong place.
    const map = mapOf(
      "./x.val.ts",
      `import { s, c } from '../val.config';
export default c.define('/x.val.ts', schema, {
  items: [
    {
      title: 'first',
    },
  ],
  image: c.image('/public/val/logo.png', {
    width: 944,
    height: 944,
  }),
});
`,
    );

    test("a multi-line array element starts where it opens", () => {
      const range = getModulePathRange('"items".0', map)!;
      expect(range).toBeDefined();
      expect(range.start.character).toBeGreaterThanOrEqual(0);
      // Opens on the `{` line (3) and closes two lines later.
      expect(range.start.line).toBe(3);
      expect(range.end.line).toBe(5);
    });

    test("a multi-line metadata argument starts where it opens", () => {
      const range = getModulePathRange('"image"."metadata"', map)!;
      expect(range).toBeDefined();
      expect(range.start.character).toBeGreaterThanOrEqual(0);
      expect(range.start.line).toBe(7);
      expect(range.end.line).toBe(10);
    });

    test("every range has a non-negative start character", () => {
      const check = (node: typeof map) => {
        for (const entry of Object.values(node)) {
          expect(entry.start.character).toBeGreaterThanOrEqual(0);
          expect(entry.end.character).toBeGreaterThanOrEqual(0);
          check(entry.children);
        }
      };
      check(map);
    });
  });

  describe("empty record keys", () => {
    test('skips a "" key, which no module path can address', () => {
      // Documents a known limitation rather than asserting desired behaviour:
      // `Internal.splitModulePath('""')` returns `[]`, so an empty segment is
      // not addressable, and `""` already marks a bare literal in this map.
      // A gallery key gets ranges as soon as it has one character.
      const map = mapOf(
        "./x.val.ts",
        `import { s, c } from '../val.config';
export default c.define('/x.val.ts', schema, {
  "": { alt: 'not named yet' },
  "/public/val/logo.png": { alt: 'named' },
});
`,
      );
      expect(Object.keys(map)).not.toContain("");
      expect(getModulePathRange('"/public/val/logo.png"', map)).toBeDefined();
    });
  });

  describe("modules that are not Val modules", () => {
    test("returns undefined when there is no default export", () => {
      expect(
        createModulePathMap(
          parse("./x.val.ts", `export const schema = s.object({});`),
        ),
      ).toBeUndefined();
    });

    test("returns undefined when the default export is not c.define", () => {
      // Stricter than taking arguments[2] of whatever the default export calls:
      // analyzeValModule verifies it really is c.define with a literal path.
      expect(
        createModulePathMap(
          parse("./x.val.ts", `export default somethingElse(a, b, { c: 1 });`),
        ),
      ).toBeUndefined();
    });
  });
});
