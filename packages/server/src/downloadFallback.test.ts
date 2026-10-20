import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { Internal } from "@valbuild/core";

/**
 * Tooling's fallback download: a platform ref whose host fails is read from
 * the project's own `valstart.dev` address, and kept only if the bytes hash to
 * what the ref names. `fallbackRefOf` is pointed at a second local server,
 * since the real fallback is on the internet.
 */
let mockFallbackHost = "";
jest.mock("./remoteHostCheck", () => {
  const actual = jest.requireActual("./remoteHostCheck");
  return {
    ...actual,
    fallbackRefOf: (ref: string) =>
      ref.startsWith("http://127.0.0.1:9/_val")
        ? ref.replace("http://127.0.0.1:9/_val", `${mockFallbackHost}/_val`)
        : null,
  };
});

import { downloadFileFromRemote } from "./checkRemoteRef";

const BYTES = Buffer.from("the right bytes");
const FILE_HASH = Internal.remote.getFileHash(BYTES);
/** On a host nothing listens on: the ref's own host has gone. */
const REF = `http://127.0.0.1:9/_val/file/p/3f9a2c1/b/r2/v/1.0.0/h/9c41/f/${FILE_HASH}/p/public/val/a.txt`;

describe("downloadFileFromRemote's fallback", () => {
  let server: http.Server;
  let serves: Buffer;
  let dir: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200).end(serves);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("the test server has no port");
    }
    mockFallbackHost = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    serves = BYTES;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-fallback-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("a ref whose host is gone is read from the fallback", async () => {
    const target = path.join(dir, "a.txt");
    await expect(downloadFileFromRemote(REF, target)).resolves.toEqual({
      status: "success",
      filePath: target,
    });
    expect(fs.readFileSync(target)).toEqual(BYTES);
  });

  test("bytes from the fallback that are not the file are not kept", async () => {
    serves = Buffer.from("something else");
    const target = path.join(dir, "a.txt");
    await expect(downloadFileFromRemote(REF, target)).rejects.toThrow(
      "is not the one the ref names",
    );
    expect(fs.existsSync(target)).toBe(false);
  });

  test("a ref with no fallback reports its own host's failure", async () => {
    const remote = REF.replace("/_val", "");
    await expect(
      downloadFileFromRemote(remote, path.join(dir, "a.txt")),
    ).rejects.toThrow("127.0.0.1:9");
  });
});
