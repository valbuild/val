import fs from "fs";
import path from "path";
import pc from "picocolors";
import {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
  type RemoteFileAuth,
  type SiteErrorsFailureReason,
} from "@valbuild/server";
import { findAndEvalValConfigFile } from "./utils/evalValConfigFile";
import { getContentHost } from "./publish/contentHost";

/**
 * What `val errors` and `val logs` both need before they can ask Val Build
 * anything: which project, with which credential, at which host. And how
 * both word Val Build's refusals, so the two commands say the same thing
 * about the same failure.
 */
export type ValBuildTarget = {
  project: string;
  org: string;
  credential: RemoteFileAuth;
  contentHost: string;
};

export async function resolveValBuildTarget(options: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  /** "errors", "logs": finishes "Reading the site's ___ needs you to be logged in". */
  what: string;
}): Promise<
  | { status: "ok"; target: ValBuildTarget }
  | { status: "error"; message: string }
> {
  const env = options.env ?? process.env;
  const root = options.root ? path.resolve(options.root) : process.cwd();
  const config = await findAndEvalValConfigFile(root).catch(() => null);
  const project = config?.project ?? env.VAL_PROJECT ?? null;
  if (!project) {
    return {
      status: "error",
      message:
        "Nothing says which project this is.\n\n" +
        'Set `project` ("<org>/<project>") in val.config, or the VAL_PROJECT\n' +
        "environment variable.",
    };
  }
  const [org, name, ...rest] = project.split("/");
  if (!org || !name || rest.length > 0) {
    return {
      status: "error",
      message: `Invalid project: "${project}". Expected "<org>/<project>".`,
    };
  }
  const credential = readCredential(root, env, options.what);
  if (credential.status === "error") return credential;
  return {
    status: "ok",
    target: {
      project,
      org,
      credential: credential.auth,
      contentHost: getContentHost(env),
    },
  };
}

/** The `val login` token, else VAL_API_KEY, else what to do. */
function readCredential(
  root: string,
  env: NodeJS.ProcessEnv,
  what: string,
):
  | { status: "ok"; auth: RemoteFileAuth }
  | { status: "error"; message: string } {
  const patFile = getPersonalAccessTokenPath(root);
  if (fs.existsSync(patFile)) {
    const parsed = parsePersonalAccessTokenFile(
      fs.readFileSync(patFile, "utf-8"),
    );
    if (parsed.success) return { status: "ok", auth: { pat: parsed.data.pat } };
    if (!env.VAL_API_KEY) {
      return {
        status: "error",
        message: `Could not read the Val login at ${patFile}. Log in again:\n\n    npx val login`,
      };
    }
  }
  if (env.VAL_API_KEY) {
    return { status: "ok", auth: { apiKey: env.VAL_API_KEY } };
  }
  return {
    status: "error",
    message: `Reading the site's ${what} needs you to be logged in to Val Build:\n\n    npx val login`,
  };
}

/** Val Build's refusal, in the developer's terms, with what to do next. */
export function describeValBuildFailure(
  target: ValBuildTarget,
  reason: SiteErrorsFailureReason,
  message: string,
  what: string,
): string {
  const details = pc.dim(`\n\nDetails: ${message}`);
  switch (reason) {
    case "unauthenticated":
      return "pat" in target.credential
        ? "Your Val login has expired. Log in again:\n\n    npx val login"
        : `Val Build did not accept VAL_API_KEY for ${target.project}. Check that it is this project's key, or log in instead:\n\n    npx val login`;
    case "forbidden":
      return `You cannot read ${target.project}'s ${what}. Ask an owner of ${target.org} to add you to the project.`;
    case "not-found":
      return `Val Build has no project "${target.project}". Check \`project\` in val.config.${details}`;
    case "unavailable":
      return `Val Build could not read the site's ${what} just now. Trying again in a moment usually works.${details}`;
    case "unreachable":
      return `Val Build could not be reached at ${target.contentHost}.${details}`;
    case "invalid-response":
      return `Val Build answered, but not with the site's ${what}. A newer CLI may read it:\n\n    npm install @valbuild/cli@latest${details}`;
  }
}
