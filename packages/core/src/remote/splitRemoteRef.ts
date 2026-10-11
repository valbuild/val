/**
 * The host part may carry a `/_val` prefix: a ref served by the platform
 * loader names `https://www.acme.no/_val/file/…`, because a customer's site
 * can have a `/file/…` route of its own. The prefix is part of `remoteHost`,
 * so `createRemoteRef(remoteHost, …)` writes it back unchanged. See valbuild/home
 * `docs/remote-files-on-platform.md`, "The ref".
 */
const RegEx =
  /^(https?:\/\/[^/]+(?:\/_val)?)\/file\/p\/([^/]+)\/b\/([^/]+)\/v\/([^/]+)\/h\/([^/]+)\/f\/([^/]+)\/p\/(.+)$/;

export function splitRemoteRef(ref: string):
  | {
      status: "success";
      remoteHost: string;
      bucket: string;
      projectId: string;
      version: string;
      validationHash: string;
      fileHash: string;
      filePath: `public/${string}`;
    }
  | {
      status: "error";
      error: string;
    } {
  if (ref[0] === "/") {
    return {
      status: "error",
      error: "Not a remote ref: " + ref,
    };
  }
  const match = ref.match(RegEx);
  if (!match) {
    return {
      status: "error",
      error: "Invalid remote ref: " + ref,
    };
  }
  if (match[7].indexOf("public/") !== 0) {
    return {
      status: "error",
      error: "Invalid remote ref: " + ref,
    };
  }
  if (
    match[7].split("/").some((segment) => segment === "." || segment === "..")
  ) {
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
    filePath: match[7] as `public/${string}`,
  };
}
