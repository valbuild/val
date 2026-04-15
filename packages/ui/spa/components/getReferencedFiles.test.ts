import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import { getReferencedFiles } from "./getReferencedFiles";

const { s, c } = initVal();

describe("getReferencedFiles", () => {
  test("find image field referencing module", () => {
    const imagesModule = c.define(
      "/images.val.ts",
      s.images({ accept: "image/*", directory: "/public/val" }),
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
        img: c.image("/public/val/img.png", {
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
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
      s.images({ accept: "image/*", directory: "/public/val" }),
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
        img: c.image("/public/val/img.png", {
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
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
      s.images({ accept: "image/*", directory: "/public/val" }),
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
        img: c.image("/public/val/img.png", {
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
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
      s.images({ accept: "image/*", directory: "/public/val" }),
      {},
    );
    const imagesModule2 = c.define(
      "/images2.val.ts",
      s.images({ accept: "image/*", directory: "/public/val" }),
      {},
    );
    const pageModule = c.define(
      "/page.val.ts",
      s.object({ img: s.image(imagesModule1) }),
      {
        img: c.image("/public/val/img.png", {
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
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
      s.files({ accept: "*/*", directory: "/public/val" }),
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
        doc: c.file("/public/val/doc.pdf", { mimeType: "application/pdf" }),
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
      s.images({ accept: "image/*", directory: "/public/val" }),
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
              img: c.image("/public/val/img.png", {
                width: 100,
                height: 100,
                mimeType: "image/png",
              }),
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
