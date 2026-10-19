import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
  ValModule,
  initVal,
} from "@valbuild/core";
import { traverseSchemas } from "./traverseSchemas";

const { s, c } = initVal();

/*
 * The walk the Studio runs over every module to find referenced files and
 * keys (`getReferencedFiles`, `getKeysOf`). It runs on every change, so a
 * console error it reports is reported many times over.
 */
describe("traverseSchemas", () => {
  let errors: jest.SpyInstance;
  beforeEach(() => {
    errors = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errors.mockRestore();
  });

  test("a media directory's entries hold more than their schema names, and that is not reported", () => {
    // A default focal point on an image, and a poster, its time and a range
    // on a video: what the gallery keeps beside the fields it edits.
    const imagesModule = c.define(
      "/images.val.ts",
      s.imagedir("/public/val/images"),
      {
        "/public/val/images/night.svg": {
          width: 100,
          height: 100,
          mimeType: "image/svg+xml",
          alt: "Night",
          hotspot: { x: 0.5, y: 0.25 },
        },
      },
    );
    const videosModule = c.define(
      "/videos.val.ts",
      s.videodir("/public/val/videos"),
      {
        "/public/val/videos/dusk.mp4": {
          mimeType: "video/mp4",
          width: 1280,
          height: 640,
          duration: 8,
          alt: "Dusk",
          poster: {
            path: "/public/val/videos/dusk-poster.webp",
            width: 1280,
            height: 640,
            mimeType: "image/webp",
          },
          posterTime: 0,
          startTime: 1,
          endTime: 7,
        },
      },
    );
    const visited: SourcePath[] = [];
    const { schemas, sources } = getTestData([imagesModule, videosModule]);
    traverseSchemas(schemas, sources, (path) => visited.push(path));

    expect(errors).not.toHaveBeenCalled();
    // The fields the schema does name are still visited.
    expect(visited).toContain(
      '/images.val.ts?p="/public/val/images/night.svg"."alt"',
    );
    expect(visited).toContain(
      '/videos.val.ts?p="/public/val/videos/dusk.mp4"."duration"',
    );
  });

  test("anywhere else, a value with no schema is still reported", () => {
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ title: s.string() }),
      { title: "Home" },
    );
    const { schemas, sources } = getTestData([pageModule]);
    traverseSchemas(
      schemas,
      {
        ...sources,
        ["/page.val.ts" as ModuleFilePath]: { title: "Home", stray: "x" },
      },
      () => {},
    );
    expect(errors).toHaveBeenCalledWith(
      'Schema not found for /page.val.ts?p="stray"',
    );
  });
});

function getTestData(valModules: ValModule<Source>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of valModules) {
    const moduleFilePath = Internal.getValPath(
      valModule,
    ) as unknown as ModuleFilePath;
    const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
    const source = Internal.getSource(valModule);
    if (!schema || source === undefined) {
      throw new Error(`${moduleFilePath} has no schema or source`);
    }
    schemas[moduleFilePath] = schema;
    sources[moduleFilePath] = source;
  }
  return { schemas, sources };
}
