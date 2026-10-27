import { readCommittedBinaryFiles } from "./readCommittedBinaryFiles";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const ops = (files: Record<string, Buffer | null | Error>) => {
  const asked: string[] = [];
  return {
    asked,
    async getBase64EncodedBinaryFileFromPatch(filePath: string) {
      asked.push(filePath);
      const file = files[filePath];
      if (file instanceof Error) throw file;
      return file ?? null;
    },
  };
};

describe("readCommittedBinaryFiles", () => {
  test("a local file's bytes come back as base64", async () => {
    await expect(
      readCommittedBinaryFiles(ops({ "/public/val/a.png": png }), {
        "/public/val/a.png": { patchId: "p1", remote: false },
      }),
    ).resolves.toEqual({
      files: { "/public/val/a.png": png.toString("base64") },
      unread: [],
    });
  });

  test("a remote file is not read at all", async () => {
    const reader = ops({});
    const out = await readCommittedBinaryFiles(reader, {
      "/public/val/r.png": { patchId: "p1", remote: true },
    });
    expect(out).toEqual({ files: {}, unread: [] });
    expect(reader.asked).toEqual([]);
  });

  test("one that cannot be read is named, not dropped", async () => {
    const out = await readCommittedBinaryFiles(
      ops({ "/public/val/b.png": null, "/public/val/c.png": new Error("x") }),
      {
        "/public/val/c.png": { patchId: "p1", remote: false },
        "/public/val/b.png": { patchId: "p1", remote: false },
      },
    );
    expect(out.files).toEqual({});
    expect(out.unread).toEqual(["/public/val/b.png", "/public/val/c.png"]);
  });
});
