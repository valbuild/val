/**
 * What `val --help`, `val <command> --help` and `val help [command]` print,
 * and the decision of whether to print it (or the version) instead of running
 * a command.
 *
 * meow handles `--help` and `--version` by itself only when they are the ONLY
 * argument, so `val publish --help` went on to publish. The decision is made
 * here, before any command is dispatched, so a help or version flag anywhere
 * on the line means nothing runs.
 */

/**
 * One entry per command `val` dispatches on. The text is written at column 0
 * and indented when printed. The list of commands in the overview is made from
 * these keys, so a command cannot be documented here and missing there.
 */
export const COMMAND_HELP = {
  validate: `Description: val-idate val modules
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())
  --fix  [fix]             Attempt to fix validation errors
  --watch, -w              Re-validate on changes to val.config, val.modules and *.val files
  --strict                 Fail on warnings too (local files in a project with remote files)`,

  login: `Description: login to admin.val.build and generate a Personal Access Token
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())`,

  connect: `Description: open admin.val.build to connect this project, with its repository
             and val.config.ts project filled in
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())`,

  "ci-report": `Description: tell content how CI's build of a commit went, for a connected
             project's workflow. Run as its last step, whatever the build did:
             a failed build then reads "Published, not on the site yet" in the
             Studio, with a link to the run. Never fails the job.
Options:
  --status [failed|succeeded]  How the build went
  --commit [sha]           The commit built (default GITHUB_SHA)
  --branch [name]          Its branch (default GITHUB_REF_NAME, else the project's)
  --url [url]              The run (default this GitHub Actions run)`,

  publish: `Description: build this project and publish it through content.val.build.
  Asks content what to build against, builds the site and its dependency layer from
  the checkout (needs @valbuild/tanstack-build, rolldown, @tanstack/router-generator
  and @tanstack/router-plugin installed), declares the artifacts, uploads the ones
  content does not already hold, and has content verify it by building and rendering
  a canary before the site changes. With --artifacts, or a .val/publish directory,
  it publishes that build instead of making one. Authenticates with VAL_PROJECT_TOKEN,
  or with the "val login" token in .val/pat.json (which needs the project, as
  "<org>/<project>", in val.config or VAL_PROJECT). Never as a flag: an argument is
  visible to anyone who can list processes, and it is kept in shell history and in
  every CI log.
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())
  --artifacts [dir]        Publish a build made elsewhere (default: build the checkout,
                           unless <root>/.val/publish exists). The path of each file
                           under it is its artifact key: server, client, css, rsc,
                           layer, source, or a path under chunk/server, chunk/client,
                           chunk/rsc, asset, public
  --commit [sha]           The commit this build is of (default VAL_GIT_COMMIT,
                           else GITHUB_SHA, else git HEAD)
  --branch [name]          The branch content commits saves to (default VAL_GIT_BRANCH,
                           else GITHUB_REF_NAME, else the current git branch)
  --layer-rev [rev]        Name the dependency layer content already holds, when this
                           build does not send one
  --build-hash [hash]      Identify the build (default: a hash of its artifacts).
                           Declaring the same one twice resumes that publish
  --links-own-css          The app links its own CSS (--no-links-own-css for the
                           opposite; omit it when the build did not say)
  --dry-run                Verify, and stop before the site changes
  --skip-validation        Publish without running "val validate" first. It runs by
                           default, and an error stops the publish
  --strict                 Let a validation warning stop the publish too
  --no-typecheck           Build without typechecking the project. It runs by default,
                           on the install the build reads, and type errors are
                           printed without stopping the publish`,

  "check-build-tools": `Description: load what "val publish" builds with, and build a one-line module with
  it: whether this install could publish, without asking content anything. Val Build
  runs it on an upgrade's install before a connected project can publish the upgrade.
  Fails when it could not.`,

  "list-unused-files": `Description: EXPERIMENTAL.
  List files that are in the configured files directory (public/val) but not in use by any Val module.
  This is useful for cleaning up unused files.
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())`,

  versions: `Description: print the versions of the Val packages this project has installed`,

  lsp: `Description: start the Val language server (used by editor integrations)
Options:
  --stdio                  Communicate over stdin/stdout
  --node-ipc               Communicate over Node IPC
  --socket=[port]          Communicate over a socket`,

  debug: `Description: Create a self-contained snapshot (the pending patches plus the modules they
  touch or reference) that Val developers can replay to reproduce validation and save
  errors. Read-only.
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())
  --out [file]             Output zip (default ./val-debug-<branch>-<commit>-<timestamp>.zip)
  --remote                 Read the patches from the hosted project instead of <root>/.val
                           (requires "val login"; implied by VAL_API_KEY)
  --commit [sha]           Commit to read module sources at (default VAL_GIT_COMMIT, else git HEAD)
  --branch [name]          Branch (default VAL_GIT_BRANCH, else the current git branch)
  --include-files          Also download the binary files the patches reference
  --verbose                List every pending patch, not just the failing ones`,

  "delete-unappliable-patches": `Description: Delete the pending patches that cannot be applied. This is what unblocks a
  publish failing with "Failed to create commit". Capture a "val debug" snapshot first:
  deleting discards the changes those patches contain.
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())
  --remote                 Operate on the hosted project instead of <root>/.val
                           (requires "val login"; implied by VAL_API_KEY)
  --commit [sha]           Commit to read module sources at (default VAL_GIT_COMMIT, else git HEAD)
  --branch [name]          Branch (default VAL_GIT_BRANCH, else the current git branch)
  --dry-run                Only list what would be deleted
  --yes                    Do not ask for confirmation
  --verbose                List every pending patch, not just the failing ones`,
} satisfies Record<string, string>;

