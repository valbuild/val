import { DEFAULT_VAL_REMOTE_HOST } from "./schema/remote";

/**
 * Where Val Build is, for one process: the content host, the host that
 * serves remote files, and the app people sign in to.
 *
 * Unset, each is val.build's. A self-hosted installation sets `VAL_HOST` to
 * its engine's origin, and all three follow it, since the engine serves the
 * content API, remote files and sign-in from that one origin (its own
 * `/.well-known/val-host.json` lists them). Each can still be pointed
 * somewhere else on its own, as before `VAL_HOST` existed:
 *
 * | Host      | Its own variable   | Unset, with `VAL_HOST` | Unset, without |
 * | --------- | ------------------ | ---------------------- | -------------- |
 * | `content` | `VAL_CONTENT_URL`  | `VAL_HOST`             | content.val.build |
 * | `remote`  | `VAL_REMOTE_HOST`  | `VAL_HOST`             | remote.val.build  |
 * | `admin`   | `VAL_BUILD_URL`    | `VAL_HOST`             | admin.val.build   |
 *
 * Read without a request: nothing is fetched, so a process that cannot
 * reach the engine at start still starts.
 *
 * Not the static host (`DEFAULT_STATIC_HOST`), which is a fixed literal on
 * purpose -- see there.
 */
export type ValHosts = {
  content: string;
  remote: string;
  admin: string;
};

export const DEFAULT_CONTENT_HOST = "https://content.val.build";
export const DEFAULT_APP_HOST = "https://admin.val.build";

type Env = { readonly [name: string]: string | undefined };

export function valHostsOf(env: Env | undefined): ValHosts {
  const read = (name: string): string | undefined => {
    const value = env?.[name]?.trim();
    // A trailing slash turns every path below into a double slash, which
    // some routers answer with a redirect and others with a 404.
    return value ? value.replace(/\/+$/, "") : undefined;
  };
  const engine = read("VAL_HOST");
  return {
    content: read("VAL_CONTENT_URL") ?? engine ?? DEFAULT_CONTENT_HOST,
    remote: read("VAL_REMOTE_HOST") ?? engine ?? DEFAULT_VAL_REMOTE_HOST,
    admin: read("VAL_BUILD_URL") ?? engine ?? DEFAULT_APP_HOST,
  };
}

/**
 * {@link valHostsOf} for this process: `process.env` where there is one, and
 * val.build's hosts where there is none (a browser, whose bundler may not
 * replace `process.env`).
 */
export function valHosts(): ValHosts {
  return valHostsOf(typeof process === "undefined" ? undefined : process.env);
}
