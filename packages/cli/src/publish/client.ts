import fs from "fs";
import path from "path";
import { getJson, postJson } from "./contentHost";
import {
  ArtifactDescriptor,
  PendingUpload,
  PublishStatus,
  parsePublishStatus,
} from "./protocol";

export type PublishClient = {
  /** `POST /v1/publish` - offer the build, get back what content lacks. */
  create(options: {
    commit: string;
    branch: string;
    artifacts: ArtifactDescriptor[];
  }): Promise<PublishStatus>;
  /** `POST /v1/publish/{id}/artifacts` - that is all of them; re-hash. */
  artifactsDone(publishId: string): Promise<PublishStatus>;
  /** `POST /v1/publish/{id}/verify` - canary build and render, server side. */
  verify(publishId: string): Promise<PublishStatus>;
  /** `POST /v1/publish/{id}/promote` - flip the pointer. */
  promote(publishId: string): Promise<PublishStatus>;
  /** `GET /v1/publish/{id}` - state, problems, what is still missing. */
  status(publishId: string): Promise<PublishStatus>;
  /** `PUT <presigned url>` - one artifact, direct to storage. */
  upload(upload: PendingUpload, dir: string): Promise<void>;
};

export function createPublishClient(options: {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
}): PublishClient {
  const { host, token } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = { Authorization: `Bearer ${token}` };
  const call = async (
    method: "GET" | "POST",
    url: string,
    body: unknown,
    context: { call: string; publishId?: string },
  ): Promise<PublishStatus> => {
    const answer =
      method === "GET"
        ? await getJson({ url, headers: auth, fetchImpl })
        : await postJson({ url, headers: auth, body, fetchImpl });
    return parsePublishStatus(answer, context);
  };
  return {
    create: ({ commit, branch, artifacts }) =>
      call(
        "POST",
        `${host}/v1/publish`,
        { commit, branch, artifacts },
        { call: "POST /v1/publish" },
      ),
    artifactsDone: (publishId) =>
      call(
        "POST",
        `${host}/v1/publish/${encodeURIComponent(publishId)}/artifacts`,
        {},
        { call: "POST /v1/publish/{id}/artifacts", publishId },
      ),
    verify: (publishId) =>
      call(
        "POST",
        `${host}/v1/publish/${encodeURIComponent(publishId)}/verify`,
        {},
        { call: "POST /v1/publish/{id}/verify", publishId },
      ),
    promote: (publishId) =>
      call(
        "POST",
        `${host}/v1/publish/${encodeURIComponent(publishId)}/promote`,
        {},
        { call: "POST /v1/publish/{id}/promote", publishId },
      ),
    status: (publishId) =>
      call(
        "GET",
        `${host}/v1/publish/${encodeURIComponent(publishId)}`,
        undefined,
        { call: "GET /v1/publish/{id}", publishId },
      ),
    upload: (upload, dir) => putArtifact(upload, dir, fetchImpl),
  };
}

/** Storage refused, or could not be reached. */
export class UploadError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "UploadError";
    this.statusCode = statusCode;
  }
}

async function putArtifact(
  upload: PendingUpload,
  dir: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const absolute = path.join(dir, ...upload.path.split("/"));
  /*
   * Read, rather than streamed.
   *
   * A presigned PUT is signed over a `Content-Length`, and a streamed body
   * goes out chunked - which storage answers with a signature mismatch, a
   * failure that says nothing about its cause. Build artifacts are bundles and
   * images; if one ever turns up big enough for this to matter, the fix is a
   * multipart upload from content's side, not a chunked PUT from here.
   */
  const body = await fs.promises.readFile(absolute);
  let res: Response;
  try {
    res = await fetchImpl(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body,
    });
  } catch (err) {
    throw new UploadError(
      0,
      `${upload.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    // Storage answers XML, and a whole error document in a CI log buries the
    // line that matters. The status is the actionable half: 403 is an expired
    // or wrong signature, and the next `POST .../artifacts` presigns again.
    throw new UploadError(
      res.status,
      `${upload.path}: storage answered ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Run `worker` over `items`, `limit` at a time.
 *
 * A build is hundreds of small files, so one at a time is minutes of latency
 * and all at once is hundreds of open sockets on a CI runner. The first
 * failure stops the pool - there is no point uploading the rest of a publish
 * that is not going to be promoted.
 */
export async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown = undefined;
  const run = async (): Promise<void> => {
    for (;;) {
      if (failure !== undefined) {
        return;
      }
      const index = next++;
      if (index >= items.length) {
        return;
      }
      try {
        await worker(items[index]);
      } catch (err) {
        failure = err;
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  if (failure !== undefined) {
    throw failure;
  }
}
