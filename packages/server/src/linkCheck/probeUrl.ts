import http from "node:http";
import https from "node:https";
import net, { type LookupFunction } from "node:net";
import { blockedAddressReason, describeBlocked } from "./addressGuard";

/**
 * Opening one external URL and reporting what answered.
 *
 * Mirrors `ExternalUrlProbeResult` in the Studio - the two are checked against
 * each other by the API route's zod schema, which is the only place they meet.
 */
export type ProbeResult =
  | { kind: "answered"; code: number; finalUrl: string; ms: number }
  | { kind: "unreachable"; message: string }
  | { kind: "timeout"; ms: number }
  | { kind: "skipped"; message: string };

export type ProbeOptions = {
  /** The whole check, redirects included. */
  timeoutMs?: number;
  /** How many redirects to follow before calling it a loop. */
  maxRedirects?: number;
  /**
   * The transport, injected so the redirect and status logic can be tested
   * without a network. Production passes nothing and gets `node:https`.
   */
  request?: typeof https.request;
  /** Injected for the same reason, and never to relax the address guard. */
  now?: () => number;
};

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_REDIRECTS = 5;

/**
 * A browser-ish identity.
 *
 * Not a disguise: plenty of sites answer 403 to a request with no `User-Agent`
 * at all, and reporting those as broken would be a check that cries wolf. It
 * says what it is and where to complain.
 */
const USER_AGENT =
  "Val-Studio-LinkCheck/1.0 (+https://val.build; link checker)";

/**
 * A `lookup` that refuses to hand back an address this server may not reach.
 *
 * This, rather than a check on the hostname or a check after the fact, is what
 * closes the hole. The socket connects to the address the lookup RETURNS, so
 * validating inside it leaves no window between the check and the connection —
 * a name that resolves to 93.184.216.34 once and 127.0.0.1 the next time gets
 * no second chance, because there is only ever one resolution and it is this
 * one.
 */
/**
 * What a refused lookup tells the CALLER.
 *
 * Deliberately the same words `ENETUNREACH` gets, and deliberately without the
 * address. The guard stops the connection, but the first version of it handed
 * back the DNS answer it had just refused to use - "vault.prod.svc resolves to
 * a private address (10.42.7.19)" - which travels through `readableError` into
 * the response and onto the screen. That turns an endpoint that cannot reach
 * the internal network into one that MAPS it: twenty names a request, existence
 * confirmed and address included, without a single connection being made.
 *
 * True rather than evasive: this server genuinely did not reach the host. And
 * because a real external host that is down produces the same sentence, the
 * answer no longer says which of the two happened. The operator still gets the
 * detail, in the log, where it belongs.
 *
 * A hostname the caller wrote as a literal address is different and keeps its
 * specific message (see the literal check in `probeUrl`): repeating
 * `127.0.0.1` to someone who just typed `127.0.0.1` reveals nothing.
 */
const REFUSED_MESSAGE = "the host could not be reached";

export function guardedLookup(lookup: LookupFunction): LookupFunction {
  const guarded: LookupFunction = (hostname, options, callback) => {
    // The overloads differ only in whether `options` was passed; `net` always
    // calls through with both, and this forwards whatever it was given.
    return lookup(
      hostname,
      options,
      (
        err: NodeJS.ErrnoException | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => {
        if (err) {
          callback(err, "", 0);
          return;
        }
        const addresses = Array.isArray(address)
          ? address
          : [{ address, family: family ?? 0 }];
        for (const entry of addresses) {
          const reason = blockedAddressReason(entry.address);
          if (reason !== null) {
            // Server-side only. This is the half an operator needs to work out
            // why a link check refused a URL, and the half a caller must not
            // be given.
            console.warn(
              `[val] link check refused ${hostname}: resolves to ${describeBlocked(
                reason,
              )} (${entry.address})`,
            );
            callback(new Error(REFUSED_MESSAGE), "", 0);
            return;
          }
        }
        // Forwarded in the shape it arrived in: `net` reads it back according
        // to whether it asked for `all`.
        if (Array.isArray(address)) {
          callback(null, address, family);
        } else {
          callback(null, address, family ?? 0);
        }
      },
      // The callback shape above is the union of both overloads, which the
      // published types split apart.
    ) as void;
  };
  return guarded;
}

/** The statuses that mean "ask again with GET" rather than "no". */
function needsGetFallback(code: number): boolean {
  /*
   * Only where the server said the METHOD was the problem.
   *
   * A 403 is the tempting third case - some WAFs and proxies do refuse HEAD
   * with one, and this repo's own sandbox is an example - but retrying every
   * 403 with a GET means downloading a page for each of them, on a check whose
   * whole point is to be cheap enough to run over a few hundred URLs. And it
   * would buy little: 403 is already reported as "may be fine for a visitor,
   * cannot be checked from here" rather than as a broken link, which is the
   * right answer either way.
   */
  return code === 405 || code === 501;
}

export async function probeUrl(
  rawUrl: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const deadline = started + timeoutMs;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { kind: "skipped", message: "Not opened: this is not a URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      kind: "skipped",
      message: "Not opened: only http:// and https:// can be checked.",
    };
  }

  let method: "HEAD" | "GET" = "HEAD";
  let redirects = 0;
  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      return { kind: "timeout", ms: timeoutMs };
    }
    /*
     * A hostname that is ALREADY an address never reaches the lookup.
     *
     * `net.connect` checks for an IP literal first and connects straight to
     * it, so `guardedLookup` is simply not called for
     * `http://169.254.169.254/` — which is the single most valuable URL an
     * attacker could ask this server to open. Checked here, per hop, because a
     * redirect can introduce one at any point in the chain.
     *
     * This was a real hole, found by a test that asserted the local server
     * received nothing and watched it receive something.
     */
    const literal = bareHost(url.hostname);
    if (net.isIP(literal) !== 0) {
      const reason = blockedAddressReason(literal);
      if (reason !== null) {
        return {
          kind: "unreachable",
          message: `${literal} is ${describeBlocked(reason)}`,
        };
      }
    }

    let response: OneResponse;
    try {
      response = await requestOnce(url, method, remaining, options.request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === TIMED_OUT) {
        return { kind: "timeout", ms: timeoutMs };
      }
      return { kind: "unreachable", message };
    }

    if (method === "HEAD" && needsGetFallback(response.code)) {
      method = "GET";
      continue;
    }

    const location = response.location;
    if (location !== undefined && response.code >= 300 && response.code < 400) {
      if (redirects >= maxRedirects) {
        return {
          kind: "unreachable",
          message: `too many redirects (${maxRedirects})`,
        };
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return {
          kind: "unreachable",
          message: `redirected to something that is not a URL (${location})`,
        };
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        // A redirect to `file:` or `gopher:` is a redirect out of what this
        // is allowed to open, and the address guard would never see it.
        return {
          kind: "unreachable",
          message: `redirected to ${next.protocol}//, which cannot be checked`,
        };
      }
      url = next;
      redirects++;
      // A redirect answers the method question too: a server that refused
      // HEAD at the old URL says nothing about the new one.
      method = "HEAD";
      continue;
    }

    return {
      kind: "answered",
      code: response.code,
      finalUrl: url.toString(),
      ms: Math.max(0, Math.round(now() - started)),
    };
  }
}

