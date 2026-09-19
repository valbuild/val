import fs from "fs";
import {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
} from "@valbuild/server";
import { ContentHostError, getContentHost, postJson } from "./contentHost";

/**
 * The credential `val publish` presents to content, and where it came from.
 *
 * Whatever the publisher started with, this is a *project* token: it can do one
 * thing to one project. A personal access token is a person's credential -
 * org-wide, read and write on every project they can reach - so it never
 * travels further than val.build, which exchanges it for one of these.
 */
export type PublishCredential = {
  /** Presented as `Authorization: Bearer`. Never logged, never in argv. */
  token: string;
  /**
   * Which of the ways below produced it. For messages only: "your login
   * expired" and "the repository's token was revoked" have different fixes and
   * different people to tell.
   */
  origin: "VAL_PROJECT_TOKEN" | "val login" | "VAL_APP_TOKEN";
  /** ISO 8601, or null for a standing token that does not expire. */
  expiresAt: string | null;
};

export type ResolvedCredential =
  | { status: "ok"; credential: PublishCredential }
  | { status: "error"; message: string };

const NO_CREDENTIAL =
  "Publishing needs a credential.\n\n" +
  "  In CI:           set VAL_PROJECT_TOKEN as a repository secret.\n" +
  "  On your machine: run\n\n" +
  "      npx val login\n\n" +
  "Neither is a command line flag, deliberately: an argument is visible to\n" +
  "anyone who can list processes, and it is kept in shell history and in the\n" +
  "log of every CI job that echoes its command line.";

/**
 * The credential, in the order the publisher should prefer them.
 *
 * 1. `VAL_PROJECT_TOKEN` from the environment - used as it is, no exchange.
 *    This is what a repository created by `/new` holds, and the only secret it
 *    needs: the token names its project, so content can answer *where* to
 *    publish as well as *whether*.
 * 2. The `val login` token in `<root>/.val/pat.json` - exchanged first, because
 *    what publishes must be a project token. The exchange is addressed by org
 *    and project, since a personal access token does not name one; that is why
 *    this way needs `project` and the first does not.
 * 3. Neither, which is not an error we can guess our way out of.
 *
 * Returns a result rather than throwing: "no credential" is one of the things a
 * publisher has to say well, and the sentence differs by which half was missing.
 */
