import { z } from "zod";
import { fromError } from "zod-validation-error";

/**
 * The publish API on content.val.build, as `val publish` speaks it.
 *
 *   POST /v1/publish                 declare -> an upload slot per MISSING artifact
 *   PUT  <slot url>                  upload  -> straight to object storage
 *   POST /v1/publish/{id}/artifacts  confirm -> content re-hashes what landed
 *   POST /v1/publish/{id}/verify     render  -> a canary build, server side
 *   POST /v1/publish/{id}/promote    go live -> the pointer moves
 *   GET  /v1/publish/{id}            status  -> the same answer as last time
 *
 * Four steps rather than one call because they fail differently, and "the bytes
 * are fine but it did not render" is the sentence a publisher most needs.
 *
 * No route takes a project: the token names one. And nothing here names a site,
 * a loader or a deployment - content holds the operator relationship with the
 * build platform and calls it during verify and promote. That is what makes
 * publishing possible with a project token at all, since the platform's canary
 * renders into a throwaway project that only an operator token can reach.
 *
 * **These are declared here rather than imported.** The service's own types
 * live in `content/src/handlers/Api.ts` in valbuild/home, which is private and
 * publishes nothing to npm, so this package cannot see them - and even if it
 * could, a type is not a check: what arrives is JSON over HTTP from a service
 * that versions separately. So this file is a schema per answer, parsed, the
 * same way `ValOpsHttp` in `@valbuild/server` reads every other content route.
 * It is the one file to reconcile when the service moves, and a disagreement
 * with it says which field was wrong, here, rather than surfacing as
 * `undefined` three functions later.
 */

/**
 * Where a publish is.
 *
 * `failed` is not the end it looks like: a verify that fails leaves the
 * artifacts where they are, so re-verifying is one call rather than a whole
 * re-upload. Only `live` and `expired` are ends.
 */
export const PublishState = z.enum([
  "awaiting-artifacts",
  "ready",
  "verified",
  "live",
  "failed",
  "expired",
]);
export type PublishState = z.infer<typeof PublishState>;

/**
 * Something content wants said to whoever ran the publish.
 *
 * `code` is stable and is what a pipeline gates on; it carries this API's own
 * codes and the build platform's `PLATFORM*` codes passed through from a
 * verify, unchanged. `hint` is printed rather than swallowed - a gate that
 * merely fails is useless.
 */
export const PublishProblem = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
    hint: z.string().nullish(),
    /** The artifact keys it is about, when it is about some rather than all. */
    keys: z.array(z.string()).optional(),
  })
  .transform((problem) => ({
    code: problem.code ?? "",
    message: problem.message ?? "",
    hint: problem.hint ?? null,
    keys: problem.keys ?? [],
  }));
export type PublishProblem = z.infer<typeof PublishProblem>;

const problems = z
  .array(PublishProblem)
  .optional()
  .transform((value) => value ?? []);

/** An artifact, as it is declared: by key, by hash, by size. */
export type DeclaredArtifact = {
  key: string;
  sha256: string;
  bytes: number;
};

/** Permission to write one artifact's bytes to object storage. */
export const UploadSlot = z
  .object({
    key: z.string().min(1),
    url: z.string().min(1),
    method: z.string().optional(),
    /** The headers the signature covers - `ContentLength`, and what else the store wants. */
    headers: z.record(z.string(), z.string()).optional(),
    /** ISO 8601, an hour out. An expired slot is re-declared, not retried. */
    expiresAt: z.string().optional(),
  })
  .transform((slot) => ({
    key: slot.key,
    url: slot.url,
    method: slot.method ?? "PUT",
    headers: slot.headers ?? {},
    expiresAt: slot.expiresAt ?? "",
  }));
export type UploadSlot = z.infer<typeof UploadSlot>;

export const DeclareResponse = z.object({
  publishId: z.string().min(1),
  state: PublishState,
  project: z.object({
    publicProjectId: z.string(),
    /** Null when the project has no site yet - reported, not refused. */
    siteUrl: z
      .string()
      .nullish()
      .transform((url) => url ?? null),
  }),
  /**
   * One per artifact this project does not already hold, and nothing else - so
   * it doubles as the answer to "what is missing".
   */
  uploads: z
    .array(UploadSlot)
    .optional()
    .transform((slots) => slots ?? []),
  have: z
    .array(z.string())
    .optional()
    .transform((keys) => keys ?? []),
});
export type DeclareResponse = z.infer<typeof DeclareResponse>;

export const ArtifactsResponse = z.object({
  state: PublishState,
  problems,
});
export type ArtifactsResponse = z.infer<typeof ArtifactsResponse>;

export const VerifyResponse = z.object({
  state: PublishState,
  ok: z.boolean(),
  /** Where the canary can be looked at, when it rendered. */
  previewUrl: z
    .string()
    .nullish()
    .transform((url) => url ?? null),
  problems,
});
export type VerifyResponse = z.infer<typeof VerifyResponse>;

export const PromoteResponse = z.object({
  state: PublishState,
  url: z
    .string()
    .nullish()
    .transform((url) => url ?? null),
  commit: z
    .string()
    .nullish()
    .transform((commit) => commit ?? null),
});
export type PromoteResponse = z.infer<typeof PromoteResponse>;

export const StatusResponse = z.object({
  publishId: z.string().min(1),
  state: PublishState,
  buildHash: z
    .string()
    .optional()
    .transform((hash) => hash ?? ""),
  /** Artifact keys not yet uploaded. */
  missing: z
    .array(z.string())
    .optional()
    .transform((keys) => keys ?? []),
  problems,
});
export type StatusResponse = z.infer<typeof StatusResponse>;

/**
 * Content answered, and the answer was not one this CLI can act on.
 *
 * Separate from a refusal, which is content saying no in a sentence meant for
 * a person. This is two programs disagreeing, and the two want opposite things
 * said about them.
 */
export class PublishProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishProtocolError";
  }
}

export const parseDeclare = (body: unknown): DeclareResponse =>
  parse(DeclareResponse, body, "POST /v1/publish");

export const parseArtifacts = (body: unknown): ArtifactsResponse =>
  parse(ArtifactsResponse, body, "POST /v1/publish/{id}/artifacts");

export const parseVerify = (body: unknown): VerifyResponse =>
  parse(VerifyResponse, body, "POST /v1/publish/{id}/verify");

export const parsePromote = (body: unknown): PromoteResponse =>
  parse(PromoteResponse, body, "POST /v1/publish/{id}/promote");

export const parseStatus = (body: unknown): StatusResponse =>
  parse(StatusResponse, body, "GET /v1/publish/{id}");

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
  const parsed = z.array(PublishProblem).safeParse(details);
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
