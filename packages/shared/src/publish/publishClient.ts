/**
 * The Studio's side of the content service's publish API.
 *
 * Same conversation `val publish` has -- declare, upload, confirm, verify,
 * promote -- and deliberately the same PARSERS: `parseDeclare` and the rest
 * come from `@valbuild/shared/internal`, where they live precisely so that two
 * publishers cannot come to disagree about what content said.
 *
 * ## Two things differ from the CLI's client, and both are the same fact
 *
 * A browser holds a session cookie for the app's origin and no credential
 * content would accept -- content's publish API takes a project token and
 * refuses everything else. So:
 *
 * - **Every call goes to this origin**, at `/api/val/publish-api`, and the
 *   deployment swaps the credential on the way (see `ValOpsHttp.publishApi`).
 *   Nothing here has a token, and nothing here should ever be given one.
 * - **The uploads do not.** A slot is a presigned URL for object storage, and
 *   those bytes go straight there rather than through the isolate -- which is
 *   the whole reason the API hands out slots instead of accepting the artifacts
 *   itself. `credentials: "omit"` on those, because a presigned URL carries its
 *   own authorisation and a cookie sent to a storage host is a cookie leaked to
 *   one.
 */

import { callJson } from "./callJson";
import {
  ArtifactsResponse,
  BuildTargetResponse,
  DeclareBody,
  DeclareResponse,
  ProjectSourceResponse,
  PromoteResponse,
  StatusResponse,
  UploadSlot,
  VerifyResponse,
  parseArtifacts,
  parseBuildTarget,
  parseDeclare,
  parseProjectSource,
  parsePromote,
  parseStatus,
  parseVerify,
} from "../internal";

export {
  StudioPublishError,
  callJson,
  isTransientPublishError,
} from "./callJson";

/** An artifact the live build has and this publish re-declares by hash. */
export type CarriedArtifact = { key: string; sha256: string; bytes: number };

/** See {@link StudioPublishClient.publicFiles}. */
export type LivePublicFiles =
  | { carried: CarriedArtifact[] }
  | { paths: string[] }
  | null;

/** Object storage refused the bytes, or could not be reached. */
export class StudioUploadError extends Error {
  readonly statusCode: number;
  readonly key: string;
  constructor(statusCode: number, key: string, message: string) {
    super(message);
    this.name = "StudioUploadError";
    this.statusCode = statusCode;
    this.key = key;
  }
}

export type StudioPublishClient = {
  /**
   * What to build against, and what to build -- the two reads a publish makes
   * before it has anything to declare.
   *
   * On this type rather than beside it because they go through the same proxy
   * with the same credential, and because a caller holding one of them and not
   * the other can do nothing at all.
   */
  buildTarget(): Promise<BuildTargetResponse>;
  /** `null` when the project has never published. */
  projectSource(): Promise<Record<string, string> | null>;
  /**
   * What the live build serves from `public/`: by hash when content published
   * it, by path when only the loader knows, `null` when neither can say. See
   * `publicFiles` and `publicPaths` on `GET /v1/project-source`, which this
   * reads with {@link projectSource} in one request.
   */
  publicFiles(): Promise<LivePublicFiles>;
  declare(body: DeclareBody): Promise<DeclareResponse>;
  confirmArtifacts(publishId: string): Promise<ArtifactsResponse>;
  verify(publishId: string): Promise<VerifyResponse>;
  promote(publishId: string): Promise<PromoteResponse>;
  status(publishId: string): Promise<StatusResponse>;
  /** The artifact's bytes, straight to object storage. */
  upload(slot: UploadSlot, body: string): Promise<void>;
};

/**
 * A slot's permission to write has run out.
 *
 * Its own shape because it is not a failure: the answer is to declare again for
 * fresh slots, and a publish that treated it as one would give up an upload
 * short of the finish.
 */

/*
 * One request for both halves of the answer. A client lives for one deploy,
 * so this is the source as that deploy read it -- two requests could read
 * two different builds' files.
 */

export function isExpiredSlot(error: unknown): boolean {
  return error instanceof StudioUploadError && error.statusCode === 403;
}

/**
 * Where content's publish API is reached: through Val's proxy on this origin
 * (`api`, the Studio), or directly (`publishApi`, `<content>/v1`: home's
 * upgrade page, whose `fetchImpl` adds the project token).
 */
export type PublishApiAt =
  | {
      /** Val's API root on this origin, e.g. `/api/val`. */
      api: string;
    }
  | {
      /** Content's publish API itself, e.g. `https://content.val.build/v1`. */
      publishApi: string;
    };

export function publishApiOf(at: PublishApiAt): string {
  return "publishApi" in at
    ? at.publishApi.replace(/\/+$/, "")
    : `${at.api.replace(/\/+$/, "")}/publish-api`;
}

export function createStudioPublishClient(
  options: PublishApiAt & { fetchImpl?: typeof fetch },
): StudioPublishClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const proxy = publishApiOf(options);

  const call = (path: string, method: "GET" | "POST", body?: unknown) =>
    callJson(fetchImpl, `${proxy}${path}`, method, body);

  let source: Promise<ProjectSourceResponse> | null = null;
  const readSource = () =>
    (source ??= call("/project-source", "GET").then(parseProjectSource));

  return {
    buildTarget: async () =>
      parseBuildTarget(await call("/build-target", "GET")),
    projectSource: async () => (await readSource()).files,
    publicFiles: async () => {
      const { publicFiles, publicPaths } = await readSource();
      if (publicFiles) return { carried: publicFiles };
      if (publicPaths) return { paths: publicPaths };
      return null;
    },
    declare: async (body) => parseDeclare(await call("/publish", "POST", body)),
    confirmArtifacts: async (publishId) =>
      parseArtifacts(await call(publishStep(publishId, "artifacts"), "POST")),
    verify: async (publishId) =>
      parseVerify(await call(publishStep(publishId, "verify"), "POST")),
    promote: async (publishId) =>
      parsePromote(await call(publishStep(publishId, "promote"), "POST")),
    status: async (publishId) =>
      parseStatus(await call(publishStep(publishId), "GET")),
    upload: async (slot, body) => {
      let res: Response;
      try {
        res = await fetchImpl(slot.url, {
          method: slot.method,
          headers: slot.headers,
          body,
          /*
           * A presigned URL authorises itself. Sending this origin's cookies to
           * a storage host would leak a session to somewhere that has no use
           * for it and no reason to be trusted with it.
           */
          credentials: "omit",
        });
      } catch (error) {
        throw new StudioUploadError(
          0,
          slot.key,
          `Could not reach storage for '${slot.key}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (!res.ok) {
        throw new StudioUploadError(
          res.status,
          slot.key,
          `Storage refused '${slot.key}' with ${res.status}.`,
        );
      }
    },
  };
}

const publishStep = (publishId: string, step?: string) =>
  `/publish/${encodeURIComponent(publishId)}${step ? `/${step}` : ""}`;
