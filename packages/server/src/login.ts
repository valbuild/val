import fs from "fs";
import os from "os";
import path from "path";
import { getPersonalAccessTokenPath } from "./personalAccessTokens";

/**
 * The Val login flow, as reusable primitives.
 *
 * This is an RFC 8628 device authorization grant. The shape that matters:
 * {@link ValDeviceAuthorization.deviceCode} is a secret this process holds and
 * polls with, while {@link ValDeviceAuthorization.userCode} is the short string
 * the human reads out of the terminal and types into a browser. Only the device
 * code can collect a token.
 *
 * Keep them apart. Show the user code; never print, log or put the device code
 * in a URL. An earlier version of this flow used one value for both jobs, which
 * meant anyone who saw the verification link could collect the token it led to.
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

/**
 * What gets shown on the approval screen so the person can tell which terminal
 * is asking. Self-reported and therefore a hint, not proof — the server treats
 * it as untrusted display text.
 */
function defaultDeviceName(): string {
  try {
    return `${os.hostname()} (${os.platform()})`;
  } catch {
    // hostname() can throw on locked-down containers. A missing device name is
    // not worth failing a login over; the server renders "Unknown".
    return "";
  }
}

export type ValLoginErrorCode =
  /** The server replied with something other than JSON. */
  | "unexpected-content-type"
  /** The server replied with JSON, but not the shape we expect. */
  | "unexpected-response"
  /** The server returned a 5xx. */
  | "server-error"
  /** The user declined the login in the browser. */
  | "access-denied"
  /** The login was not approved before the code expired. */
  | "expired"
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

/** A login attempt that is waiting for the user to approve it in a browser. */
export type ValDeviceAuthorization = {
  /**
   * Secret. Polls for the token. Do not display, log or transmit anywhere but
   * the token endpoint.
   */
  deviceCode: string;
  /** Short code for the user to compare and type. Safe to display. */
  userCode: string;
  /** Where the user goes to enter {@link userCode}. */
  verificationUri: string;
  /** {@link verificationUri} with the code prefilled, for convenience. */
  verificationUriComplete: string;
  /** Seconds until the code stops being approvable. */
  expiresInSeconds: number;
  /** Minimum seconds between polls, per the server. */
  intervalSeconds: number;
};

export type ValLoginResult = {
  profile: { email: string };
  pat: string;
};

/**
 * Begin a login attempt. The caller is responsible for getting the user code
 * and verification URL in front of the user.
 */
export async function startValLogin(
  options: { host?: string; deviceName?: string } = {},
): Promise<ValDeviceAuthorization> {
  const host = options.host ?? defaultHost();
  const deviceName = options.deviceName ?? defaultDeviceName();
  const response = await fetch(`${host}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deviceName ? { device_name: deviceName } : {}),
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
  const deviceCode = json?.device_code;
  const userCode = json?.user_code;
  const verificationUri = json?.verification_uri;
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string"
  ) {
    throw new ValLoginError(
      "unexpected-response",
      "Unexpected response from the server. This version of Val may be too old for the login flow on this host — try updating @valbuild/cli.",
      JSON.stringify(json),
    );
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete:
      typeof json?.verification_uri_complete === "string"
        ? json.verification_uri_complete
        : verificationUri,
    expiresInSeconds:
      typeof json?.expires_in === "number"
        ? json.expires_in
        : DEFAULT_LOGIN_EXPIRES_IN_SECONDS,
    intervalSeconds:
      typeof json?.interval === "number"
        ? json.interval
        : DEFAULT_LOGIN_POLL_INTERVAL_SECONDS,
  };
}

/** Fallbacks for a server that omits the optional RFC 8628 timing fields. */
export const DEFAULT_LOGIN_EXPIRES_IN_SECONDS = 600;
export const DEFAULT_LOGIN_POLL_INTERVAL_SECONDS = 5;

/**
 * How much to add to the poll interval when the server answers `slow_down`.
 * RFC 8628 section 3.5 specifies 5 seconds.
 */
const SLOW_DOWN_INCREMENT_SECONDS = 5;

/**
 * Poll until the user approves the login in their browser.
 *
 * Accepts an `AbortSignal` so an editor can cancel the flow when the user
 * dismisses the prompt, instead of leaving a poll loop running to expiry.
 */
export async function awaitValLoginConfirmation(
  authorization: ValDeviceAuthorization,
  options: {
    host?: string;
    /** Defaults to the authorization's own `expiresInSeconds`. */
    maxDurationMs?: number;
    signal?: AbortSignal;
    /** Wall clock, injectable for tests. */
    now?: () => number;
  } = {},
): Promise<ValLoginResult> {
  const host = options.host ?? defaultHost();
  const maxDuration =
    options.maxDurationMs ?? authorization.expiresInSeconds * 1000;
  const now = options.now ?? (() => Date.now());
  // Mutable: `slow_down` widens it as we go, and never narrows it again.
  let intervalMs = authorization.intervalSeconds * 1000;

  const start = now();
  while (now() - start < maxDuration) {
    if (options.signal?.aborted) {
      throw new ValLoginError("aborted", "Login was cancelled.");
    }
    // Wait first: the user has not had time to approve anything yet.
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (options.signal?.aborted) {
      throw new ValLoginError("aborted", "Login was cancelled.");
    }

    const response = await fetch(`${host}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: authorization.deviceCode }),
    });

    if (response.status >= 500) {
      throw new ValLoginError(
        "server-error",
        "An error occurred on the server.",
        `Status: ${response.status}`,
      );
    }

    if (response.status === 200) {
      const json = await response.json().catch(() => null);
      if (!json) {
        // A 200 with an empty body is not a confirmation; keep polling rather
        // than failing the login, which is what the CLI has always done.
        continue;
      }
      if (
        typeof json.profile?.email === "string" &&
        typeof json.pat === "string"
      ) {
        return json;
      }
      throw new ValLoginError(
        "unexpected-response",
        "Unexpected response from the server.",
        JSON.stringify(json),
      );
    }

    const json = await response.json().catch(() => null);
    const error = typeof json?.error === "string" ? json.error : null;
    const description =
      typeof json?.error_description === "string"
        ? json.error_description
        : undefined;

    if (error === "authorization_pending") {
      continue;
    }
    if (error === "slow_down" || response.status === 429) {
      intervalMs += SLOW_DOWN_INCREMENT_SECONDS * 1000;
      continue;
    }
    if (error === "access_denied") {
      throw new ValLoginError(
        "access-denied",
        "The login was declined in the browser.",
        description,
      );
    }
    if (error === "expired_token") {
      throw new ValLoginError(
        "expired",
        "The login code expired before it was approved.",
        description,
      );
    }
    throw new ValLoginError(
      "unexpected-response",
      "Unexpected response from the server.",
      JSON.stringify(json),
    );
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
  // NOTE: no restrictive mode on the directory. This is the project's shared
  // `.val`, which also holds the pending patches the dev server reads and
  // writes; making it owner-only would lock out anyone who did not run the
  // login. Only the token file itself is tightened.
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
