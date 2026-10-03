import { Internal, initVal } from "@valbuild/core";
import type { SerializedVideoSchema, SourcePath } from "@valbuild/core";
import {
  buildStreamEntryRenamePatches,
  buildStreamRenamePatch,
  localOfUri,
  readStream,
  streamDirectoryOf,
  type FetchedFile,
} from "./renameVideo";

const { s } = initVal();
const sha256 = Internal.getSHA256Hash;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function serialized(remote: boolean): SerializedVideoSchema {
  const schema = (remote ? s.video().remote() : s.video())[
    "executeSerialize"
  ]();
  if (schema.type !== "video") throw new Error("expected video");
  return schema;
}

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="a",URI="playlist-2.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360,AUDIO="a"
playlist-1.m3u8
`;
const MEDIA = (n: number) => `#EXTM3U
#EXT-X-MAP:URI="segments-${n}.mp4",BYTERANGE="10@0"
#EXTINF:2,
#EXT-X-BYTERANGE:20@10
segments-${n}.mp4
#EXT-X-ENDLIST
`;
const LOCAL: Record<string, string> = {
  "master.m3u8": MASTER,
  "playlist-1.m3u8": MEDIA(1),
  "playlist-2.m3u8": MEDIA(2),
  "segments-1.mp4": "video bytes",
  "segments-2.mp4": "audio bytes",
};
const DIR = "/public/val/intro_abcde";

/** Serves the stream the way a draft is served: every URI absolute, with a patch id. */
function draftServer(): (url: string) => Promise<FetchedFile> {
  return async (url) => {
    const name = new URL(url).pathname.split("/").pop() ?? "";
    let text = LOCAL[name];
    if (text === undefined) throw new Error(`404 ${url}`);
    if (name.endsWith(".m3u8")) {
      text = text.replace(
        /(URI=")?((?:playlist|segments)-\d\.(?:m3u8|mp4))/g,
        (_m, attr: string | undefined, file: string) =>
          `${attr ?? ""}/api/val/files${DIR}/${file}?patch_id=p1`,
      );
    }
    return {
      bytes: encoder.encode(text),
      mimeType: name.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp4",
    };
  };
}

describe("localOfUri", () => {
  test("relative, draft endpoint and remote ref all name a /public path", () => {
    expect(localOfUri("playlist-1.m3u8", `${DIR}/master.m3u8`)).toBe(
      `${DIR}/playlist-1.m3u8`,
    );
    expect(
      localOfUri(
        `http://localhost:3000/api/val/files${DIR}/segments-1.mp4?patch_id=x`,
        `${DIR}/playlist-1.m3u8`,
      ),
    ).toBe(`${DIR}/segments-1.mp4`);
    const ref = Internal.remote.createRemoteRef("https://remote.val.build", {
      publicProjectId: "p",
      coreVersion: "1",
      bucket: "b",
      validationHash: "abcd",
      fileHash: "0123456789ab",
      filePath: "public/val/intro_abcde/segments-2.mp4",
    });
    expect(localOfUri(ref, `${DIR}/playlist-2.m3u8`)).toBe(
      `${DIR}/segments-2.mp4`,
    );
    expect(localOfUri("https://elsewhere.example/x.mp4", DIR)).toBe(null);
  });
});

describe("streamDirectoryOf", () => {
  test("the master's own directory is the name", () => {
    expect(streamDirectoryOf(`${DIR}/master.m3u8`)).toEqual({
      parent: "/public/val",
      name: "intro_abcde",
    });
    expect(streamDirectoryOf("/public/master.m3u8")).toBe(null);
    expect(streamDirectoryOf("/public/val/clip.mp4")).toBe(null);
  });
});

