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
 * The source of truth is `content/src/handlers/Api.ts` and
 * `content/src/utils/publishPlan.ts` in valbuild/home. The parsers below exist
 * so that a disagreement with it says which field was missing, here, rather
 * than surfacing as `undefined` three functions later.
 */

/**
 * Where a publish is.
 *
 * `failed` is not the end it looks like: a verify that fails leaves the
 * artifacts where they are, so re-verifying is one call rather than a whole
 * re-upload. Only `live` and `expired` are ends.
 */
export type PublishState =
  | "awaiting-artifacts"
  | "ready"
  | "verified"
  | "live"
  | "failed"
  | "expired";

const STATES: PublishState[] = [
  "awaiting-artifacts",
  "ready",
  "verified",
  "live",
  "failed",
  "expired",
];

/**
 * Something content wants said to whoever ran the publish.
 *
 * `code` is stable and is what a pipeline gates on; it carries this API's own
 * codes and the build platform's `PLATFORM*` codes passed through from a
 * verify, unchanged. `hint` is printed rather than swallowed - a gate that
 * merely fails is useless.
 */
export type PublishProblem = {
  code: string;
  message: string;
  hint: string | null;
  keys: string[];
};

/** An artifact, as it is declared: by key, by hash, by size. */
export type DeclaredArtifact = {
  key: string;
  sha256: string;
  bytes: number;
};

/** Permission to write one artifact's bytes to object storage. */
export type UploadSlot = {
  key: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  /** ISO 8601, an hour out. A slot that has expired is re-declared, not retried. */
  expiresAt: string;
};

export type DeclareResponse = {
  publishId: string;
  state: PublishState;
  project: { publicProjectId: string; siteUrl: string | null };
  /**
   * One per artifact this project does not already hold, and nothing else - so
   * it doubles as the answer to "what is missing".
   */
  uploads: UploadSlot[];
  have: string[];
};

export type ArtifactsResponse = {
  state: PublishState;
  problems: PublishProblem[];
};

export type VerifyResponse = {
  state: PublishState;
  ok: boolean;
  previewUrl: string | null;
  problems: PublishProblem[];
};

export type PromoteResponse = {
  state: PublishState;
  url: string | null;
  commit: string | null;
};

export type StatusResponse = {
  publishId: string;
  state: PublishState;
  buildHash: string;
  /** Artifact keys not yet uploaded. */
  missing: string[];
  problems: PublishProblem[];
};

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

export function parseDeclare(body: unknown): DeclareResponse {
  const call = "POST /v1/publish";
  const object = asObject(body, call);
  return {
    publishId: requiredString(object, "publishId", call),
    state: requiredState(object, call),
    project: parseProject(object, call),
    uploads: parseUploads(object, call),
    have: stringArray(object, "have"),
  };
}

export function parseArtifacts(body: unknown): ArtifactsResponse {
  const call = "POST /v1/publish/{id}/artifacts";
  const object = asObject(body, call);
  return {
    state: requiredState(object, call),
    problems: parseProblems(Reflect.get(object, "problems")),
  };
}

export function parseVerify(body: unknown): VerifyResponse {
  const call = "POST /v1/publish/{id}/verify";
  const object = asObject(body, call);
  const ok = Reflect.get(object, "ok");
  if (typeof ok !== "boolean") {
    throw new PublishProtocolError(`${call} answered without ok.`);
  }
  return {
    state: requiredState(object, call),
    ok,
    previewUrl: optionalString(object, "previewUrl") ?? null,
    problems: parseProblems(Reflect.get(object, "problems")),
  };
}

export function parsePromote(body: unknown): PromoteResponse {
  const call = "POST /v1/publish/{id}/promote";
  const object = asObject(body, call);
  return {
    state: requiredState(object, call),
    url: optionalString(object, "url") ?? null,
    commit: optionalString(object, "commit") ?? null,
  };
}

export function parseStatus(body: unknown): StatusResponse {
  const call = "GET /v1/publish/{id}";
  const object = asObject(body, call);
  return {
    publishId: requiredString(object, "publishId", call),
    state: requiredState(object, call),
    buildHash: optionalString(object, "buildHash") ?? "",
    missing: stringArray(object, "missing"),
    problems: parseProblems(Reflect.get(object, "problems")),
  };
}

/**
 * The `details` of a refusal, when it carries a list of problems.
 *
 * Every non-2xx is `{ statusCode, message, details? }`, and the publish routes
 * put `PublishProblem[]` in `details` - a declaration is answered with EVERY
 * problem rather than the first, because finding them one round trip at a time
 * is how a publish takes six attempts.
 */
export function parseProblems(details: unknown): PublishProblem[] {
  if (!Array.isArray(details)) {
    return [];
  }
  const problems: PublishProblem[] = [];
  for (const entry of details) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const message = optionalString(entry, "message");
    const code = optionalString(entry, "code");
    if (!message && !code) {
      continue;
    }
    problems.push({
      code: code ?? "",
      message: message ?? "",
      hint: optionalString(entry, "hint") ?? null,
      keys: stringArray(entry, "keys"),
    });
  }
  return problems;
}

function parseProject(
  object: object,
  call: string,
): { publicProjectId: string; siteUrl: string | null } {
  const project = Reflect.get(object, "project");
  if (typeof project !== "object" || project === null) {
    throw new PublishProtocolError(`${call} answered without a project.`);
  }
  return {
    publicProjectId: requiredString(project, "publicProjectId", call),
    // Null when the project has no site yet: reported, not refused.
    siteUrl: optionalString(project, "siteUrl") ?? null,
  };
}

function parseUploads(object: object, call: string): UploadSlot[] {
  const raw = Reflect.get(object, "uploads");
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PublishProtocolError(
      `${call} answered with a non-array uploads.`,
    );
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new PublishProtocolError(
        `${call}: uploads[${index}] is not an object.`,
      );
    }
    return {
      key: requiredString(entry, "key", `${call}: uploads[${index}]`),
      url: requiredString(entry, "url", `${call}: uploads[${index}]`),
      method: optionalString(entry, "method") ?? "PUT",
      headers: parseHeaders(entry),
      expiresAt: optionalString(entry, "expiresAt") ?? "",
    };
  });
}

function parseHeaders(entry: object): Record<string, string> {
  const raw = Reflect.get(entry, "headers");
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      // A dropped header is a header the signature covers, and the upload then
      // fails at the store with a mismatch - a long way from the cause.
      headers[key] = value;
    }
  }
  return headers;
}

function asObject(body: unknown, call: string): object {
  if (typeof body !== "object" || body === null) {
    throw new PublishProtocolError(
      `${call} answered with ${body === null ? "null" : typeof body}, not an object.`,
    );
  }
  return body;
}

function requiredState(object: object, call: string): PublishState {
  const state = optionalString(object, "state");
  if (!state) {
    throw new PublishProtocolError(`${call} answered without a state.`);
  }
  const known = STATES.find((candidate) => candidate === state);
  if (!known) {
    throw new PublishProtocolError(
      `${call} answered with a state this CLI does not know: "${state}".`,
    );
  }
  return known;
}

function requiredString(object: object, key: string, call: string): string {
  const value = optionalString(object, key);
  if (!value) {
    throw new PublishProtocolError(`${call} answered without a ${key}.`);
  }
  return value;
}

function optionalString(object: object, key: string): string | undefined {
  const value = Reflect.get(object, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringArray(object: object, key: string): string[] {
  const value = Reflect.get(object, key);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}
