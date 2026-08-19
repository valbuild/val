import meow from "meow";
import { error } from "./logger";
import { validate } from "./validate";
import { listUnusedFiles as listUnusedFiles } from "./listUnusedFiles";
import { getVersions } from "./getVersions";
import { connect } from "./connect";
import chalk from "chalk";
import { login } from "./login";
import { lsp } from "./lsp";
import { debug } from "./debug";
import { deleteUnappliablePatches } from "./deleteUnappliablePatches";

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(
    `
      Usage:
        $ val [command]
      
      Options:
        --help                   Show this message
      
      Commands:
        validate
        login
        files
        connect
        versions
        lsp
        debug
        delete-unappliable-patches

      Command: validate
      Description: val-idate val modules
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())
        --fix  [fix]             Attempt to fix validation errors
        --watch, -w              Re-validate on changes to val.config, val.modules and *.val files

      
      Command: login
      Description: login to admin.val.build and generate a Personal Access Token
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())


      Command: connect
      Description: connect your local project to a Val Build project at admin.val.build
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())

      Command: list-unused-files
      Description: EXPERIMENTAL.
        List files that are in the configured files directory (files.directory, default public/val) but not in use by any Val module.
        This is useful for cleaning up unused files.
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())

      Command: lsp
      Description: start the Val language server (used by editor integrations)
      Options:
        --stdio                  Communicate over stdin/stdout
        --node-ipc               Communicate over Node IPC
        --socket=[port]          Communicate over a socket

      Command: debug
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
        --verbose                List every pending patch, not just the failing ones

      Command: delete-unappliable-patches
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
        --verbose                List every pending patch, not just the failing ones
    `,
    {
      flags: {
        root: {
          type: "string",
          alias: "r",
        },
        fix: {
          type: "boolean",
        },
        watch: {
          type: "boolean",
          alias: "w",
        },
        noEslint: {
          type: "boolean",
        },
        managedDir: {
          type: "string",
        },
        out: {
          type: "string",
        },
        commit: {
          type: "string",
        },
        branch: {
          type: "string",
        },
        includeFiles: {
          type: "boolean",
        },
        remote: {
          type: "boolean",
        },
        dryRun: {
          type: "boolean",
        },
        yes: {
          type: "boolean",
        },
        verbose: {
          type: "boolean",
        },
      },
      hardRejection: false,
    },
  );

  if (input.length === 0) {
    return showHelp();
  }

  if (input.length !== 1) {
    return error(`Unknown command "${input.join(" ")}"`);
  }

  const [command] = input;
  switch (command) {
    case "list-unused-files":
      if (flags.fix || flags.noEslint) {
        return error(
          `Command "list-unused-files" does not support --fix or --noEslint flags`,
        );
      }
      return listUnusedFiles({
        root: flags.root,
      });
    case "versions":
      return versions();
    case "lsp":
      return lsp();
    case "debug":
      return debug({
        root: flags.root,
        out: flags.out,
        commit: flags.commit,
        branch: flags.branch,
        remote: flags.remote,
        includeFiles: flags.includeFiles,
        verbose: flags.verbose,
      });
    case "delete-unappliable-patches":
      return deleteUnappliablePatches({
        root: flags.root,
        commit: flags.commit,
        branch: flags.branch,
        remote: flags.remote,
        dryRun: flags.dryRun,
        yes: flags.yes,
        verbose: flags.verbose,
      });
    case "login":
      return login({
        root: flags.root,
      });
    case "connect":
      if (flags.fix || flags.noEslint) {
        return error(
          `Command "connect" does not support --fix or --noEslint flags`,
        );
      }
      return connect({
        root: flags.root,
      });
    case "validate":
    case "idate":
      if (flags.managedDir) {
        return error(`Command "validate" does not support --managedDir flag`);
      }
      if (flags.watch && flags.fix) {
        return error(
          `Command "validate" does not support --watch together with --fix`,
        );
      }
      return validate({
        root: flags.root,
        fix: flags.fix,
        watch: flags.watch,
      });
    default:
      return error(`Unknown command "${input.join(" ")}"`);
  }
}

void main().catch((err) => {
  error(
    err instanceof Error
      ? err.message + "\n" + err.stack
      : typeof err === "object"
        ? JSON.stringify(err, null, 2)
        : err,
  );
  process.exitCode = 1;
});

async function versions() {
  const foundVersions = getVersions();
  console.log(`${chalk.cyan("@valbuild/core")}: ${foundVersions.coreVersion}`);
  console.log(`${chalk.cyan("@valbuild/next")}: ${foundVersions.nextVersion}`);
}
