import {
  SourceError,
  type PackageRef,
  type TypecheckSources,
  type TypesBundle,
} from "./acquireTypes";
import type { CompilerBundle } from "./typescriptCompiler";

/**
 * Type bundles and compilers from adept, by way of whoever proxies to it:
 *
 * - The Studio: `base` is `/api/val/publish-api/adept`, its own server, which
 *   proxies to content with the session (`STUDIO_ADEPT_BASE` in
 *   `@valbuild/ui`).
 * - Home's upgrade page: `base` is content's `/v1/adept`, called with the
 *   person's own credential in `headers` (valbuild/home
 *   `docs/plans/upgrades-v2.md`, piece E).
 * - adept itself (`http://127.0.0.1:4300/v1`), which is how the parity script
 *   runs.
 *
 * Both answers are immutable: a route that passes them on with their headers
 * lets the browser answer repeats from its cache.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextFiles(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) && Object.values(value).every((v) => typeof v === "string")
  );
}

/** An answer that was not a success: what it said, and its status. */
class AnswerError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** Not now: a timeout, too many requests, a server or gateway error. */
const isTransient = (status: number) =>
  status >= 500 || status === 408 || status === 429;

/** adept's `{ error: { code, message, retryable } }`, or what else went wrong. */
function sourceErrorOf(error: unknown, what: string): SourceError {
  if (error instanceof AnswerError) {
    const body = isRecord(error.body) ? error.body["error"] : undefined;
    if (isRecord(body) && typeof body["message"] === "string") {
      return new SourceError(
        body["message"],
        typeof body["code"] === "string"
          ? body["code"]
          : String(error.statusCode),
        body["retryable"] === true,
        error.statusCode,
      );
    }
    return new SourceError(
      `${what}: ${error.message}`,
      String(error.statusCode),
      // 501 is a deployment with no content service to ask: asking again
      // gets the same answer.
      isTransient(error.statusCode) && error.statusCode !== 501,
      error.statusCode,
    );
  }
  return new SourceError(
    `${what} could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
    "network",
    true,
  );
}

/**
 * One GET, as JSON. A body that is not JSON is a gateway, not adept or content
 * answering, so it is `undefined` and the status carries the meaning.
 */
async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, method: "GET" });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const message =
      isRecord(parsed) && typeof parsed["message"] === "string"
        ? parsed["message"]
        : `The answer was ${res.status}.`;
    throw new AnswerError(res.status, message, parsed);
  }
  return parsed;
}

/** `fetch` as the caller's global has it, when no other is given. */
const defaultFetch: typeof fetch = (...args) => fetch(...args);

/**
 * Compilers already fetched, by the `fetch` that fetched them and their URL.
 * A worker that checks a proposal and then the site asks for the same 13 MB
 * twice, with a new `adeptSources` for each check, and a version's compiler
 * is the same every time. A fetch that failed is not kept, so asking again
 * asks again.
 */
const compilers = new WeakMap<
  typeof fetch,
  Map<string, Promise<CompilerBundle>>
>();

export function adeptSources(options: {
  base: string;
  fetch?: typeof fetch;
  /** A credential to send, where the caller has one to (`Authorization`). */
  headers?: Record<string, string>;
  /** Whether cookies go too: `same-origin` (the default) for the Studio's own server. */
  credentials?: RequestInit["credentials"];
}): TypecheckSources {
  const fetchImpl = options.fetch ?? defaultFetch;
  const init: RequestInit = {
    credentials: options.credentials ?? "same-origin",
    ...(options.headers ? { headers: options.headers } : {}),
  };
  const get = async (url: string, what: string): Promise<unknown> => {
    try {
      return await getJson(fetchImpl, url, init);
    } catch (error) {
      throw sourceErrorOf(error, what);
    }
  };
  const fetchCompiler = async (
    url: string,
    version: string,
  ): Promise<CompilerBundle> => {
    const what = `TypeScript ${version}`;
    const answer = await get(url, what);
    if (!isRecord(answer) || !isTextFiles(answer["files"])) {
      throw new SourceError(
        `${what}: adept answered without the compiler's files.`,
        "unexpected-answer",
        false,
      );
    }
    return {
      version:
        typeof answer["version"] === "string" ? answer["version"] : version,
      files: answer["files"],
    };
  };
  return {
    async types(pkg: PackageRef): Promise<TypesBundle> {
      const what = `The types of ${pkg.name}@${pkg.version}`;
      const query = pkg.integrity
        ? `?integrity=${encodeURIComponent(pkg.integrity)}`
        : "";
      const answer = await get(
        `${options.base}/types/public/${pkg.name}@${pkg.version}${query}`,
        what,
      );
      if (!isRecord(answer) || !isTextFiles(answer["files"])) {
        throw new SourceError(
          `${what}: adept answered without a bundle.`,
          "unexpected-answer",
          false,
        );
      }
      const stubs = answer["stubs"];
      return {
        files: answer["files"],
        stubs: Array.isArray(stubs)
          ? stubs.filter((stub): stub is string => typeof stub === "string")
          : [],
      };
    },
    compiler(version: string): Promise<CompilerBundle> {
      const url = `${options.base}/compiler/${version}`;
      const kept =
        compilers.get(fetchImpl) ?? new Map<string, Promise<CompilerBundle>>();
      compilers.set(fetchImpl, kept);
      const held = kept.get(url);
      if (held !== undefined) return held;
      const fetching = fetchCompiler(url, version);
      kept.set(url, fetching);
      fetching.catch(() => {
        if (kept.get(url) === fetching) kept.delete(url);
      });
      return fetching;
    },
  };
}
