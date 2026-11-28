import { fetchSiteErrors, resolveRemoteFileAuth } from "@valbuild/server";
import { z } from "zod";
import { defineTool, err, ok, type ValToolImpl } from "./defineTool";

/**
 * `get_site_errors`: what the hosted site has thrown, warned or been stopped
 * for lately, from Val Build -- the same answer `val errors` prints and the
 * Studio's errors panel shows (`fetchSiteErrors` in @valbuild/server).
 *
 * The one read tool that is not about content: an agent asked "why is the
 * blog page broken?" otherwise has the content and the schema and no way to
 * see what the server said. Read with the credential the project already has
 * for Val Build (`resolveRemoteFileAuth`): its API key where it runs, the
 * developer's `val login` locally.
 *
 * `fetchImpl` is for tests. The registry builds it with the global `fetch`.
 */
export function siteErrorsTool(fetchImpl: typeof fetch = fetch): ValToolImpl {
  return defineTool(
    {
      name: "get_site_errors",
      title: "Get site errors",
      description:
        "Recent server errors and warnings from the hosted site, grouped, newest first: uncaught exceptions, console.error and console.warn, requests stopped for using too much CPU or memory, and 5xx responses. Each group has a count, the request it last happened on, its latest stack, and whether the build live now is the first it was seen in (`firstBuild === liveBuild`: brought by the last publish). Kept for sites Val Build hosts, for the last days; a site hosted anywhere else answers `not-hosted`. Messages are redacted: secrets, tokens and query strings are taken out.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("At most this many groups, newest first. Default 100."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit }, { config }) => {
      if (!config.project) {
        return err(
          "unsupported",
          "This Val project is not connected to Val Build, so it has no hosted site to read errors from. Set `project` in val.config (or the VAL_PROJECT environment variable).",
        );
      }
      const auth = await resolveRemoteFileAuth(config);
      if (auth.status === "error") {
        return err(
          "forbidden",
          auth.errorCode === "pat-error"
            ? "Reading the site's errors needs you to be logged in to Val Build. Run `npx val login` in the project directory, then try again."
            : `Could not work out which credential to read the site's errors with: ${auth.message}`,
        );
      }
      const result = await fetchSiteErrors({
        contentUrl: config.valContentUrl,
        project: config.project,
        credential: auth.auth,
        ...(limit !== undefined ? { limit } : {}),
        fetchImpl,
      });
      if (result.status === "ok") return ok(result.answer);
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
            `This credential cannot read ${config.project}'s errors: ${result.message}`,
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