export type CommandName = keyof typeof COMMAND_HELP;

/**
 * `val idate` is a pun on `val validate`, and runs it. A Map, not an object
 * literal: an object would answer `constructor` or `toString` with what it
 * inherits from Object.prototype, as if those were commands.
 */
const COMMAND_ALIASES: ReadonlyMap<string, CommandName> = new Map([
  ["idate", "validate"],
]);

function isCommandName(name: string): name is CommandName {
  return Object.prototype.hasOwnProperty.call(COMMAND_HELP, name);
}

export function resolveCommandName(name: string): CommandName | undefined {
  return isCommandName(name) ? name : COMMAND_ALIASES.get(name);
}

const COMMAND_NAMES: CommandName[] =
  Object.keys(COMMAND_HELP).filter(isCommandName);

function indent(text: string, by: number): string {
  const pad = " ".repeat(by);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

const GLOBAL_OPTIONS = `Options:
  --help, -h               Show this message (or, after a command, that command's)
  --version, -v            Show the version of the Val CLI`;

/** `val --help`: every command, and what each of them takes. */
export function fullHelp(): string {
  const overview = `Usage:
  $ val <command> [options]
  $ val help <command>
  $ val <command> --help

${GLOBAL_OPTIONS}

Commands:
${indent(COMMAND_NAMES.join("\n"), 2)}`;
  const sections = COMMAND_NAMES.map(
    (name) => `Command: ${name}\n${COMMAND_HELP[name]}`,
  );
  return indent([overview, ...sections].join("\n\n"), 2);
}

/** `val <command> --help`: that command alone. */
export function commandHelp(command: CommandName): string {
  return indent(
    `Usage:
  $ val ${command} [options]

${COMMAND_HELP[command]}`,
    2,
  );
}

export type CliAction =
  | { type: "help"; text: string; exitCode: number; error?: string }
  | { type: "version" }
  | { type: "run"; command: CommandName }
  | { type: "unknown-command"; input: string[] };

/**
 * Decides what `val` does with its arguments before anything runs. A help or
 * version flag anywhere on the line wins over the command, with help first:
 * `val publish --help --version` asked what publish does.
 */
export function decideCliAction(
  input: string[],
  flags: { help?: boolean; version?: boolean },
): CliAction {
  // `val help` and `val help <command>`
  if (input[0] === "help") {
    return helpFor(input.slice(1));
  }
  if (flags.help) {
    return helpFor(input);
  }
  if (flags.version) {
    return { type: "version" };
  }
  if (input.length === 0) {
    // Nothing asked for: show what there is, but it is not a success.
    return { type: "help", text: fullHelp(), exitCode: 2 };
  }
  const command = input.length === 1 ? resolveCommandName(input[0]) : undefined;
  if (!command) {
    return { type: "unknown-command", input };
  }
  return { type: "run", command };
}

function helpFor(input: string[]): CliAction {
  if (input.length === 0) {
    return { type: "help", text: fullHelp(), exitCode: 0 };
  }
  const command = input.length === 1 ? resolveCommandName(input[0]) : undefined;
  if (!command) {
    return {
      type: "help",
      text: fullHelp(),
      exitCode: 2,
      error: `Unknown command "${input.join(" ")}"`,
    };
  }
  return { type: "help", text: commandHelp(command), exitCode: 0 };
}
