import {
  StudioPublishError,
  callJson,
  isTransientPublishError,
} from "../publish/callJson";
import {
  SourceError,
  type PackageRef,
  type TypecheckSources,
  type TypesBundle,
} from "./acquireTypes";
import type { CompilerBundle } from "./typescriptCompiler";

/**
 * Type bundles and compilers from adept. In the Studio, `base` is
 * `/api/val/publish-api/adept`: the Studio's server proxies to content, which
 * proxies to adept with its own token (adept.md, decision 7). Pointed at an
 * adept directly (`http://127.0.0.1:4300/v1`) it works the same, which is how
 * the parity script runs.
 *
 * Both answers are immutable, so the browser's cache answers repeats.
 */
export const STUDIO_ADEPT_BASE = "/api/val/publish-api/adept";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextFiles(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) && Object.values(value).every((v) => typeof v === "string")
  );
}

/** adept's `{ error: { code, message, retryable } }`, or what else went wrong. */
function sourceErrorOf(error: unknown, what: string): SourceError {
  if (error instanceof StudioPublishError) {
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
      isTransientPublishError(error) && error.statusCode !== 501,
      error.statusCode,
    );
  }
  return new SourceError(
    `${what} could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
    "network",
    true,
  );
}

export function adeptSources(options: {
  base: string;
  fetch?: typeof fetch;
}): TypecheckSources {
  const fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  const get = async (url: string, what: string): Promise<unknown> => {
    try {
      return await callJson(fetchImpl, url, "GET");
    } catch (error) {
      throw sourceErrorOf(error, what);
    }
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
    async compiler(version: string): Promise<CompilerBundle> {
      const what = `TypeScript ${version}`;
      const answer = await get(`${options.base}/compiler/${version}`, what);
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
    },
  };
}
