import { z } from "zod";
import { fromError } from "zod-validation-error";
import { ContentPublishApi, PublishProblem, PublishState } from "./contentApi";

/**
 * Reading what content answers.
 *
 * Every type here comes from `contentApi.ts`, which is a copy of the
 * service's own `Api.ts` - so the shapes are not re-derived from what this end
 * wishes it received, and a copy brought up to date fails to compile wherever
 * this CLI has not caught up.
 *
 * The schemas are the runtime half, and they are needed as well as the types:
 * what arrives is JSON over HTTP from a service that versions separately, so a
 * type alone asserts a shape rather than checking one. Each schema is
 * annotated with the copied type it must produce (`z.ZodType<DeclareResponse>`
 * and so on), which is what ties the two halves together - a schema that drifts
 * from the copy does not compile, and an answer that drifts from the schema
 * does not parse. `ValOpsHttp` in `@valbuild/server` reads every other content
 * route the same way.
 *
 * Nothing here is laxer than the copy. An optional field is optional because
 * the service says so; making a required one optional here would hide exactly
 * the drift this file exists to catch.
 */

export type { PublishProblem, PublishState };

export type DeclareBody = ContentPublishApi["/publish"]["POST"]["body"];
export type DeclareResponse = ContentPublishApi["/publish"]["POST"]["res"];
export type ArtifactsResponse =
  ContentPublishApi["/publish/:publishId/artifacts"]["POST"]["res"];
export type VerifyResponse =
  ContentPublishApi["/publish/:publishId/verify"]["POST"]["res"];
export type PromoteResponse =
  ContentPublishApi["/publish/:publishId/promote"]["POST"]["res"];
export type StatusResponse =
  ContentPublishApi["/publish/:publishId"]["GET"]["res"];
export type PublishTokenResponse =
  ContentPublishApi["/publish-token"]["POST"]["res"];

/** An artifact, as it is declared: by key, by hash, by size. */
export type DeclaredArtifact = DeclareBody["artifacts"][number];
/** Permission to write one artifact's bytes to object storage. */
export type UploadSlot = DeclareResponse["uploads"][number];

const publishState: z.ZodType<PublishState> = z.enum([
  "awaiting-artifacts",
  "ready",
  "verified",
  "live",
  "failed",
  "expired",
]);

const publishProblem: z.ZodType<PublishProblem> = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  keys: z.array(z.string()).optional(),
});

const uploadSlot: z.ZodType<UploadSlot> = z.object({
  key: z.string(),
  url: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});

const declareResponse: z.ZodType<DeclareResponse> = z.object({
  publishId: z.string(),
  state: publishState,
  project: z.object({
    publicProjectId: z.string(),
    siteUrl: z.string().nullable(),
  }),
  uploads: z.array(uploadSlot),
  have: z.array(z.string()),
});

const artifactsResponse: z.ZodType<ArtifactsResponse> = z.object({
  state: publishState,
  problems: z.array(publishProblem),
});

const verifyResponse: z.ZodType<VerifyResponse> = z.object({
  state: publishState,
  ok: z.boolean(),
  previewUrl: z.string().nullable(),
  problems: z.array(publishProblem),
});

const promoteResponse: z.ZodType<PromoteResponse> = z.object({
  state: publishState,
  url: z.string().nullable(),
  commit: z.string().nullable(),
});

const statusResponse: z.ZodType<StatusResponse> = z.object({
  publishId: z.string(),
  state: publishState,
  buildHash: z.string(),
  missing: z.array(z.string()),
  problems: z.array(publishProblem),
});

const publishTokenResponse: z.ZodType<PublishTokenResponse> = z.object({
  token: z.string(),
  expiresAt: z.string().nullable(),
  publicProjectId: z.string(),
  productionUrl: z.string().nullable(),
});

/**
 * Content answered, and the answer was not one this CLI can act on.
 *
 * Separate from a refusal, which is content saying no in a sentence meant for
 * a person. This is two programs disagreeing - the copy in `contentApi.ts` and
 * the service that has moved on from it - and the two want opposite things
 * said about them.
 */
export class PublishProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishProtocolError";
  }
}

export const parseDeclare = (body: unknown): DeclareResponse =>
  parse(declareResponse, body, "POST /v1/publish");

export const parseArtifacts = (body: unknown): ArtifactsResponse =>
  parse(artifactsResponse, body, "POST /v1/publish/{id}/artifacts");

export const parseVerify = (body: unknown): VerifyResponse =>
  parse(verifyResponse, body, "POST /v1/publish/{id}/verify");

export const parsePromote = (body: unknown): PromoteResponse =>
  parse(promoteResponse, body, "POST /v1/publish/{id}/promote");

export const parseStatus = (body: unknown): StatusResponse =>
  parse(statusResponse, body, "GET /v1/publish/{id}");

export const parsePublishToken = (
  body: unknown,
  call: string,
): PublishTokenResponse => parse(publishTokenResponse, body, call);

/**
 * The `details` of a refusal, when it carries a list of problems.
 *
 * Every non-2xx is `{ statusCode, message, details? }`, and the publish routes
 * put `PublishProblem[]` in `details` - a declaration is answered with EVERY
 * problem rather than the first, because finding them one round trip at a time
 * is how a publish takes six attempts. Anything else in there is somebody
 * else's `details` and is left to the caller's own message.
 */
export function parseProblems(details: unknown): PublishProblem[] {
  const parsed = z.array(publishProblem).safeParse(details);
  return parsed.success ? parsed.data : [];
}

function parse<T>(schema: z.ZodType<T>, body: unknown, call: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new PublishProtocolError(
      `${call} answered with something this CLI cannot read: ${fromError(
        parsed.error,
      ).toString()}`,
    );
  }
  return parsed.data;
}
