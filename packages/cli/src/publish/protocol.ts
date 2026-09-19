/**
 * The publish protocol, as `val publish` speaks it to content.val.build.
 *
 *   POST /v1/publish                 -> a publish id, and a presigned PUT for
 *                                       every artifact content does not have
 *   PUT  <presigned url>             -> each artifact, direct to storage
 *   POST /v1/publish/{id}/artifacts  -> "that is all of them"; content
 *                                       re-hashes what landed
 *   POST /v1/publish/{id}/verify     -> a canary build and render, server side
 *   POST /v1/publish/{id}/promote    -> flips the pointer
 *   GET  /v1/publish/{id}            -> state, problems, what is still missing
 *
 * The presigned URLs are the one exception to "content and nothing else": they
 * are how bytes reach storage without being proxied through the service. Every
 * decision - which artifacts are needed, whether they arrived intact, whether
 * the build renders, whether it goes live - is content's.
 *
 * **This file is the seam.** The five calls are fixed; the exact field names
 * are what the CLI and the fake in `publish.test.ts` agree on. If content ends
 * up spelling something differently, this is the file that changes, and the
 * parsers below are why the failure will say which field was missing rather
 * than surfacing as `undefined` three functions later.
 */

/** A file to publish, as the CLI offers it. */
export type ArtifactDescriptor = {
  /**
   * Where the file goes, relative to the published directory: `/` separated,
   * no leading slash, so it reads the same on every platform and can be a
   * storage key without further translation.
   */
  path: string;
  /** sha256, lowercase hex. Content re-hashes what lands and compares. */
  hash: string;
  size: number;
};

/** One artifact content is missing, and where to put it. */
export type PendingUpload = {
  path: string;
  hash: string;
  url: string;
  /** PUT unless content says otherwise. */
  method: string;
  /** Headers the signature covers - `Content-Type`, and whatever storage wants. */
  headers: Record<string, string>;
};

/**
 * Something content wants said to whoever ran the publish.
 *
 * A failed verify is the interesting case: the canary built or rendered wrong,
 * and the reason is a sentence content wrote, not a status code. It is printed
 * verbatim - the CLI has no idea what is in it and should not paraphrase.
 */
export type PublishProblem = {
  code: string | null;
  message: string;
  detail: string | null;
};

/**
 * What every one of the five calls answers: where this publish has got to.
 *
 * One shape for all of them, because the interesting question after each call
 * is the same one - what state is it in, what is still missing, what went
 * wrong - and a client that has to remember which call answers which subset is
 * a client that gets it wrong on the path nobody tests.
 */
export type PublishStatus = {
  publishId: string;
  /** Content's word for the state, kept verbatim for messages. */
  state: string;
  phase: PublishPhase;
  /** Artifacts content still does not have, presigned afresh each time. */
  missing: PendingUpload[];
  problems: PublishProblem[];
  /** Where the site is served, once promoted. Null before that. */
  url: string | null;
};

/**
 * The states this CLI knows how to act on.
 *
 * `unknown` is deliberate rather than defensive: a state added on content's
 * side should leave a published site published and a polling CLI polling, not
 * crash a CI job. Unknown states are reported by name and waited on.
 */
export type PublishPhase =
  | "awaiting-artifacts"
  | "verifying"
  | "verified"
  | "publishing"
  | "published"
  | "failed"
  | "unknown";

export function phaseOf(state: string): PublishPhase {
  // Spelling tolerance, and only spelling: `awaiting_artifacts` and
  // `AWAITING-ARTIFACTS` are the same state by anyone's reading.
  switch (state.trim().toLowerCase().replace(/_/g, "-")) {
    case "awaiting-artifacts":
      return "awaiting-artifacts";
    case "verifying":
      return "verifying";
    case "verified":
      return "verified";
    case "publishing":
    case "promoting":
      return "publishing";
    case "published":
      return "published";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Content answered, and the answer was not one this CLI can act on.
 *
 * Separate from `ContentHostError`, which is content refusing: that is a
 * sentence for the user, this is a mismatch between two programs, and the two
 * want opposite things said about them.
 */
export class PublishProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishProtocolError";
  }
}

export function parsePublishStatus(
  body: unknown,
  context: { call: string; publishId?: string },
): PublishStatus {
  if (typeof body !== "object" || body === null) {
    throw new PublishProtocolError(
      `${context.call} answered with ${body === null ? "null" : typeof body}, not an object.`,
    );
  }
  const publishId = optionalString(body, "publishId") ?? context.publishId;
  if (!publishId) {
    throw new PublishProtocolError(
      `${context.call} answered without a publishId.`,
    );
  }
  const state = optionalString(body, "state");
  if (!state) {
    throw new PublishProtocolError(`${context.call} answered without a state.`);
  }
  return {
    publishId,
    state,
    phase: phaseOf(state),
    missing: parseMissing(body, context.call),
    problems: parseProblems(body, context.call),
    url: optionalString(body, "url") ?? null,
  };
}

function parseMissing(body: object, call: string): PendingUpload[] {
  const raw = Reflect.get(body, "missing");
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PublishProtocolError(
      `${call} answered with a non-array missing.`,
    );
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new PublishProtocolError(
        `${call}: missing[${index}] is not an object.`,
      );
    }
    const path = optionalString(entry, "path");
    const hash = optionalString(entry, "hash");
    const url = optionalString(entry, "url");
    if (!path || !hash || !url) {
      throw new PublishProtocolError(
        `${call}: missing[${index}] needs a path, a hash and a url.`,
      );
    }
    return {
      path,
      hash,
      url,
      method: optionalString(entry, "method") ?? "PUT",
      headers: parseHeaders(entry),
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
      // Silently dropping a non-string would drop a header the signature
      // covers, and the upload would then fail at storage with a signature
      // mismatch - a long way from the cause.
      headers[key] = value;
    }
  }
  return headers;
}

function parseProblems(body: object, call: string): PublishProblem[] {
  const raw = Reflect.get(body, "problems");
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PublishProtocolError(
      `${call} answered with a non-array problems.`,
    );
  }
  const problems: PublishProblem[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      problems.push({ code: null, message: entry, detail: null });
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const message = optionalString(entry, "message");
      if (message) {
        problems.push({
          code: optionalString(entry, "code") ?? null,
          message,
          detail: optionalString(entry, "detail") ?? null,
        });
        continue;
      }
    }
    // A problem we cannot read is still a problem, and dropping it would turn
    // a failed publish into a failed publish with nothing said about it.
    problems.push({
      code: null,
      message: JSON.stringify(entry),
      detail: null,
    });
  }
  return problems;
}

function optionalString(body: object, key: string): string | undefined {
  const value = Reflect.get(body, key);
  if (typeof value === "string" && value !== "") {
    return value;
  }
  return undefined;
}
