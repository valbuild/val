import { splitRemoteRef } from "./splitRemoteRef";

describe("splitRemoteRef", () => {
  it("should return success with parsed values for a valid remote ref", () => {
    const ref =
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/path/to/file.txt";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "https://remote.val.build",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "path/to/file.txt",
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
      "https://remote.val.build/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/dir/subdir/file.txt";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "https://remote.val.build",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "dir/subdir/file.txt",
    });
  });

  it("should handle a remote ref with an HTTP host", () => {
    const ref =
      "http://example.com/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/file.txt";
    const result = splitRemoteRef(ref);

    expect(result).toEqual({
      status: "success",
      remoteHost: "http://example.com",
      projectId: "project123",
      bucket: "01",
      version: "1.0.0",
      validationHash: "abc123",
      fileHash: "def456",
      filePath: "file.txt",
    });
  });
});
