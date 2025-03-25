const RegEx =
  /^(https?:\/\/[^/]+)\/file\/p\/([^/]+)\/b\/([^/]+)\/v\/([^/]+)\/h\/([^/]+)\/f\/([^/]+)\/p\/(.+)$/;

export function splitRemoteRef(ref: string):
  | {
      status: "success";
      remoteHost: string;
      bucket: string;
      projectId: string;
      version: string;
      validationHash: string;
      fileHash: string;
      filePath: `public/val/${string}`;
    }
  | {
      status: "error";
      error: string;
    } {
  const match = ref.match(RegEx);
  if (!match) {
    return {
      status: "error",
      error: "Invalid remote ref: " + ref,
    };
  }
  if (match[7].indexOf("public/val/") !== 0) {
    return {
      status: "error",
      error: "Invalid remote ref: " + ref,
    };
  }

  return {
    status: "success",
    remoteHost: match[1],
    projectId: match[2],
    bucket: match[3],
    version: match[4],
    validationHash: match[5],
    fileHash: match[6],
    filePath: match[7] as `public/val/${string}`,
  };
}
