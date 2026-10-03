import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import { getFileReferrers, getReferencedFiles } from "./getReferencedFiles";

const { s, c } = initVal();

describe("getReferencedFiles", () => {
  test("find a set-backed video field naming an entry of the set", () => {
    const videosModule = c.define(
      "/videos.val.ts",
      s.videoset({ dir: "/public/val/videos" }),
      {
        "/public/val/videos/intro_51df2.mp4": {
          mimeType: "video/mp4",
          width: 1280,
          height: 720,
          duration: 12.5,
          alt: null,
        },
        "/public/val/videos/other_12345.mp4": {
          mimeType: "video/mp4",
          width: 1280,
          height: 720,
          duration: 3,
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ intro: s.video(videosModule) }),
      {
        intro: { path: "/public/val/videos/intro_51df2.mp4", startTime: 1 },
      },
    );
    const { schemas, sources } = getTestData([videosModule, pageModule]);
    expect(
      getReferencedFiles(
        schemas,
        sources,
        "/videos.val.ts" as ModuleFilePath,
        "/public/val/videos/intro_51df2.mp4",
      ),
    ).toEqual(['/page.val.ts?p="intro"']);
    // The other entry is used by nothing, so it can be deleted.
    expect(
      getReferencedFiles(
        schemas,
        sources,
        "/videos.val.ts" as ModuleFilePath,
        "/public/val/videos/other_12345.mp4",
      ),
    ).toEqual([]);
  });

  test("find image field referencing module", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {
        "/public/val/img.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule) }),
      {
        img: { path: "/public/val/img.png" },
      },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    const result = getReferencedFiles(
      schemas,
      sources,
      "/images.val.ts" as ModuleFilePath,
    );
    expect(result).toEqual(['/page.val.ts?p="img"']);
  });

  test("filter by fileRef (match)", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {
        "/public/val/img.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule) }),
      {
        img: { path: "/public/val/img.png" },
      },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    const result = getReferencedFiles(
      schemas,
      sources,
      "/images.val.ts" as ModuleFilePath,
      "/public/val/img.png",
    );
    expect(result).toEqual(['/page.val.ts?p="img"']);
  });

  test("filter by fileRef (no match)", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {
        "/public/val/img.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule) }),
      {
        img: { path: "/public/val/img.png" },
      },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    const result = getReferencedFiles(
      schemas,
      sources,
      "/images.val.ts" as ModuleFilePath,
      "/public/val/other.png",
    );
    expect(result).toEqual([]);
  });

  test("no match when different module", () => {
    const imagesModule1 = c.define(
      "/images1.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {},
    );
    const imagesModule2 = c.define(
      "/images2.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {},
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule1) }),
      {
        img: { path: "/public/val/img.png" },
      },
    );
    const { schemas, sources } = getTestData([
      imagesModule1,
      imagesModule2,
      pageModule,
    ]);
    const result = getReferencedFiles(
      schemas,
      sources,
      "/images2.val.ts" as ModuleFilePath,
    );
    expect(result).toEqual([]);
  });

  test("find file field referencing module", () => {
    const filesModule = c.define(
      "/files.val.ts",
      s.fileset({ accept: "*/*", dir: "/public/val" }),
      {
        "/public/val/doc.pdf": {
          mimeType: "application/pdf",
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ doc: s.file(filesModule) }),
      {
        doc: { path: "/public/val/doc.pdf" },
      },
    );
    const { schemas, sources } = getTestData([filesModule, pageModule]);
    const result = getReferencedFiles(
      schemas,
      sources,
      "/files.val.ts" as ModuleFilePath,
    );
    expect(result).toEqual(['/page.val.ts?p="doc"']);
  });

  test("find nested image field", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {
        "/public/val/img.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({
        section: s.object({
          items: s.array(
            s.object({
              img: s.image(imagesModule),
            }),
          ),
        }),
      }),
      {
        section: {
          items: [
            {
              img: { path: "/public/val/img.png" },
            },
          ],
        },
      },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    const result = getReferencedFiles(
      schemas,
      sources,
      "/images.val.ts" as ModuleFilePath,
    );
    expect(result).toEqual(['/page.val.ts?p="section"."items".0."img"']);
  });

  test("finds gallery images inside rich text, however deep", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {
        "/public/val/img.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
        "/public/val/other.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ body: s.richtext({ ul: true, img: s.image(imagesModule) }) }),
      {
        body: [
          {
            tag: "p",
            children: [
              "Before ",
              { tag: "img", src: { path: "/public/val/img.png" } },
            ],
          },
          {
            tag: "ul",
            children: [
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      { tag: "img", src: { path: "/public/val/other.png" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    expect(
      getReferencedFiles(
        schemas,
        sources,
        "/images.val.ts" as ModuleFilePath,
        "/public/val/img.png",
      ),
    ).toEqual(['/page.val.ts?p="body".0."children".1."src"']);
    expect(
      getReferencedFiles(
        schemas,
        sources,
        "/images.val.ts" as ModuleFilePath,
        "/public/val/other.png",
      ),
    ).toEqual([
      '/page.val.ts?p="body".1."children".0."children".0."children".0."src"',
    ]);
  });

  test("ignores rich text whose images are not from the gallery", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }),
      {},
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ body: s.richtext({ img: s.image() }) }),
      {
        body: [
          {
            tag: "p",
            children: [
              {
                tag: "img",
                src: {
                  path: "/public/val/img.png",
                  width: 1,
                  height: 1,
                  mimeType: "image/png",
                },
              },
            ],
          },
        ],
      },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    expect(
      getReferencedFiles(schemas, sources, "/images.val.ts" as ModuleFilePath),
    ).toEqual([]);
  });

  test("a remote ref that is itself a key does not also match the local path inside it", () => {
    // A gallery holding BOTH shapes for one file: the field uses the full-ref
    // entry, so renaming or deleting the local-path entry must not touch it.
    const ref = Internal.remote.createRemoteRef("https://remote.val.build", {
      publicProjectId: "p",
      coreVersion: "0.1.0",
      bucket: "b",
      validationHash: "abcd",
      fileHash: "bfbd0a1b2c3d",
      filePath: "public/val/img.png",
    });
    const entry = {
      width: 100,
      height: 100,
      mimeType: "image/png",
      alt: null,
    };
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }).remote(),
      { "/public/val/img.png": entry, [ref]: entry },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule) }),
      { img: { path: ref } },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    const gallery = "/images.val.ts" as ModuleFilePath;
    expect(
      getReferencedFiles(schemas, sources, gallery, "/public/val/img.png"),
    ).toEqual([]);
    expect(getReferencedFiles(schemas, sources, gallery, ref)).toEqual([
      '/page.val.ts?p="img"',
    ]);
  });

  test("matches a remote ref filed under the local path inside it", () => {
    // An upload through an `s.image(remoteGallery)` field: the field holds the
    // ref, the gallery entry is keyed by the path in it.
    const ref = Internal.remote.createRemoteRef("https://remote.val.build", {
      publicProjectId: "p",
      coreVersion: "0.1.0",
      bucket: "b",
      validationHash: "abcd",
      fileHash: "bfbd0a1b2c3d",
      filePath: "public/val/img.png",
    });
    const imagesModule = c.define(
      "/images.val.ts",
      s.imageset({ accept: "image/*", dir: "/public/val" }).remote(),
      {
        "/public/val/img.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: null,
        },
      },
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule) }),
      { img: { path: ref } },
    );
    const { schemas, sources } = getTestData([imagesModule, pageModule]);
    expect(
      getFileReferrers(
        schemas,
        sources,
        "/images.val.ts" as ModuleFilePath,
        "/public/val/img.png",
      ),
    ).toEqual([
      { sourcePath: '/page.val.ts?p="img"', path: ref, hasPatchId: false },
    ]);
  });
});

function getTestData(valModules: ValModule<Source>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of valModules) {
    const moduleFilePath = getModuleFilePath(valModule);
    schemas[moduleFilePath] = getSchema(valModule);
    sources[moduleFilePath] = getSource(valModule);
  }
  return { schemas, sources };
}

function getModuleFilePath(valModule: ValModule<Source>): ModuleFilePath {
  return Internal.getValPath(valModule) as unknown as ModuleFilePath;
}

function getSchema(valModule: ValModule<Source>): SerializedSchema {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) {
    throw new Error("Schema not found");
  }
  return schema;
}

function getSource(valModule: ValModule<Source>): Source {
  const source = Internal.getSource(valModule);
  if (!source) {
    throw new Error("Source not found");
  }
  return source;
}