export async function resolvePublishCredential(options: {
  /** Project root - where `.val/pat.json` is looked for. */
  root: string;
  /** `"<org>/<project>"`, from val.config or VAL_PROJECT. Only (2) needs it. */
  project: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedCredential> {
  const env = options.env ?? process.env;
  // An unset secret reaches a CI job as the empty string rather than as absent,
  // and an empty credential presented to content is a 401 that reads as "your
  // token is bad" instead of "you never set one".
  const projectToken = env.VAL_PROJECT_TOKEN?.trim();
  if (projectToken) {
    if (looksLikePersonalAccessToken(projectToken)) {
      return {
        status: "error",
        message:
          "VAL_PROJECT_TOKEN looks like a personal access token, not a project\n" +
          "token. A project token begins with `val_pt_` and is made for one\n" +
          "project; a personal access token belongs to a person and cannot\n" +
          "publish. Mint a project token on the project's settings page.",
      };
    }
    return {
      status: "ok",
      credential: {
        token: projectToken,
        origin: "VAL_PROJECT_TOKEN",
        // A standing token need not expire, and nothing here has been told
        // otherwise. Content is where an expiry would come from.
        expiresAt: null,
      },
    };
  }

  const pat = readPersonalAccessToken(options.root);
  if (pat.status === "error") {
    return pat;
  }
  if (pat.status === "none") {
    /*
     * The old names, still read.
     *
     * This is where the api key used to be passed, and this platform's own CI
     * still passes it: a rename that breaks the publisher is a rename that gets
     * reverted. It will not be accepted for long - publishing is being taken
     * out of what an api key may do - and content says so in its own words
     * when it refuses one, which is a better sentence than a guess here.
     */
    const legacy = (env.VAL_APP_TOKEN ?? env.PLATFORM_TOKEN)?.trim();
    if (legacy) {
      return {
        status: "ok",
        credential: {
          token: legacy,
          origin: "VAL_APP_TOKEN",
          expiresAt: null,
        },
      };
    }
    return { status: "error", message: NO_CREDENTIAL };
  }

  if (!options.project) {
    return {
      status: "error",
      message:
        "You are logged in, but nothing says which project to publish.\n\n" +
        'Set `project` ("<org>/<project>") in val.config, or the VAL_PROJECT\n' +
        "environment variable.\n\n" +
        "A `val login` token belongs to you rather than to a project, so it\n" +
        "cannot say which one you are standing in.",
    };
  }
  const parts = options.project.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      status: "error",
      message: `Invalid project: "${options.project}". Expected "<org>/<project>".`,
    };
  }
  const [orgName, projectName] = parts;

  return exchangePersonalAccessToken({
    pat: pat.pat,
    orgName,
    projectName,
    env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

/**
 * Trade the token you have for the token that may publish.
 *
 * Ten minutes, one project, one scope. The person's identity survives the
 * exchange even though the credential will not outlive the command, which is
 * what gives "who published this" an answer afterwards.
 */
async function exchangePersonalAccessToken(options: {
  pat: string;
  orgName: string;
  projectName: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedCredential> {
  const host = getContentHost(options.env);
  const url = `${host}/v1/${encodeURIComponent(
    options.orgName,
  )}/${encodeURIComponent(options.projectName)}/publish-token`;
  let body: unknown;
  try {
    body = await postJson({
      url,
      headers: { "x-val-pat": options.pat },
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  } catch (err) {
    if (err instanceof ContentHostError) {
      return {
        status: "error",
        message: exchangeFailureMessage(err, options),
      };
    }
    throw err;
  }
  const token = stringField(body, "token");
  if (!token) {
    return {
      status: "error",
      message:
        `${url} answered without a token. This is a bug in the content\n` +
        "service rather than in your setup.",
    };
  }
  return {
    status: "ok",
    credential: {
      token,
      origin: "val login",
      expiresAt: stringField(body, "expiresAt") ?? null,
    },
  };
}

function exchangeFailureMessage(
  err: ContentHostError,
  options: { orgName: string; projectName: string },
): string {
  const project = `${options.orgName}/${options.projectName}`;
  if (err.statusCode === 401) {
    return (
      "Your Val login is no longer valid - it may have expired. Log in again:\n\n" +
      "    npx val login"
    );
  }
  if (err.statusCode === 403) {
    return `Your Val account may not publish ${project}: ${err.message}`;
  }
  if (err.statusCode === 404) {
    return (
      `No project ${project}. Check \`project\` in val.config (or VAL_PROJECT):\n` +
      "it is the org and project as val.build names them, not the repository."
    );
  }
  return (
    `Could not get a publish token for ${project}: ${err.message}` +
    (err.details ? `\n${err.details}` : "")
  );
}

/** A personal access token is 32 random bytes as hex, and carries no prefix. */
function looksLikePersonalAccessToken(token: string): boolean {
  return /^[0-9a-f]{64}$/i.test(token);
}

function readPersonalAccessToken(
  root: string,
):
  | { status: "ok"; pat: string }
  | { status: "none" }
  | { status: "error"; message: string } {
  const patFile = getPersonalAccessTokenPath(root);
  if (!fs.existsSync(patFile)) {
    return { status: "none" };
  }
  const parsed = parsePersonalAccessTokenFile(
    fs.readFileSync(patFile, "utf-8"),
  );
  if (!parsed.success) {
    return {
      status: "error",
      message:
        `Could not read the Val login at ${patFile}: ${parsed.error}.\n` +
        "Log in again:\n\n    npx val login",
    };
  }
  return { status: "ok", pat: parsed.data.pat };
}

function stringField(body: unknown, key: string): string | null {
  if (typeof body === "object" && body !== null && key in body) {
    const value = Reflect.get(body, key);
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
}
