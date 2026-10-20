import { createRemoteRef } from "../source/remote";
import { splitRemoteRef } from "./splitRemoteRef";

describe("splitRemoteRef", () => {
  it("should return success with parsed values for a valid remote ref", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "https://remote.val.build",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "public/val/test.png",
    });
  });

  it("should return an error for an invalid remote ref", () => {
    const ref = "invalid-remote-ref";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "error",
      error: "Invalid remote ref: " + ref,
    });
  });

  it("should return an error if the remote ref is missing required parts", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01//v/1.0.0/h/abc123/f/def456";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "error",
      error: "Invalid remote ref: " + ref,
    });
  });

  it("should handle a remote ref with a complex file path", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/dir/subdir/file.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "https://remote.val.build",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "public/val/dir/subdir/file.png",
    });
  });

  it("should handle a file path directly under public", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/images/test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "https://remote.val.build",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "public/images/test.png",
    });
  });

  it("should return an error if the file path is not within public", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/secret/test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "error",
      error: "Invalid remote ref: " + ref,
    });
  });

  it("should return an error if the file path traverses out of public", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/../secret/test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "error",
      error: "Invalid remote ref: " + ref,
    });
  });

  it("should return an error if the file path contains a current dir segment", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/./test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "error",
      error: "Invalid remote ref: " + ref,
    });
  });

  it("should not confuse a file name containing dots with traversal", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/..hidden..test.png";
    const result = splitRemoteRef(ref);

    expect(result).toMatchObject({
      status: "success",
      filePath: "public/val/..hidden..test.png",
    });
  });

  it("should return an error for a local ref", () => {
    const ref = "/public/val/test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "error",
      error: "Not a remote ref: " + ref,
    });
  });

  it("should handle a remote ref with an HTTP host", () => {
    const ref =
      "http://example.com/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/test.png";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "http://example.com",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "public/val/test.png",
    });
  });

  it("keeps a platform host's /_val prefix in the host, so the ref round-trips", () => {
    const ref =
      "https://www.acme.no/_val/file/p/3f9a2c1/b/r2/v/0.136.2/h/9c41/f/3fa9c81be402/p/public/val/hero_3fa9c.jpg";
    const res = splitRemoteRef(ref);
    expect(res).toEqual({
      status: "success",
      remoteHost: "https://www.acme.no/_val",
      projectId: "3f9a2c1",
      bucket: "r2",
      version: "0.136.2",
      validationHash: "9c41",
      fileHash: "3fa9c81be402",
      filePath: "public/val/hero_3fa9c.jpg",
    });
    if (res.status !== "success") return;
    expect(
      createRemoteRef(res.remoteHost, {
        publicProjectId: res.projectId,
        coreVersion: res.version,
        bucket: res.bucket,
        validationHash: res.validationHash,
        fileHash: res.fileHash,
        filePath: res.filePath,
      }),
    ).toBe(ref);
  });

  it("does not take any other path segment as part of the host", () => {
    expect(
      splitRemoteRef(
        "https://www.acme.no/cdn/file/p/3f9a2c1/b/r2/v/1/h/9c41/f/3fa9c81be402/p/public/val/a.jpg",
      ).status,
    ).toBe("error");
  });
});
