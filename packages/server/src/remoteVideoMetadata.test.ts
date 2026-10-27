import fs from "fs";
import path from "path";
import { Internal } from "@valbuild/core";
import { extractVideoMetadataFromFile } from "./extractMetadata";
import {
  extractVideoMetadataFromUrl,
  nameForTypeOf,
  type RangeFetch,
} from "./remoteVideoMetadata";

/** The fixtures `extractMetadata.test.ts` describes. */
const fixtures = path.join(__dirname, "__fixtures__", "video");
const read = (name: string) => fs.readFileSync(path.join(fixtures, name));

/**
 * A content host serving `files` by URL, the way Val Remote's `/file/...`
 * route does: a single `bytes=` range answered with a 206 and a
 * `Content-Range`, anything else with the whole file. Records every request.
 */
function host(
  files: Record<string, Buffer | string>,
  { ignoreRanges = false }: { ignoreRanges?: boolean } = {},
) {
  const requests: { url: string; range: string | undefined }[] = [];
  const fetchImpl: RangeFetch = async (url, init) => {
    const range = init.headers.Range;
    requests.push({ url, range });
    const file = files[url];
    if (file === undefined) {
      return new Response("not found", { status: 404 });
    }
    const bytes = typeof file === "string" ? Buffer.from(file) : file;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (ignoreRanges || !match) {
      return new Response(new Uint8Array(bytes), { status: 200 });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      },
    });
  };
  return { fetchImpl, requests };
}

/** A top-level box: 32-bit size, type, payload. */
function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function topLevelBoxes(file: Buffer): { type: string; bytes: Buffer }[] {
  const boxes: { type: string; bytes: Buffer }[] = [];
  for (let offset = 0; offset + 8 <= file.length; ) {
    const size = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    boxes.push({ type, bytes: file.subarray(offset, offset + size) });
    offset += size;
  }
  return boxes;
}

const URL_OF = "https://remote.val.build/file/p/proj/b/01/v/1.0.0/h/abcd";

describe("extractVideoMetadataFromUrl", () => {
  test("reads what the file on disk reads, in one request when moov comes first", async () => {
    const { fetchImpl, requests } = host({
      [`${URL_OF}/tiny.mp4`]: read("tiny.mp4"),
    });
    expect(
      await extractVideoMetadataFromUrl(
        `${URL_OF}/tiny.mp4`,
        "/public/val/tiny.mp4",
        fetchImpl,
      ),
    ).toEqual(
      await extractVideoMetadataFromFile(path.join(fixtures, "tiny.mp4")),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].range).toBe("bytes=0-65535");
  });

  test("a large file with moov at the end: the frames are skipped, not fetched", async () => {
    // `tiny.mov` with its frames grown to 4 MB: `moov` is now 4 MB in.
    const mov = read("tiny.mov");
    const grown = Buffer.concat(
      topLevelBoxes(mov).map(({ type, bytes }) =>
        type === "mdat" ? box("mdat", Buffer.alloc(4 * 1024 * 1024)) : bytes,
      ),
    );
    expect(topLevelBoxes(grown).map(({ type }) => type)).toContain("moov");
    expect(topLevelBoxes(grown).at(-1)?.type).toBe("moov");
    const { fetchImpl, requests } = host({ [`${URL_OF}/big.mov`]: grown });
    expect(
      await extractVideoMetadataFromUrl(
        `${URL_OF}/big.mov`,
        "/public/val/big.mov",
        fetchImpl,
      ),
    ).toEqual(
      await extractVideoMetadataFromFile(path.join(fixtures, "tiny.mov")),
    );
    // The start, then the box past the frames.
    expect(requests.length).toBeLessThanOrEqual(3);
    const fetched = requests
      .map(({ range }) => /bytes=(\d+)-(\d+)/.exec(range ?? ""))
      .reduce(
        (sum, m) => sum + (m ? Number(m[2]) - Number(m[1]) + 1 : Infinity),
        0,
      );
    expect(fetched).toBeLessThan(grown.length / 10);
  });

  test("a webm", async () => {
    const { fetchImpl } = host({ [`${URL_OF}/tiny.webm`]: read("tiny.webm") });
    expect(
      await extractVideoMetadataFromUrl(
        `${URL_OF}/tiny.webm`,
        "/public/val/tiny.webm",
        fetchImpl,
      ),
    ).toEqual({ mimeType: "video/webm", width: 64, height: 48, duration: 1 });
  });

  test("a server that ignores Range: the whole file answers every read", async () => {
    const { fetchImpl, requests } = host(
      { [`${URL_OF}/tiny.mov`]: read("tiny.mov") },
      { ignoreRanges: true },
    );
    expect(
      await extractVideoMetadataFromUrl(
        `${URL_OF}/tiny.mov`,
        "/public/val/tiny.mov",
        fetchImpl,
      ),
    ).toEqual(
      await extractVideoMetadataFromFile(path.join(fixtures, "tiny.mov")),
    );
    expect(requests).toHaveLength(1);
  });

  test("an HLS stream on Val Remote: the master, and the first media playlist it names by ref", async () => {
    const media = `${URL_OF}/f/1/p/public/val/s_12345/playlist-1.m3u8`;
    const master = `${URL_OF}/f/0/p/public/val/s_12345/master.m3u8`;
    const { fetchImpl, requests } = host({
      [master]: `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720
${media}
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360
${URL_OF}/f/2/p/public/val/s_12345/playlist-2.m3u8
`,
      [media]: `#EXTM3U
#EXTINF:6.0,
segments-1.mp4
#EXTINF:6.0,
segments-1.mp4
#EXTINF:2.5,
segments-1.mp4
#EXT-X-ENDLIST
`,
    });
    expect(
      await extractVideoMetadataFromUrl(
        master,
        "/public/val/s_12345/master.m3u8",
        fetchImpl,
      ),
    ).toEqual({
      mimeType: "application/vnd.apple.mpegurl",
      width: 1280,
      height: 720,
      duration: 14.5,
    });
    expect(requests.map(({ url }) => url)).toEqual([master, media]);
  });

  test("a file that is not there is an error, not empty metadata", async () => {
    const { fetchImpl } = host({});
    await expect(
      extractVideoMetadataFromUrl(
        `${URL_OF}/gone.mp4`,
        "/public/val/gone.mp4",
        fetchImpl,
      ),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("nameForTypeOf", () => {
  test("a remote ref is named by the /public path inside it", () => {
    const ref = Internal.remote.createRemoteRef("https://remote.val.build", {
      publicProjectId: "proj",
      coreVersion: "1.0.0",
      bucket: "01",
      validationHash: "abcd",
      fileHash: "0123456789ab",
      filePath: "public/val/intro_12345/master.m3u8",
    });
    expect(nameForTypeOf(ref)).toBe("/public/val/intro_12345/master.m3u8");
  });
});