/**
 * A hostname with the IPv6 brackets off.
 *
 * `new URL("http://[::1]/").hostname` is `"[::1]"`, brackets and all, and
 * `net.isIP` says 0 to that — so the bracketed form sailed past the literal
 * check and failed later with "host could not be found". Which looks like a
 * refusal, and is not one.
 */
function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

type OneResponse = { code: number; location: string | undefined };

const TIMED_OUT = "val:link-check-timeout";

function requestOnce(
  url: URL,
  method: "HEAD" | "GET",
  timeoutMs: number,
  requestImpl?: typeof https.request,
): Promise<OneResponse> {
  const impl =
    requestImpl ?? (url.protocol === "http:" ? http.request : https.request);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const req = impl(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === "" ? undefined : url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          // No cookies, no authorization, no forwarded headers: this request
          // is the server's own and carries none of its identity.
          "user-agent": USER_AGENT,
          accept: "*/*",
          // A redirect chain is followed by hand, one guarded hop at a time.
          "accept-encoding": "identity",
        },
        // Every DNS answer is checked before a socket is opened. See
        // `guardedLookup` — this is the line that makes the whole feature safe.
        lookup: guardedLookup(defaultLookup()),
        // Node's default agent keeps sockets alive between requests, and a
        // pooled socket was resolved by a PREVIOUS lookup. A fresh connection
        // per probe is what keeps the guard in front of every one of them.
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const location = res.headers.location;
        // The body is never read: a status and a `Location` is the whole
        // answer, and downloading a page to throw it away is bandwidth spent
        // on somebody else's server.
        res.destroy();
        finish(() =>
          resolve({
            code: res.statusCode ?? 0,
            location: typeof location === "string" ? location : undefined,
          }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      finish(() => reject(new Error(TIMED_OUT)));
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => reject(new Error(readableError(error))));
    });
    req.end();
  });
}

/** `dns.lookup`, read lazily so a test can swap `node:dns` wholesale. */
function defaultLookup(): LookupFunction {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dns = require("node:dns") as typeof import("node:dns");
  return dns.lookup;
}

/** What went wrong, in words rather than in errno. */
function readableError(error: NodeJS.ErrnoException): string {
  /*
   * The guard's own refusal, recognised by its message rather than by a code.
   * `net` destroys the socket with the Error the lookup gave it, and the
   * message survives that trip verbatim; whether a custom `code` does is an
   * implementation detail this does not need to bet on.
   */
  if (error.message === REFUSED_MESSAGE) {
    return REFUSED_MESSAGE;
  }
  switch (error.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "the host could not be found";
    case "ECONNREFUSED":
      return "the connection was refused";
    case "ECONNRESET":
      return "the connection was reset";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "the host could not be reached";
    case "CERT_HAS_EXPIRED":
      return "its certificate has expired";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "its certificate is for a different host";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "its certificate is self-signed";
    default:
      /*
       * A fixed string, not `error.message`.
       *
       * Whatever Node or OpenSSL put in there is written for a server log, and
       * some of it names things the caller should not learn - a resolved
       * address, a certificate's subject, a path. The cases above cover what is
       * worth telling an editor; anything else is noise to them and a leak
       * waiting to happen.
       */
      return "the request failed";
  }
}