describe("renaming a stream", () => {
  test("a draft is read back to relative playlists, and moved whole", async () => {
    const files = await readStream(
      `${DIR}/master.m3u8`,
      `/api/val/files${DIR}/master.m3u8?patch_id=p1`,
      draftServer(),
      "http://localhost:3000/val",
    );
    expect(Object.keys(files).sort()).toEqual(Object.keys(LOCAL).sort());
    for (const [name, text] of Object.entries(LOCAL)) {
      expect([name, decoder.decode(files[name].bytes)]).toEqual([name, text]);
    }

    const built = buildStreamRenamePatch({
      patchPath: ["hero"],
      masterPath: `${DIR}/master.m3u8`,
      newBase: "Team intro",
      files,
      schema: serialized(false),
      sha256,
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    expect(built.newPath).toBe("/public/val/teamintro_abcde/master.m3u8");
    expect(built.patch[0]).toEqual({
      op: "add",
      path: ["hero", "path"],
      value: "/public/val/teamintro_abcde/master.m3u8",
    });
    const fileOps = built.patch.flatMap((op) => (op.op === "file" ? [op] : []));
    const added = fileOps.filter((op) => op.value !== null);
    const deleted = fileOps.filter((op) => op.value === null);
    expect(added.map((op) => op.filePath).sort()).toEqual(
      Object.keys(LOCAL)
        .map((name) => `/public/val/teamintro_abcde/${name}`)
        .sort(),
    );
    // The old copy goes: a rename that left it would be a copy.
    expect(deleted.map((op) => op.filePath).sort()).toEqual(
      Object.keys(LOCAL)
        .map((name) => `${DIR}/${name}`)
        .sort(),
    );
    // Every op is filed at the FIELD, where the patch_id is stamped.
    expect(fileOps.every((op) => op.path.join("/") === "hero")).toBe(true);
  });

  test("a remote stream is re-placed with refs under the new directory", async () => {
    const remoteMaster = Internal.remote.createRemoteRef(
      "https://remote.val.build",
      {
        publicProjectId: "proj",
        coreVersion: "1.0.0",
        bucket: "b1",
        validationHash: "abcd",
        fileHash: "0123456789ab",
        filePath: "public/val/intro_abcde/master.m3u8",
      },
    );
    const files: Record<string, FetchedFile> = {};
    for (const [name, text] of Object.entries(LOCAL)) {
      files[name] = { bytes: encoder.encode(text), mimeType: "video/mp4" };
    }
    const built = buildStreamRenamePatch({
      patchPath: ["hero"],
      masterPath: remoteMaster,
      newBase: "outro",
      files,
      schema: serialized(true),
      sha256,
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const split = Internal.remote.splitRemoteRef(built.newPath);
    expect(split).toMatchObject({
      status: "success",
      projectId: "proj",
      bucket: "b1",
      filePath: "public/val/outro_abcde/master.m3u8",
    });
    const fileOps = built.patch.flatMap((op) => (op.op === "file" ? [op] : []));
    // Nothing is deleted remotely: the bytes are stored by hash.
    expect(fileOps.every((op) => op.value !== null && op.remote)).toBe(true);
  });

  test("the same name is no rename", () => {
    const files: Record<string, FetchedFile> = {
      "master.m3u8": { bytes: encoder.encode(MASTER), mimeType: "x" },
    };
    expect(
      buildStreamRenamePatch({
        patchPath: ["hero"],
        masterPath: `${DIR}/master.m3u8`,
        newBase: "intro",
        files,
        schema: serialized(false),
        sha256,
      }),
    ).toEqual({ status: "unchanged" });
  });
});

describe("renaming a stream that is an entry of a set", () => {
  test("the entry moves, and every field naming it follows", async () => {
    const files = await readStream(
      `${DIR}/master.m3u8`,
      `/api/val/files${DIR}/master.m3u8?patch_id=p1`,
      draftServer(),
      "http://localhost:3000/val",
    );
    const built = buildStreamEntryRenamePatches({
      setPatchPath: [],
      key: `${DIR}/master.m3u8`,
      existingKeys: [`${DIR}/master.m3u8`],
      newBase: "Team intro",
      files,
      schema: serialized(false),
      sha256,
      referrers: [
        {
          sourcePath: '/page.val.ts?p="hero"' as SourcePath,
          hasPatchId: false,
        },
        {
          sourcePath: '/other.val.ts?p="a".0."video"' as SourcePath,
          hasPatchId: true,
        },
      ],
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const newKey = "/public/val/teamintro_abcde/master.m3u8";
    expect(built.newPath).toBe(newKey);
    expect(built.primary[0]).toEqual({
      op: "move",
      from: [`${DIR}/master.m3u8`],
      path: [newKey],
    });
    const fileOps = built.primary.flatMap((op) =>
      op.op === "file" ? [op] : [],
    );
    // Uploaded at the moved entry, deleted at the old one.
    expect(
      fileOps
        .filter((op) => op.value !== null)
        .every((op) => op.path.join("/") === newKey),
    ).toBe(true);
    expect(
      fileOps
        .filter((op) => op.value === null)
        .map((op) => op.filePath)
        .sort(),
    ).toEqual(
      Object.keys(LOCAL)
        .map((name) => `${DIR}/${name}`)
        .sort(),
    );
    expect(built.referrers).toEqual([
      {
        moduleFilePath: "/page.val.ts",
        patch: [{ op: "add", path: ["hero", "path"], value: newKey }],
      },
      {
        moduleFilePath: "/other.val.ts",
        patch: expect.arrayContaining([
          { op: "add", path: ["a", "0", "video", "path"], value: newKey },
        ]),
      },
    ]);
    // A draft referrer gets the files again, under the new names.
    expect(
      built.referrers[1].patch.filter((op) => op.op === "file"),
    ).toHaveLength(Object.keys(LOCAL).length);
  });

  test("a rename onto a key the set already has is refused", async () => {
    const files = await readStream(
      `${DIR}/master.m3u8`,
      `/api/val/files${DIR}/master.m3u8?patch_id=p1`,
      draftServer(),
      "http://localhost:3000/val",
    );
    const taken = "/public/val/outro_abcde/master.m3u8";
    const built = buildStreamEntryRenamePatches({
      setPatchPath: [],
      key: `${DIR}/master.m3u8`,
      existingKeys: [`${DIR}/master.m3u8`, taken],
      newBase: "outro",
      files,
      schema: serialized(false),
      sha256,
      referrers: [],
    });
    expect(built.status).toBe("error");
  });
});
