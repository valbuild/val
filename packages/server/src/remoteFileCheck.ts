import {
  Internal,
  MediaSource,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedSchema,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { getFileExt } from "./getFileExt";

/**
 * Does the host a remote ref names still serve it?
 *
 * `found` and `missing` are the host's answer. `unreachable` is no answer at
 * all — a timeout, a refused connection, a 5xx — and says nothing about the
 * file, only about the host.
 */
export type RemoteFileAnswer =
  | { status: "found" }
  | { status: "missing"; httpStatus: number }
  | { status: "unreachable"; reason: string };

export type HeadRemoteFile = (url: string) => Promise<RemoteFileAnswer>;

const HEAD_TIMEOUT_MS = 8_000;

/**
 * A HEAD, falling back to the first byte of a GET for a host that does not
 * answer HEAD (405, 501): either way no file is downloaded to learn that it is
 * there.
 */
export const headRemoteFile: HeadRemoteFile = async (url) => {
  const ask = async (init: RequestInit): Promise<Response> =>
    fetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
  try {
    let res = await ask({ method: "HEAD" });
    if (res.status === 405 || res.status === 501) {
      res = await ask({ method: "GET", headers: { Range: "bytes=0-0" } });
      await res.body?.cancel();
    }
    if (res.ok) {
      return { status: "found" };
    }
    if (res.status === 404 || res.status === 410) {
      return { status: "missing", httpStatus: res.status };
    }
    return { status: "unreachable", reason: `HTTP ${res.status}` };
  } catch (err) {
    return {
      status: "unreachable",
      reason: describeFetchError(err),
    };
  }
};

function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Unknown error";
  }
  if (err.name === "TimeoutError") {
    return `No answer within ${HEAD_TIMEOUT_MS / 1000} s`;
  }
  // undici puts what actually went wrong (ENOTFOUND, ECONNREFUSED) on `cause`.
  const cause = err.cause;
  if (cause instanceof Error) {
    return `${err.message}: ${cause.message}`;
  }
  return err.message;
}

/**
 * Refs a host has served, and when.
 *
 * So that pressing **Check again**, or opening a second module that uses the
 * same images, does not ask about every file again. Kept for minutes, not for
 * the life of the process: a ref is content-addressed, so its answer only
 * changes when its host stops serving it -- which is exactly what this check
 * is for, and a server that remembered "found" forever would never report a
 * host that went down after it was first asked. Only `found` is kept. A host
 * that did not answer is asked again on the next check, which is what makes
 * **Try again** mean something.
 */
const FOUND_FOR_MS = 5 * 60_000;
const foundAt = new Map<string, number>();

function wasFound(ref: string): boolean {
  const at = foundAt.get(ref);
  return at !== undefined && Date.now() - at < FOUND_FOR_MS;
}

function markFound(ref: string) {
  foundAt.set(ref, Date.now());
}

/** For tests: forget every answer. */
export function clearRemoteFileAnswers() {
  foundAt.clear();
}

/** A host that did not serve the refs of a module it was asked about. */
export type RemoteHostProblem = {
  /** `https://remote.val.build`, as the ref names it. */
  host: string;
  status: "missing" | "unreachable";
  /** What the host answered, for "Details": never the row's sentence. */
  details: string;
  /** Every ref on that host in the module, checked or vouched for. */
  sourcePaths: SourcePath[];
};

export type RemoteFilesCheck = {
  /** Wrong refs, one by one: each has its own row. */
  errors: Record<SourcePath, ValidationError[]>;
  /** Hosts that failed: one row each, however many refs they cover. */
  hosts: RemoteHostProblem[];
};

export type RemoteFilesCheckInput = {
  /** What `validateSources` set aside as remote: every remote media value. */
  remoteFiles: Record<SourcePath, MediaSource>;
  /** The serialized schema at a path, or undefined when it does not resolve. */
  schemaAt: (sourcePath: SourcePath) => SerializedSchema | undefined;
  /**
   * Does this ref have its bytes in a pending patch? They go to the remote
   * host at publish, so until then asking the host for it is asking a
   * question whose answer is "not yet".
   */
  pendingBytes: (ref: string) => Promise<"present" | "missing" | "not-pending">;
  /**
   * Is this value's ref the one already published at this path? Only those
   * may be vouched for by another ref on the same host; see `sampleByHost`.
   */
  isPublished: (sourcePath: SourcePath, ref: string) => boolean;
  /**
   * Ask one published ref per host and take its answer for the rest.
   *
   * Right for a managed project, whose refs are only ever written by the
   * Studio and whose host changes for every ref at once. Wrong for a connected
   * one, where a developer can edit any single ref by hand. See
   * `docs/plans/studio-validate.md`, "Remote refs in the full check".
   */
  sampleByHost: boolean;
  head?: HeadRemoteFile;
};

const textEncoder = new TextEncoder();

/**
 * The remote half of the Studio's full check, for one module's remote values.
 *
 * Three questions, cheapest first, and a ref stops at the first one it fails:
 *
 * 1. **Is it a ref at all?** `splitRemoteRef` parses it.
 * 2. **Does the ref agree with what is recorded about it?** A ref carries a
 *    hash of the schema's options, the file's extension and its width, height
 *    and mime type. When the value or the schema changed and the ref did not,
 *    the ref is stale, and **Fix** (`image:check-remote`) re-reads the file and
 *    writes the ref it should have. Computed with the ref's OWN core version:
 *    the CLI also re-derives every ref after a Val upgrade, and listing every
 *    remote image in the project after each upgrade would bury the rows that
 *    matter. Nothing here downloads.
 * 3. **Does the host serve it?** A HEAD. Not asked for a ref whose bytes are
 *    in a pending patch, which the host will not have until publish: there
 *    the question is whether the patch still has them.
 */
