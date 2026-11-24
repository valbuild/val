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
import { publish } from "./publish";
import { ciReport } from "./ciReport";
import { checkBuildTools } from "./checkBuildTools";
import { ALIASES, USAGE, isCommand, requestedHelp } from "./help";

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(USAGE, {
    flags: {
      // Declared so `-h` is a flag rather than an unknown one; answered by
      // `requestedHelp` below, for every command, before any of them runs.
      help: {
        type: "boolean",
        alias: "h",
      },
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
      artifacts: {
        type: "string",
      },
      layerRev: {
        type: "string",
      },
      buildHash: {
        type: "string",
      },
      linksOwnCss: {
        type: "boolean",
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
      skipValidation: {
        type: "boolean",
      },
      strict: {
        type: "boolean",
      },
      // On unless --no-typecheck: an absent boolean is false to meow.
      typecheck: {
        type: "boolean",
        default: true,
      },
      yes: {
        type: "boolean",
      },
      verbose: {
        type: "boolean",
      },
      status: {
        type: "string",
      },
      url: {
        type: "string",
      },
    },
    hardRejection: false,
    // Ours, so `--help` alone prints what `-h` and `<command> --help` do.
    autoHelp: false,
  });

  const help = requestedHelp(input, flags);
  if (help !== null) {
    console.log(help);
    return;
  }

  if (input.length === 0) {
    return showHelp();
  }

  if (input.length !== 1) {
    return error(`Unknown command "${input.join(" ")}"`);
  }

  const [name] = input;
  const command = ALIASES[name] ?? name;
  if (!isCommand(command)) {
    return error(`Unknown command "${input.join(" ")}"`);
  }
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
    case "check-build-tools":
      return checkBuildTools();
    case "ci-report":
      return ciReport({
        root: flags.root,
        status: flags.status,
        commit: flags.commit,
        branch: flags.branch,
        url: flags.url,
      });
    case "publish":
      return publish({
        root: flags.root,
        artifacts: flags.artifacts,
        commit: flags.commit,
        branch: flags.branch,
        layerRev: flags.layerRev,
        buildHash: flags.buildHash,
        linksOwnCss: flags.linksOwnCss,
        dryRun: flags.dryRun,
        skipValidation: flags.skipValidation,
        strict: flags.strict,
        typecheck: flags.typecheck,
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
        strict: flags.strict,
      });
    case "versions":
      return versions();
    default: {
      // Every command in COMMAND_HELP is handled above.
      const unhandled: never = command;
      return error(`Unknown command "${unhandled}"`);
    }
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
  // Only the framework package this project actually has. Printing the other
  // as `undefined` reads as something missing rather than something absent.
  if (foundVersions.nextVersion) {
    console.log(
      `${chalk.cyan("@valbuild/next")}: ${foundVersions.nextVersion}`,
    );
  }
  if (foundVersions.tanstackVersion) {
    console.log(
      `${chalk.cyan("@valbuild/tanstack")}: ${foundVersions.tanstackVersion}`,
    );
  }
  if (!foundVersions.nextVersion && !foundVersions.tanstackVersion) {
    console.log(
      `${chalk.yellow("No framework package found")}: install @valbuild/next or @valbuild/tanstack`,
    );
  }
}
