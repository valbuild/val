import { fetchSiteLogs, resolveRemoteFileAuth } from "@valbuild/server";
import { z } from "zod";
import { defineTool, err, ok, type ValToolImpl } from "./defineTool";

/**
 * `get_logs`: what the hosted site's server did in the last hour, request by
 * request with what each printed, from Val Build -- the same answer `val logs`
 * prints and the Studio's Logs page shows (`fetchSiteLogs` in
 * @valbuild/server). Where `get_site_errors` says what has been going wrong,
 * grouped, this says what happened on a given request, in order.
 *
 * Read with the credential the project already has for Val Build
 * (`resolveRemoteFileAuth`), as `get_site_errors` does.
 *
 * `fetchImpl` is for tests. The registry builds it with the global `fetch`.
 */
export function siteLogsTool(fetchImpl: typeof fetch = fetch): ValToolImpl {
  return defineTool(
    {
      name: "get_logs",
      title: "Get site logs",
      description:
        "The hosted site's server requests from the last hour, newest first: each with its method, path, status, duration, how it ended (`outcome`: ok, exception, cpu, memory, canceled), the build that answered, and every line it printed (console.log/info/warn/error/debug and exceptions, with stacks). `errorFingerprint` links a request to its group in `get_site_errors`. Narrow it with `search`, which takes words (matched against paths, request ids and printed lines) and filters: `status:5xx`, `status:404`, `path:/blog/*`, `method:post`, `level:error`, `build:live` (answered by the build live now), `is:stopped`. Kept for sites Val Build hosts, for an hour; a site hosted anywhere else answers `not-hosted`. Lines are redacted: secrets, tokens and query strings are taken out.",
      inputSchema: z.object({
        search: z
          .string()
          .max(500)
          .optional()
          .describe(
            "Words and filters, e.g. `status:5xx path:/blog/*` or `title undefined`.",
          ),
        levels: z
          .array(z.enum(["error", "warn", "info"]))
          .min(1)
          .optional()
          .describe(
            "Only requests at these levels: a request is `error` when it failed (5xx, stopped, or printed an error), `warn` when it printed a warning, otherwise `info`. All when absent.",
          ),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("How far back, in minutes. Default 60, the most kept."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("At most this many requests, newest first. Default 50."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ search, levels, minutes, limit }, { config }) => {
      if (!config.project) {
        return err(
          "unsupported",
          "This Val project is not connected to Val Build, so it has no hosted site to read logs from. Set `project` in val.config (or the VAL_PROJECT environment variable).",
        );
      }
      const auth = await resolveRemoteFileAuth(config);
      if (auth.status === "error") {
        return err(
          "forbidden",
          auth.errorCode === "pat-error"
            ? "Reading the site's logs needs you to be logged in to Val Build. Run `npx val login` in the project directory, then try again."
            : `Could not work out which credential to read the site's logs with: ${auth.message}`,
        );
      }
      const result = await fetchSiteLogs({
        contentUrl: config.valContentUrl,
        project: config.project,
        credential: auth.auth,
        since: new Date(Date.now() - (minutes ?? 60) * 60_000),
        ...(search !== undefined ? { q: search } : {}),
        ...(levels !== undefined ? { levels } : {}),
        limit: limit ?? 50,
        fetchImpl,
      });
      if (result.status === "ok") {
        if (result.answer.status === "not-hosted") return ok(result.answer);
        // The chart is for a person looking at bars; an agent reads the list.
        const { histogram: _histogram, ...answer } = result.answer;
        return ok(answer);
      }
      switch (result.reason) {
        case "unauthenticated":
          return err(
            "forbidden",
            "pat" in auth.auth
              ? "Your Val login has expired. Run `npx val login` in the project directory, then try again."
              : `Val Build did not accept this app's API key for ${config.project}.`,
          );
        case "forbidden":
          return err(
            "forbidden",
            `This credential cannot read ${config.project}'s logs: ${result.message}`,
          );
        case "not-found":
          return err(
            "not-found",
            `Val Build has no project "${config.project}". Check \`project\` in val.config.`,
          );
        case "unavailable":
        case "unreachable":
          return err(
            "internal",
            `Val Build could not answer just now; trying again usually works. (${result.message})`,
          );
        case "invalid-response":
          return err("internal", result.message);
      }
    },
  );
}
