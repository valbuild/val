import {
  Api,
  ApiEndpoint,
  ValServerGenericResult,
} from "@valbuild/shared/internal";
import type { ValServer } from "./ValServer";
import { fromError } from "zod-validation-error";
import { z, ZodError } from "zod";

/**
 * Val's API as a web-standard handler: a `Request` in, a converted result out.
 *
 * The request handling itself -- matching a route, parsing it against `Api`,
 * calling the server, checking the answer -- and nothing that needs Node, so it
 * runs in a browser tab as well as on a server. That is what the demo does
 * (`@valbuild/server/browser`): the Studio's own client sends its requests
 * here, in the same tab, instead of over the network.
 *
 * `serveStatic` answers `/static/...`, the Studio's own scripts and styles.
 * `createValApiRouter` passes the embedded bundle; the demo passes nothing,
 * because its page loaded those from the app already.
 */
export function createValRequestHandler<Res>(
  route: string,
  valServerPromise: Promise<ValServer>,
  convert: (valServerRes: ValServerGenericResult) => Res,
  serveStatic?: (path: string, href: string) => Promise<ValServerGenericResult>,
): (req: Request) => Promise<Res> {
  // valServerPromise is created at module-eval time, but only awaited per request.
  // Without this no-op catch, a config error (e.g. proxy mode without a project)
  // rejects with no handler attached, which becomes an unhandledRejection and kills
  // the dev server. The error is still reported per request by the try/catch below.
  valServerPromise.catch(() => {
    // handled below
  });
  return async (req): Promise<Res> => {
    let valServer: ValServer;
    try {
      valServer = await valServerPromise;
    } catch (err) {
      const error = {
        message: "Val: could not start the Val server",
        details: err instanceof Error ? err.message : String(err),
      };
      console.error(error.message + ": " + error.details);
      return convert({
        status: 500,
        json: error,
      });
    }
    const url = new URL(req.url);
    if (!url.pathname.startsWith(route)) {
      const error = {
        message: "Val: routes are not configured correctly",
        details: `Check you api routes. Expected pathname to start with "${route}", but it was: "${url.pathname}"`,
      };
      console.error(error);
      return convert({
        status: 500,
        json: error,
      });
    }

    const path = url.pathname.slice(route.length);
    const groupQueryParams = (arr: [string, string][]) => {
      const map: Record<string, string[]> = {};
      for (const [key, value] of arr) {
        const list = map[key] || [];
        list.push(value);
        map[key] = list;
      }
      return map;
    };
    async function getValServerResponse(
      reqApiRoutePath: string,
      req: Request,
    ): Promise<ValServerGenericResult> {
      const anyApi =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Api as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyValServer = valServer as any;
      const method = req.method?.toUpperCase();
      let route = null;
      let path: string | undefined = undefined;
      // An exact match wins over every prefix match, wherever it sits in
      // `Api`: checked per key, in order, `/validate` took `/validate/fix`
      // because it was declared first.
      const exactRouteDef = Object.keys(Api).find(
        (routeDef) => routeDef === reqApiRoutePath,
      );
      for (const routeDef of exactRouteDef
        ? [exactRouteDef]
        : Object.keys(Api)) {
        if (routeDef === reqApiRoutePath) {
          route = routeDef;
          break;
        }
        if (reqApiRoutePath.startsWith(routeDef)) {
          const reqDefinition = (anyApi?.[routeDef]?.[method] as ApiEndpoint)
            ?.req;
          if (reqDefinition) {
            route = routeDef;
            if (reqDefinition.path) {
              const subPath = reqApiRoutePath.slice(routeDef.length);
              const pathRes = reqDefinition.path.safeParse(subPath);
              if (!pathRes.success) {
                return zodErrorResult(
                  pathRes.error,
                  `invalid path: '${subPath}' endpoint: '${routeDef}'`,
                );
              } else {
                path = pathRes.data;
              }
            }
            break;
          }
        }
      }
      if (!route) {
        return {
          status: 404,
          json: {
            message: "Route not found. Valid routes are: " + Object.keys(Api),
            details: {
              route,
              method,
            },
          },
        };
      }

      const apiEndpoint = anyApi?.[route]?.[method] as ApiEndpoint;
      const reqDefinition = apiEndpoint?.req;
      if (!reqDefinition) {
        return {
          status: 404,
          json: {
            message: `Requested method ${method} on route ${route} is not valid. Valid methods are: ${Object.keys(
              anyApi[route],
            ).join(", ")}`,
            details: {
              route,
              method,
            },
          },
        };
      }
      const endpointImpl = anyValServer?.[route]?.[method] as (
        reqData: Record<string, unknown>,
      ) => Promise<ValServerGenericResult>;
      if (!endpointImpl) {
        return {
          status: 500,
          json: {
            message:
              "Missing server implementation of route with method. This might be caused by a mismatch between Val package versions.",
            details: {
              valid: {
                route: {
                  server: Object.keys(anyValServer || {}),
                  api: Object.keys(anyApi || {}),
                },
                method: {
                  server: Object.keys(anyValServer?.[route] || {}),
                  api: Object.keys(anyApi?.[route] || {}),
                },
              },
              route,
              method,
            },
          },
        };
      }
      let bodyRes;
      try {
        bodyRes = reqDefinition.body
          ? reqDefinition.body.safeParse(await readJsonBody(req))
          : ({ success: true, data: {} } as z.ZodSafeParseSuccess<unknown>);
        if (!bodyRes.success) {
          return zodErrorResult(bodyRes.error, "invalid body data");
        }
      } catch (e) {
        return {
          status: 400,
          json: {
            message: "Could not parse request body",
            details: {
              error: JSON.stringify(e),
            },
          },
        };
      }

      const cookiesRes = reqDefinition.cookies
        ? getCookies(req, reqDefinition.cookies)
        : ({ success: true, data: {} } as z.ZodSafeParseSuccess<
            Record<string, string>
          >);
      if (!cookiesRes.success) {
        return zodErrorResult(cookiesRes.error, "invalid cookies");
      }
      const headersRes = reqDefinition.headers
        ? getHeaders(req, reqDefinition.headers)
        : ({ success: true, data: {} } as z.ZodSafeParseSuccess<
            Record<string, string | undefined>
          >);
      if (!headersRes.success) {
        return zodErrorResult(headersRes.error, "invalid headers");
      }
      const actualQueryParams = groupQueryParams(
        Array.from(url.searchParams.entries()),
      );
      let query = {};
      if (reqDefinition.query) {
        const queryRules = reqDefinition.query;
        const queryRes = z.object(queryRules).safeParse(actualQueryParams);
        if (!queryRes.success) {
          return zodErrorResult(
            queryRes.error,
            `invalid query params: (${JSON.stringify(actualQueryParams)})`,
          );
        }
        query = queryRes.data;
      }

      /*
       * A throw from an endpoint is Val's to report, not the framework's.
       *
       * Nothing here used to catch, so an endpoint that threw left the router
       * entirely and became whatever the host does with an unhandled error --
       * and on TanStack Start that is h3, which replaces the message with the
       * literal string "HTTPError" and drops the stack. Its `debug` and
       * `silent` options are not reachable from out here: `requestHandler`
       * calls `toResponse(value, event)` with no config, and the default is
       * `{}`. So the body a caller got was
       * `{"status":500,"unhandled":true,"message":"HTTPError"}` -- the same
       * five words for a missing project, a bad cookie secret and a module
       * that failed to link -- with the real cause only on the server's
       * console.
       *
       * That is survivable where the console is readable. It is not in a
       * Cloudflare Dynamic Worker, whose `console` reaches no tail stream: a
       * link error in a lazily imported chunk (`does not provide an export
       * named 'getSerovalPlugins'`) showed up as an unreadable 500 on
       * `/authorize` and nowhere else at all.
       *
       * So every endpoint's throw becomes Val's own 500 envelope, which the
       * Studio already renders and `curl` already prints. The route and method
       * are named because a message rarely says which endpoint it came from.
       *
       * The MESSAGE travels and the STACK does not. The message is the whole
       * diagnostic value -- the line above names the package, the chunk and
       * the export -- while a stack is a walk through somebody's bundle, and
       * `/authorize` and `/enable` are reachable without a session. So the
       * stack goes to the console, where a host that can read one will find
       * it, and the body carries what a caller can act on.
       */
      let res: ValServerGenericResult;
      try {
        res = await endpointImpl({
          body: bodyRes.data,
          cookies: cookiesRes.data,
          headers: headersRes.data,
          rawQuery: reqDefinition.rawQuery ? url.search : undefined,
          query,
          path,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(
          `Val: ${method} ${route} threw: ${error.message}`,
          error.stack,
        );
        return {
          status: 500,
          json: {
            message: `Val: ${method} ${route} failed: ${error.message}`,
            details: {
              route,
              method,
              error: error.message,
            },
          },
        };
      }
      const resDef = apiEndpoint.res;
      if (res.status === 500) {
        /*
         * A failure the route declares goes out as declared, as a success
         * does below. DELETE /patches says which change was not discarded and
         * which publish holds it, and collapsed to its message the Studio
         * could only say "Failed to delete patches" -- not why, nor offer to
         * cancel that publish. Anything undeclared is still reduced to its
         * message.
         */
        if (resDef?.safeParse(res).success) return res;
        return {
          status: 500,
          json: {
            message: res.json?.message || "Internal Server Error",
          },
        };
      }
      if (resDef) {
        const responseResult = resDef.safeParse(res);
        if (!responseResult.success) {
          return {
            status: 500,
            json: {
              message:
                "Could not validate response. This is likely a bug in Val server.",
              details: {
                response: res,
                errors: formatZodErrorString(responseResult.error),
              },
            },
          };
        }
      }
      return res;
    }

    if (path.startsWith("/static")) {
      if (!serveStatic) {
        return convert({
          status: 404,
          json: {
            message: "Val: this server does not serve the Studio's own files",
          },
        });
      }
      return convert(await serveStatic(path.slice("/static".length), url.href));
    } else {
      return convert(await getValServerResponse(path, req));
    }
  };
}

function formatZodErrorString(error: ZodError): string {
  const errors = fromError(error).toString();
  return errors.length > 640 ? `${errors.slice(0, 640)}...` : errors;
}

/**
 * The request's JSON body, or `undefined` when it has none.
 *
 * `req.json()` THROWS on an empty body, and the router used to call it
 * unconditionally for any route that declares a body — so the moment
 * `DELETE /patches` gained an optional body, every caller that sent none got
 * `400 Could not parse request body`. Declaring the schema `.optional()` did
 * not help: the throw happens before zod is ever consulted. Six e2e tests went
 * red on a helper doing exactly what the route still permits.
 *
 * Told apart by the request rather than by catching, so a body that IS sent and
 * is malformed still fails: absent means no content type and nothing to read,
 * and anything else is parsed and allowed to throw. A route whose schema
 * requires a body is unaffected — it gets `undefined` and zod refuses it, with
 * the same 400 as before, now naming the field.
 */
async function readJsonBody(req: Request): Promise<unknown> {
  if (req.headers.get("content-length") === "0") {
    return undefined;
  }
  const text = await req.text();
  if (text.length === 0) {
    return undefined;
  }
  return JSON.parse(text);
}

function zodErrorResult(
  error: ZodError,
  message: string,
): ValServerGenericResult {
  return {
    status: 400,
    json: {
      message: "Bad Request: " + message,
      details: {
        errors: formatZodErrorString(error),
      },
    },
  };
}

// TODO: is this naive implementation is too naive?
/** The declared headers, by name; `Headers.get` is case-insensitive. */
function getHeaders(
  req: Request,
  headersDef: Record<string, z.ZodSchema<string | undefined>>,
) {
  const input: Record<string, string> = {};
  for (const name of Object.keys(headersDef)) {
    const value = req.headers?.get(name);
    if (value !== null && value !== undefined) {
      input[name] = value;
    }
  }
  return z.object(headersDef).safeParse(input);
}

function getCookies<
  Cookies extends {
    val_session?: z.ZodString | z.ZodOptional<z.ZodString>;
    val_state?: z.ZodString | z.ZodOptional<z.ZodString>;
    val_enable?: z.ZodString | z.ZodOptional<z.ZodString>;
  },
>(
  req: Request,
  cookiesDef: Cookies,
):
  | z.ZodSafeParseSuccess<{
      [K in keyof Cookies]: Cookies[K] extends z.ZodType
        ? z.infer<Cookies[K]>
        : never;
    }>
  | z.ZodSafeParseError<Record<string, string>> {
  const input: Record<string, string> = {};
  const cookieParts = req.headers?.get("Cookie")?.split("; ");
  for (const name of Object.keys(cookiesDef)) {
    const cookie = cookieParts?.find((cookie) => cookie.startsWith(`${name}=`));
    const value = cookie
      ? decodeURIComponent(cookie?.split("=")[1])
      : undefined;
    if (value) {
      input[name.trim()] = value;
    }
  }
  return z.object(cookiesDef).safeParse(input) as
    | z.ZodSafeParseSuccess<{
        [K in keyof Cookies]: Cookies[K] extends z.ZodType
          ? z.infer<Cookies[K]>
          : never;
      }>
    | z.ZodSafeParseError<Record<string, string>>;
}
