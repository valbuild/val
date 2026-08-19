import fs from "fs";
import path from "path";
import { getPersonalAccessTokenPath } from "./personalAccessTokens";

/**
 * The Val login device flow, as reusable primitives.
 *
 * The CLI wraps these with terminal output, and `@valbuild/language-server`
 * wraps them with LSP `window/showDocument` and progress reporting. Neither the
 * polling nor the token handling is duplicated between them.
 *
 * Deliberately no `console` output and no `process.exit`: every failure is a
 * thrown {@link ValLoginError} so an embedder can decide how to surface it.
 */

export const DEFAULT_LOGIN_HOST = "https://admin.val.build";

function defaultHost(): string {
  return process.env.VAL_BUILD_URL || DEFAULT_LOGIN_HOST;
}

export type ValLoginErrorCode =
  /** The server replied with something other than JSON. */
  | "unexpected-content-type"
  /** The server replied with JSON, but not the shape we expect. */
  | "unexpected-response"
  /** The server returned a 5xx. */
  | "server-error"
  /** The user did not complete the login within the allotted time. */
  | "timeout"
  /** The caller aborted the flow. */
  | "aborted";

export class ValLoginError extends Error {
  constructor(
    readonly code: ValLoginErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = "ValLoginError";
  }
}

/** A login attempt that is waiting for the user to confirm in a browser. */
export type ValLoginSession = {
  /** Opaque token used to poll for confirmation. */
  nonce: string;
  /** URL the user must open to confirm the login. */
  url: string;
};

export type ValLoginResult = {
  profile: { email: string };
  pat: string;
};

/**
 * Begin a login attempt. The caller is responsible for getting
 * {@link ValLoginSession.url} in front of the user.
 */
export async function startValLogin(
  options: { host?: string } = {},
): Promise<ValLoginSession> {
  const host = options.host ?? defaultHost();
  const response = await fetch(`${host}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (response.status >= 500) {
    const text = await response.text().catch(() => "");
    throw new ValLoginError(
      "server-error",
      "An error occurred on the server.",
      text
        ? `Server response: ${text} (status: ${response.status})`
        : `Status: ${response.status}`,
    );
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new ValLoginError(
      "unexpected-content-type",
      "Unexpected failure while trying to login (content type was not JSON).",
      text
        ? `Server response: ${text} (status: ${response.status})`
        : `Status: ${response.status}`,
    );
  }

  const json = await response.json();
  const nonce = json?.nonce;
  const url = json?.url;
  if (typeof nonce !== "string" || typeof url !== "string") {
    throw new ValLoginError(
      "unexpected-response",
      "Unexpected response from the server.",
      JSON.stringify(json),
    );
  }
  return { nonce, url };
}

export const DEFAULT_LOGIN_MAX_DURATION = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_LOGIN_POLL_INTERVAL = 1000;

/**
 * Poll until the user confirms the login in their browser.
 *
 * Accepts an `AbortSignal` so an editor can cancel the flow when the user
 * dismisses the prompt, instead of leaving a poll loop running for 5 minutes.
 */
export async function awaitValLoginConfirmation(
  nonce: string,
  options: {
    host?: string;
    maxDurationMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    /** Wall clock, injectable for tests. */
    now?: () => number;
  } = {},
): Promise<ValLoginResult> {
  const host = options.host ?? defaultHost();
  const maxDuration = options.maxDurationMs ?? DEFAULT_LOGIN_MAX_DURATION;
  const pollInterval = options.pollIntervalMs ?? DEFAULT_LOGIN_POLL_INTERVAL;
  const now = options.now ?? (() => Date.now());

  const start = now();
  while (now() - start < maxDuration) {
    if (options.signal?.aborted) {
      throw new ValLoginError("aborted", "Login was cancelled.");
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    if (options.signal?.aborted) {
      throw new ValLoginError("aborted", "Login was cancelled.");
    }

    const response = await fetch(
      `${host}/api/login?token=${nonce}&consume=true`,
      { method: "POST" },
    );
    if (response.status >= 500) {
      throw new ValLoginError(
        "server-error",
        "An error occurred on the server.",
        `Status: ${response.status}`,
      );
    }
    if (response.status === 200) {
      const json = await response.json();
      if (
        typeof json?.profile?.email === "string" &&
        typeof json?.pat === "string"
      ) {
        return json;
      }
      throw new ValLoginError(
        "unexpected-response",
        "Unexpected response from the server.",
        JSON.stringify(json),
      );
    }
  }
  throw new ValLoginError("timeout", "Login confirmation timed out.");
}

/**
 * Write a completed login to the project's personal access token file.
 *
 * @returns the path the token was written to.
 */
export function persistPersonalAccessToken(
  projectRoot: string,
  result: ValLoginResult,
): string {
  const filePath = getPersonalAccessTokenPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  // The token is a credential: keep it owner-only rather than at the mercy of
  // the process umask. `mode` only applies when the file is created, so an
  // already existing file is chmod-ed explicitly.
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Not all platforms / filesystems support POSIX modes (Windows, some
    // network mounts). Failing to tighten them must not fail the login.
  }
  return filePath;
}