export async function checkRemoteFiles(
  input: RemoteFilesCheckInput,
): Promise<RemoteFilesCheck> {
  const head = input.head ?? headRemoteFile;
  const errors: Record<SourcePath, ValidationError[]> = {};
  const addError = (sourcePath: SourcePath, error: ValidationError) => {
    errors[sourcePath] = (errors[sourcePath] ?? []).concat(error);
  };

  /** Refs still to ask a host about, by host. */
  const toAsk = new Map<
    string,
    { sourcePath: SourcePath; ref: string; published: boolean }[]
  >();

  const sorted = Object.entries(input.remoteFiles).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [sourcePathS, value] of sorted) {
    const sourcePath = sourcePathS as SourcePath;
    const ref = value.path;
    const parsed = Internal.remote.splitRemoteRef(ref);
    if (parsed.status === "error") {
      addError(sourcePath, {
        message: `This is not an address Val can check: ${parsed.error}`,
        value,
      });
      continue;
    }
    const schema = input.schemaAt(sourcePath);
    if (schema?.type !== "image" && schema?.type !== "file") {
      continue;
    }
    if (isStale(parsed, schema, value)) {
      addError(sourcePath, {
        message: `The address of this ${schema.type} does not match what is recorded about it, so it may be served with the wrong size or type.`,
        value,
        fixes: [
          schema.type === "image" ? "image:check-remote" : "file:check-remote",
        ],
      });
      continue;
    }
    const pending = await input.pendingBytes(ref);
    if (pending === "present") {
      continue;
    }
    if (pending === "missing") {
      addError(sourcePath, {
        message: `This ${schema.type} is in your unpublished changes, but its file is not. Choose the ${schema.type} again.`,
        value,
      });
      continue;
    }
    if (wasFound(ref)) {
      continue;
    }
    const refs = toAsk.get(parsed.remoteHost) ?? [];
    refs.push({
      sourcePath,
      ref,
      published: input.isPublished(sourcePath, ref),
    });
    toAsk.set(parsed.remoteHost, refs);
  }

  const hosts: RemoteHostProblem[] = [];
  await Promise.all(
    [...toAsk.entries()].map(async ([host, refs]) => {
      const problem = await askHost(host, refs, input.sampleByHost, head);
      if (problem.host) {
        hosts.push(problem.host);
      }
      for (const { sourcePath, error } of problem.refErrors) {
        addError(sourcePath, error);
      }
    }),
  );
  hosts.sort((a, b) => a.host.localeCompare(b.host));
  return { errors, hosts };
}

/**
 * One host's refs, asked one at a time.
 *
 * In order rather than all at once: a host that does not answer is reported
 * after the FIRST timeout, not after one timeout per image. A host that
 * answers "missing" for one ref is still asked about the next, since a file
 * that is gone is a fact about that file.
 */
async function askHost(
  host: string,
  refs: { sourcePath: SourcePath; ref: string; published: boolean }[],
  sampleByHost: boolean,
  head: HeadRemoteFile,
): Promise<{
  host?: RemoteHostProblem;
  refErrors: { sourcePath: SourcePath; error: ValidationError }[];
}> {
  const vouchable = sampleByHost ? refs.filter((r) => r.published) : [];
  const individually = sampleByHost ? refs.filter((r) => !r.published) : refs;
  const allPaths = refs.map((r) => r.sourcePath);
  const refErrors: { sourcePath: SourcePath; error: ValidationError }[] = [];

  if (vouchable.length > 0) {
    const sample = vouchable[0];
    const answer = await head(sample.ref);
    if (answer.status === "found") {
      for (const r of vouchable) {
        markFound(r.ref);
      }
    } else {
      // In a managed project a published ref cannot break on its own, so the
      // sample's answer is the host's: one row, every ref on it.
      return {
        host: {
          host,
          status: answer.status,
          details: detailsOf(sample.ref, answer),
          sourcePaths: allPaths,
        },
        refErrors,
      };
    }
  }

  for (const r of individually) {
    const answer = await head(r.ref);
    if (answer.status === "found") {
      markFound(r.ref);
    } else if (answer.status === "missing") {
      refErrors.push({
        sourcePath: r.sourcePath,
        error: {
          message: `The file is not at its address: ${hostName(host)} answered ${answer.httpStatus}.`,
        },
      });
    } else {
      return {
        host: {
          host,
          status: "unreachable",
          details: detailsOf(r.ref, answer),
          sourcePaths: allPaths,
        },
        refErrors,
      };
    }
  }
  return { refErrors };
}

function detailsOf(ref: string, answer: RemoteFileAnswer): string {
  return `HEAD ${ref}\n→ ${
    answer.status === "missing"
      ? `${answer.httpStatus}`
      : answer.status === "unreachable"
        ? answer.reason
        : "200"
  }`;
}

/** `www.acme.no`, from `https://www.acme.no`: how a person names a host. */
export function hostName(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
}

function isStale(
  parsed: Extract<
    ReturnType<typeof Internal.remote.splitRemoteRef>,
    { status: "success" }
  >,
  schema: SerializedImageSchema | SerializedFileSchema,
  value: MediaSource,
): boolean {
  // The hash covers only these of what was recorded (`getValidationBasis`):
  // `alt` and `hotspot` are the editor's, and change no byte.
  const metadata = {
    width: value.width,
    height: value.height,
    mimeType: value.mimeType,
  };
  const expected = Internal.remote.getValidationHash(
    parsed.version,
    schema,
    getFileExt(parsed.filePath),
    metadata,
    parsed.fileHash,
    textEncoder,
  );
  return expected !== parsed.validationHash;
}
