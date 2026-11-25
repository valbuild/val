import type { ValApiOptions } from "./ValRouter";

/*
 * Which mode a server's options and environment select, apart from
 * `initHandlerOptions` (in `./valServerConfig`), which builds the rest of the
 * config and imports the data layer to do it. A framework binding asks this
 * BEFORE it loads the server: in `fs` and `memory` mode the newest server
 * built in a process is the build the patches are relative to
 * (`ValOps.chainBaseSha`), so it is built when the app starts; in `http`
 * mode the content service says which build is live, so the server can wait for
 * the first request -- which keeps it off a cold isolate's first page.
 *
 * Nothing here may import more than types: it is on every page's path.
 */

/**
 * The value of `VAL_ENV` that means "this is the Val app".
 *
 * The Val app builds a project in a browser and runs it in a Worker isolate.
 * There is no disk there and there never will be, so `fs` mode is never the
 * right fall-through -- and the content is Val's own, reached over HTTP at a
 * commit, exactly as it is for any other deployed app. So this names `http`.
 *
 * What makes the app unusual is not where its content comes from but what
 * publishing means: the browser rebuilds the site and the new build is served
 * immediately, instead of a host noticing a commit and redeploying. That is a
 * difference in what happens AFTER the commit, and `publishOverride` is where
 * a host says so -- not a difference in where patches, files or sources live.
 *
 * A host says WHERE it runs, which is a fact it knows. Which Val mode that
 * implies is Val's to derive, and that is the whole reason this exists next to
 * `VAL_MODE` rather than the platform naming a mode itself: one is a
 * description of an environment, the other an assertion about Val's internals,
 * and only the first stays true when the internals move. They have already
 * moved once -- this meant `memory` while the app kept its own patch store --
 * and no platform had to be changed to follow.
 */
const VAL_APP_ENV = "app";

/** Which mode the environment SAYS this is, and which variable said so. */
export type NamedMode = { mode: string; from: "VAL_MODE" | "VAL_ENV" };

/**
 * `null` is "the environment did not say", which is the normal case.
 *
 * The two variables differ in what can be DONE with an answer, and the
 * difference is whether the environment holds everything the mode needs.
 * `http` does -- an api key, a secret, a project, a commit and a branch are all
 * env vars -- so `VAL_ENV=app` SELECTS it, and the checks in
 * {@link initHandlerOptions} name whichever one is missing. `memory` does not:
 * it needs the host's own source files, which nothing in an environment can
 * supply, so `VAL_MODE=memory` can only ever turn a fall-through into an error.
 */
export function namedMode(): NamedMode | null {
  const declared = process.env.VAL_MODE;
  /*
   * An empty value counts as unset, which is what `VAL_MODE=` in a shell or a
   * CI settings page means. An explicit `VAL_MODE` otherwise wins over
   * `VAL_ENV`: naming a mode outright says something more specific than naming
   * an environment does, including when what it names is wrong and has to be
   * refused.
   */
  if (declared !== undefined && declared !== "") {
    return { mode: declared, from: "VAL_MODE" };
  }
  if (process.env.VAL_ENV === VAL_APP_ENV) {
    return { mode: "http", from: "VAL_ENV" };
  }
  return null;
}

/**
 * Whether these options select `http` mode, as `initHandlerOptions` decides
 * it: a mode of "proxy", the Val app's environment, or a credential with no
 * mode given. `sourceFiles` (memory mode) is decided before this is asked,
 * and the environment's refusals are `initHandlerOptions`'s to throw.
 */
export function selectsHttpMode(
  opts: Pick<ValApiOptions, "mode" | "apiKey" | "valSecret">,
  declared: NamedMode | null = namedMode(),
): boolean {
  const maybeApiKey = opts.apiKey || process.env.VAL_API_KEY;
  const maybeValSecret = opts.valSecret || process.env.VAL_SECRET;
  return (
    opts.mode === "proxy" ||
    declared?.from === "VAL_ENV" ||
    (opts.mode === undefined && !!(maybeApiKey || maybeValSecret))
  );
}

/**
 * Whether a server with these options can be built at its first request
 * rather than when the app starts: only in `http` mode, for the reason at
 * the top of this file. Memory mode is selected by `sourceFiles` alone.
 */
export function serverCanStartLazily(
  opts: Pick<ValApiOptions, "sourceFiles" | "mode" | "apiKey" | "valSecret">,
): boolean {
  return opts.sourceFiles === undefined && selectsHttpMode(opts);
}
