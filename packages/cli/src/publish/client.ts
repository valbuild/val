import fs from "fs";
import { getJson, postJson } from "./contentHost";
import {
  ArtifactsResponse,
  DeclareBody,
  DeclareResponse,
  PromoteResponse,
  StatusResponse,
  UploadSlot,
  VerifyResponse,
  parseArtifacts,
  parseDeclare,
  parsePromote,
  parseStatus,
  parseVerify,
} from "./protocol";

export type PublishClient = {
  declare(body: DeclareBody): Promise<DeclareResponse>;
  confirmArtifacts(publishId: string): Promise<ArtifactsResponse>;
  verify(publishId: string): Promise<VerifyResponse>;
  promote(publishId: string): Promise<PromoteResponse>;
  status(publishId: string): Promise<StatusResponse>;
  upload(slot: UploadSlot, file: string): Promise<void>;
};

export function createPublishClient(options: {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
}): PublishClient {
  const { host, token } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  // Every call, and nothing else: not a cookie, not the project's api key, not
  // a personal access token.
  const headers = { Authorization: `Bearer ${token}` };
  const publishUrl = (publishId: string, step?: string) =>
    `${host}/v1/publish/${encodeURIComponent(publishId)}${step ? `/${step}` : ""}`;

  return {
    declare: async (body) =>
      parseDeclare(
        await postJson({ url: `${host}/v1/publish`, headers, body, fetchImpl }),
      ),
    confirmArtifacts: async (publishId) =>
      parseArtifacts(
        await postJson({
          url: publishUrl(publishId, "artifacts"),
          headers,
          fetchImpl,
        }),
      ),
    verify: async (publishId) =>
      parseVerify(
        await postJson({
          url: publishUrl(publishId, "verify"),
          headers,
          fetchImpl,
        }),
      ),
    promote: async (publishId) =>
      parsePromote(
        await postJson({
          url: publishUrl(publishId, "promote"),
          headers,
          fetchImpl,
        }),
      ),
    status: async (publishId) =>
      parseStatus(
        await getJson({ url: publishUrl(publishId), headers, fetchImpl }),
      ),
    upload: (slot, file) => putArtifact(slot, file, fetchImpl),
  };
}

/** Object storage refused the bytes, or could not be reached. */
export class UploadError extends Error {
  readonly statusCode: number;
  readonly key: string;
  constructor(statusCode: number, key: string, message: string) {
    super(message);
    this.name = "UploadError";
    this.statusCode = statusCode;
    this.key = key;
  }
}

/**
 * A slot's permission to write has run out.
 *
 * Not a failed publish: declaring again mints fresh slots and the publish
 * carries on from where it was, which is why this is its own kind of failure
 * rather than an error message.
 */
export function isExpiredSlot(err: UploadError): boolean {
  return err.statusCode === 403 || err.statusCode === 401;
}

async function putArtifact(
  slot: UploadSlot,
  file: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  /*
   * Read, rather than streamed.
   *
   * `ContentLength` is signed into the slot's URL, so the store rejects a body
   * of a different size - and a streamed body goes out chunked, which is a
   * different size as far as the signature is concerned. An artifact is capped
   * at 128 MB by the API, which is the bound this trades against.
   */
  const body = await fs.promises.readFile(file);
  let res: Response;
  try {
    res = await fetchImpl(slot.url, {
      method: slot.method,
      headers: slot.headers,
      body,
    });
  } catch (err) {
    throw new UploadError(
      0,
      slot.key,
      `${slot.key}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    // The store answers XML, and a whole error document in a CI log buries the
    // line that matters. The status is the actionable half.
    throw new UploadError(
      res.status,
      slot.key,
      `${slot.key}: object storage answered ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Run `worker` over `items`, `limit` at a time.
 *
 * A project can have hundreds of small artifacts, so one at a time is minutes
 * of latency and all at once is hundreds of open sockets on a CI runner. The
 * first failure stops the pool: there is no point uploading the rest of a
 * publish that is not going to be promoted.
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
