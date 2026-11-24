// What `val --help` and `val <command> --help` print.
//
// One entry per command, and the dispatch in cli.ts is an exhaustive switch
// over these names: a command without help here does not compile there.
//
// `--help` is answered BEFORE any command runs, and that is the point of this
// file. meow answers `--help` itself only when it is the whole command line, so
// `val publish --help` used to reach `publish` -- which, with credentials,
// builds, uploads and moves the live site. `validate --fix --help` rewrote
// files, and `delete-unappliable-patches --yes --help` deleted patches.

export const COMMAND_HELP = {
  validate: `Command: validate
Description: val-idate val modules
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())
  --fix  [fix]             Attempt to fix validation errors
  --watch, -w              Re-validate on changes to val.config, val.modules and *.val files
  --strict                 Fail on warnings too (local files in a project with remote files)`,
  login: `Command: login
Description: login to admin.val.build and generate a Personal Access Token
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())`,
  connect: `Command: connect
Description: open admin.val.build to connect this project, with its repository
             and val.config.ts project filled in
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())`,
  publish: `Command: publish
Description: build this project and publish it through content.val.build.
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
  "ci-report": `Command: ci-report
Description: tell content how CI's build of a commit went, for a connected
             project's workflow. Run as its last step, whatever the build did:
             a failed build then reads "Published, not on the site yet" in the
             Studio, with a link to the run. Never fails the job.
Options:
  --status [failed|succeeded]  How the build went
  --commit [sha]           The commit built (default GITHUB_SHA)
  --branch [name]          Its branch (default GITHUB_REF_NAME, else the project's)
  --url [url]              The run (default this GitHub Actions run)`,
  "check-build-tools": `Command: check-build-tools
Description: load what "val publish" builds with, and build a one-line module with
  it: whether this install could publish, without asking content anything. Val Build
  runs it on an upgrade's install before a connected project can publish the upgrade.
  Fails when it could not.`,
  "list-unused-files": `Command: list-unused-files
Description: EXPERIMENTAL.
  List files that are in the configured files directory (public/val) but not in use by any Val module.
  This is useful for cleaning up unused files.
Options:
  --root [root], -r [root] Set project root directory (default process.cwd())`,
  versions: `Command: versions
Description: print the versions of the Val packages this project has installed`,
  lsp: `Command: lsp
Description: start the Val language server (used by editor integrations)
Options:
  --stdio                  Communicate over stdin/stdout
  --node-ipc               Communicate over Node IPC
  --socket=[port]          Communicate over a socket`,
  debug: `Command: debug
Description: Create a self-contained snapshot (the pending patches plus the modules they
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
  "delete-unappliable-patches": `Command: delete-unappliable-patches
Description: Delete the pending patches that cannot be applied. This is what unblocks a
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
};

export type Command = keyof typeof COMMAND_HELP;

export const isCommand = (name: string): name is Command =>
  Object.prototype.hasOwnProperty.call(COMMAND_HELP, name);

/** `idate` is `validate`, as in "val idate". */
export const ALIASES: Record<string, Command> = { idate: "validate" };

export const USAGE = `Usage:
  $ val [command] [options]

Options:
  --help, -h               Show this message, or a command's with "val <command> --help"

Commands:
${Object.keys(COMMAND_HELP)
  .map((name) => `  ${name}`)
  .join("\n")}

${Object.values(COMMAND_HELP).join("\n\n")}`;

/**
 * The help to print instead of running anything, or null when none was asked
 * for. A command's own help when it names one, everything otherwise.
 */
export function requestedHelp(
  input: ReadonlyArray<string>,
  flags: { help?: boolean },
): string | null {
  if (!flags.help) return null;
  const [name] = input;
  const command = name === undefined ? undefined : (ALIASES[name] ?? name);
  if (input.length === 1 && command !== undefined && isCommand(command)) {
    return COMMAND_HELP[command];
  }
  return USAGE;
}
