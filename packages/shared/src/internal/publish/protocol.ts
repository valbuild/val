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
 * What a build targets, and the project's files, as the Studio asks for them.
 *
 * Both are read through `/publish-api` rather than fetched from the loader,
 * because a browser has neither the loader's address nor a credential it would
 * accept. `fetchBuildTarget` in `@valbuild/tanstack-build` is the other half --
 * same shape, a different caller, and it CASTS where this parses.
 *
 * Parsed rather than cast here because of what sits in between: a proxy, a
 * gateway and a service boundary. An HTML error page cast to `BuildTarget`
 * fails several layers down inside rolldown with a message about a module
 * specifier, and the publish that follows would label a build against a layer
 * that was never there.
 *
 * The TYPE is inferred from this schema instead of imported. `BuildTarget` is
 * declared in `@valbuild/tanstack-build`, which has no zod and deliberately
 * almost no dependencies -- it goes into a browser bundle -- and this package
 * is imported by everything. The declarations are kept honest at the one place
 * the value is used: it is passed straight into `buildUserApp({ target })`, so
 * a drift between them is a compile error at that call rather than a runtime
 * surprise.
 */
const buildTargetResponse = z.object({
  base: z.object({
    rev: z.string(),
    shellRev: z.string(),
    rscShellRev: z.string(),
    modules: z.record(z.string(), z.string()),
    rscModules: z.record(z.string(), z.string()),
    paths: z.object({
      baseFromProject: z.string(),
      projectVendorDir: z.string(),
      rscVendorBase: z.string(),
      rscRuntimeSpecifier: z.string(),
      rscRuntimePath: z.string(),
      flightServer: z.string(),
      serverFnBase: z.string(),
    }),
  }),
  project: z.object({
    rev: z.string().nullable(),
    rsc: z.boolean(),
    modules: z.record(z.string(), z.string()),
    css: z.record(z.string(), z.string()),
    workerOnly: z.array(z.string()),
  }),
});

export type BuildTargetResponse = z.infer<typeof buildTargetResponse>;

/**
 * `null` files is a real answer: a project that has never published.
 *
 * Distinguished from an empty record, which would be a project that published
 * nothing -- and which a build would take as "no entry point" rather than as
 * "there is nothing here yet".
 */
const projectSourceResponse = z.object({
  files: z.record(z.string(), z.string()).nullable(),
});

export type ProjectSourceResponse = z.infer<typeof projectSourceResponse>;

export const parseBuildTarget = (body: unknown): BuildTargetResponse =>
  parse(buildTargetResponse, body, "GET /v1/build-target");

export const parseProjectSource = (body: unknown): ProjectSourceResponse =>
  parse(projectSourceResponse, body, "GET /v1/project-source");

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
      `${call} answered with something this publisher cannot read: ${fromError(
        parsed.error,
      ).toString()}`,
    );
  }
  return parsed.data;
}
